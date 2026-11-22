//! Local model client. Talks ONLY to 127.0.0.1:
//!   * Ollama     http://127.0.0.1:11434  (/api/chat, /api/tags, /api/pull, /api/create)
//!   * llama.cpp  http://127.0.0.1:8080   (/v1/chat/completions, /health)  — Vulkan build offloads to the Radeon 680M
//!
//! Every call is stateless: exactly two messages (system = rules + micro-context, user = prompt),
//! num_ctx 1024, temperature 0 and JSON-Schema constrained decoding.

use crate::db::Db;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const OLLAMA: &str = "http://127.0.0.1:11434";
pub const LLAMACPP: &str = "http://127.0.0.1:8080";

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Ollama,
    LlamaCpp,
}

impl Backend {
    #[allow(dead_code)]
    pub fn as_str(&self) -> &'static str {
        match self {
            Backend::Ollama => "ollama",
            Backend::LlamaCpp => "llamacpp",
        }
    }
}

fn client(timeout_s: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(timeout_s))
        .build()
        .map_err(|e| e.to_string())
}

pub fn preferred_model(db: &Db) -> Option<String> {
    let conn = db.conn.lock().ok()?;
    conn.query_row("SELECT value FROM meta WHERE key='ai_model'", [], |r| r.get::<_, String>(0))
        .ok()
}

/// Installed Ollama models, or None when Ollama is not reachable.
pub async fn list_models() -> Option<Vec<String>> {
    let c = client(3).ok()?;
    let r = c.get(format!("{OLLAMA}/api/tags")).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    let v: Value = r.json().await.ok()?;
    Some(
        v["models"]
            .as_array()
            .map(|a| a.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect())
            .unwrap_or_default(),
    )
}

pub async fn llamacpp_alive() -> bool {
    match client(2) {
        Ok(c) => c
            .get(format!("{LLAMACPP}/health"))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// The backend + model that a prompt would run on right now (None => missing-model gate).
pub async fn active_model(preferred: Option<String>) -> Option<(Backend, String)> {
    if let Some(models) = list_models().await {
        if !models.is_empty() {
            let m = preferred
                .filter(|p| models.contains(p))
                .unwrap_or_else(|| models[0].clone());
            return Some((Backend::Ollama, m));
        }
    }
    if llamacpp_alive().await {
        return Some((Backend::LlamaCpp, "llama.cpp".to_string()));
    }
    None
}

/// One isolated 2-message call. `schema = Some(..)` enables constrained JSON decoding.
pub async fn chat_content(
    be: Backend,
    model: &str,
    system: &str,
    user: &str,
    schema: Option<&Value>,
    cancel: &CancellationToken,
    num_predict: u32,
) -> Result<String, String> {
    let c = client(90)?;
    let msgs = json!([
        { "role": "system", "content": system },
        { "role": "user", "content": user }
    ]);
    let (url, body) = match be {
        Backend::Ollama => {
            let mut b = json!({
                "model": model,
                "messages": msgs,
                "stream": false,
                "keep_alive": "10m",
                "options": { "num_ctx": 1024, "temperature": 0.0, "num_predict": num_predict }
            });
            if let Some(s) = schema {
                b["format"] = s.clone();
            }
            (format!("{OLLAMA}/api/chat"), b)
        }
        Backend::LlamaCpp => {
            let mut b = json!({
                "messages": msgs,
                "temperature": 0.0,
                "max_tokens": num_predict,
                "stream": false
            });
            if let Some(s) = schema {
                b["response_format"] = json!({
                    "type": "json_schema",
                    "json_schema": { "name": "kinetix_actions", "strict": true, "schema": s }
                });
            }
            (format!("{LLAMACPP}/v1/chat/completions"), b)
        }
    };

    let fut = async {
        let r = c
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Could not reach the local model server: {e}"))?;
        let status = r.status();
        let v: Value = r.json().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            let msg = v["error"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| v.to_string());
            return Err(format!("Model server error: {msg}"));
        }
        Ok::<Value, String>(v)
    };

    let v = tokio::select! {
        _ = cancel.cancelled() => return Err("Cancelled".to_string()),
        r = fut => r?,
    };

    let content = match be {
        Backend::Ollama => v["message"]["content"].as_str(),
        Backend::LlamaCpp => v["choices"][0]["message"]["content"].as_str(),
    };
    content
        .map(|s| s.to_string())
        .ok_or_else(|| "The model returned an empty response".to_string())
}

/// Streams `/api/pull`, reporting aggregated (completed, total) bytes across all layers.
pub async fn pull_stream<F: FnMut(&str, u64, u64)>(
    name: &str,
    cancel: &CancellationToken,
    mut on: F,
) -> Result<(), String> {
    let c = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = c
        .post(format!("{OLLAMA}/api/pull"))
        .json(&json!({ "model": name, "stream": true }))
        .send()
        .await
        .map_err(|_| "Ollama is not running on 127.0.0.1:11434. Start Ollama and try again.".to_string())?;
    if !resp.status().is_success() {
        return Err(format!(
            "Ollama refused the download: {}",
            resp.text().await.unwrap_or_default()
        ));
    }

    let mut stream = Box::pin(resp.bytes_stream());
    let mut buf: Vec<u8> = Vec::new();
    let mut layers: HashMap<String, (u64, u64)> = HashMap::new();
    loop {
        let next = tokio::select! {
            _ = cancel.cancelled() => return Err("Download cancelled".to_string()),
            n = stream.next() => n,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            if let Ok(v) = serde_json::from_slice::<Value>(&line) {
                if let Some(e) = v["error"].as_str() {
                    return Err(e.to_string());
                }
                let status = v["status"].as_str().unwrap_or("");
                if let Some(d) = v["digest"].as_str() {
                    let total = v["total"].as_u64().unwrap_or(0);
                    let done = v["completed"].as_u64().unwrap_or(0);
                    if total > 0 {
                        layers.insert(d.to_string(), (done, total));
                    }
                }
                let (c_sum, t_sum) = layers.values().fold((0u64, 0u64), |a, b| (a.0 + b.0, a.1 + b.1));
                on(status, c_sum, t_sum);
            }
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ .gguf registration */

fn modelfile_text(path: &str, template: &str) -> String {
    let p = path.replace('\\', "/");
    let from = if p.contains(' ') { format!("FROM \"{p}\"") } else { format!("FROM {p}") };
    let mut s = format!("{from}\nPARAMETER num_ctx 1024\nPARAMETER temperature 0\n");
    match template {
        "chatml" => s.push_str(
            r#"TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ .Response }}<|im_end|>
"""
PARAMETER stop "<|im_start|>"
PARAMETER stop "<|im_end|>"
"#,
        ),
        "llama3" => s.push_str(
            r#"TEMPLATE """<|start_header_id|>system<|end_header_id|>

{{ .System }}<|eot_id|><|start_header_id|>user<|end_header_id|>

{{ .Prompt }}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

{{ .Response }}<|eot_id|>"""
PARAMETER stop "<|eot_id|>"
"#,
        ),
        _ => {}
    }
    s
}

/// Generates a Modelfile for the chosen .gguf and registers it with Ollama (CLI first, HTTP API as fallback).
pub async fn register_gguf(dir: &Path, path: &str, name: &str, template: &str) -> Result<String, String> {
    let p = Path::new(path);
    let is_gguf = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("gguf"))
        .unwrap_or(false);
    if !p.exists() || !is_gguf {
        return Err("Pick an existing .gguf file".to_string());
    }
    let mf = modelfile_text(path, template);
    let mf_path = dir.join(format!("Modelfile.{name}"));
    std::fs::write(&mf_path, &mf).map_err(|e| e.to_string())?;

    let name_c = name.to_string();
    let mf_c = mf_path.clone();
    let cli = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("ollama");
        cmd.arg("create").arg(&name_c).arg("-f").arg(&mf_c);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);
        cmd.output()
    })
    .await
    .map_err(|e| e.to_string())?;

    let cli_err = match cli {
        Ok(o) if o.status.success() => return Ok(name.to_string()),
        Ok(o) => String::from_utf8_lossy(&o.stderr).trim().to_string(),
        Err(e) => e.to_string(),
    };

    // Fallback: older Ollama builds accept the Modelfile text over HTTP.
    let c = client(600)?;
    let api_err = match c
        .post(format!("{OLLAMA}/api/create"))
        .json(&json!({ "model": name, "modelfile": mf, "stream": false }))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => return Ok(name.to_string()),
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => e.to_string(),
    };
    Err(format!(
        "Could not register the model. Is Ollama installed and running?\nCLI: {cli_err}\nAPI: {api_err}"
    ))
}
