//! Tauri commands for Milestone 2 (JS camelCase args map to snake_case automatically).

use super::{gatekeeper, llm, ripple, schema, AiState, PullInfo};
use crate::db::Db;
use rusqlite::params;
use serde_json::{json, Value};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;

type Res<T> = Result<T, String>;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Any user input: reset the idle clock + pre-empt background compaction.
#[tauri::command]
pub fn ai_touch(ai: State<'_, AiState>) {
    ai.touch();
}

#[tauri::command]
pub async fn ai_status(db: State<'_, Db>) -> Res<Value> {
    let pref = llm::preferred_model(&db);
    let models = llm::list_models().await;
    let ollama_up = models.is_some();
    let list = models.unwrap_or_default();
    let llamacpp = if list.is_empty() { llm::llamacpp_alive().await } else { false };

    let (backend, model, shown): (&str, Option<String>, Vec<String>) = if !list.is_empty() {
        let m = pref.filter(|p| list.contains(p)).unwrap_or_else(|| list[0].clone());
        ("ollama", Some(m), list)
    } else if llamacpp {
        ("llamacpp", Some("llama.cpp".to_string()), vec!["llama.cpp".to_string()])
    } else {
        ("none", None, list)
    };

    Ok(json!({
        "native": true,
        "running": ollama_up || llamacpp,
        "backend": backend,
        "models": shown,
        "model": model,
    }))
}

#[tauri::command]
pub fn ai_set_model(db: State<'_, Db>, name: String) -> Res<()> {
    let conn = db.conn.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO meta(key,value) VALUES('ai_model',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![name],
    )
    .map_err(err)?;
    Ok(())
}

/// Live Micro-Context Token Inspector payload — exactly what `ai_run` would send (minus nothing).
#[tauri::command]
pub fn ai_preview(
    db: State<'_, Db>,
    project_id: String,
    selection: Vec<String>,
    time: f64,
    prompt: String,
) -> Res<Value> {
    let conn = db.conn.lock().map_err(err)?;
    let built = gatekeeper::build(&conn, &project_id, &selection, time, &prompt);
    let summary: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key=?1",
            params![format!("summary:{project_id}")],
            |r| r.get(0),
        )
        .ok();
    Ok(built.to_json(summary))
}

/// Natural language -> constrained JSON -> deterministic ops. Stateless, single turn.
#[tauri::command]
pub async fn ai_run(
    db: State<'_, Db>,
    ai: State<'_, AiState>,
    project_id: String,
    selection: Vec<String>,
    time: f64,
    prompt: String,
) -> Res<Value> {
    ai.touch();
    if prompt.trim().is_empty() {
        return Err("Empty prompt".to_string());
    }
    let pref = llm::preferred_model(&db);
    let (backend, model) = llm::active_model(pref)
        .await
        .ok_or_else(|| "NO_MODEL".to_string())?;
    let started = Instant::now();

    // 1. Pre-LLM gatekeeper (SQLite) — no await while the DB lock is held.
    let built = {
        let conn = db.conn.lock().map_err(err)?;
        gatekeeper::build(&conn, &project_id, &selection, time, &prompt)
    };

    // 2. Isolated 2-message call with schema-constrained decoding.
    let cancel = CancellationToken::new();
    if let Ok(mut c) = ai.run_cancel.lock() {
        *c = cancel.clone();
    }
    let raw = llm::chat_content(
        backend,
        &model,
        &built.system,
        &built.user,
        Some(&schema::action_schema()),
        &cancel,
        400,
    )
    .await?;
    let parsed: Value =
        serde_json::from_str(&raw).map_err(|e| format!("Model returned invalid JSON ({e})"))?;
    let actions: Vec<Value> = parsed
        .get("ops")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    // 3. Deterministic relative math + ripple + duplicate lock.
    let resolved = {
        let conn = db.conn.lock().map_err(err)?;
        let cast = gatekeeper::load_cast(&conn, &project_id);
        let (duration, fps) = gatekeeper::project_meta(&conn, &project_id);
        let events = gatekeeper::load_events(&conn, &project_id);
        let ctx = ripple::Ctx {
            conn: &conn,
            pid: &project_id,
            cast: &cast,
            selection: &selection,
            time,
            duration,
            fps,
            events,
        };
        let r = ripple::resolve(&ctx, &actions);
        let n_ops = r["ops"].as_array().map(|a| a.len()).unwrap_or(0);
        let line = format!("{} -> {} ops", cut(prompt.trim(), 80), n_ops);
        let _ = conn.execute(
            "INSERT INTO activity_log(project_id,line) VALUES(?1,?2)",
            params![project_id, line],
        );
        r
    };

    Ok(json!({
        "ops": resolved["ops"],
        "blocked": resolved["blocked"],
        "notes": resolved["notes"],
        "raw": parsed,
        "tokens": built.tokens,
        "ms": started.elapsed().as_millis() as u64,
        "model": model,
    }))
}

#[tauri::command]
pub fn ai_cancel(ai: State<'_, AiState>) {
    if let Ok(c) = ai.run_cancel.lock() {
        c.cancel();
    }
}

/* ------------------------------------------------------------------ model manager */

#[tauri::command]
pub async fn ai_pull(app: AppHandle, ai: State<'_, AiState>, name: String) -> Res<()> {
    ai.touch();
    let name = name.trim().to_string();
    if name.is_empty()
        || name.len() > 80
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c))
    {
        return Err("Invalid model name".to_string());
    }
    if ai.pull.lock().map_err(err)?.active {
        return Err("A download is already running".to_string());
    }
    {
        let mut p = ai.pull.lock().map_err(err)?;
        *p = PullInfo {
            name: name.clone(),
            status: "starting".to_string(),
            active: true,
            ..Default::default()
        };
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        run_pull(app2, name).await;
    });
    Ok(())
}

async fn run_pull(app: AppHandle, name: String) {
    let st = app.state::<AiState>();
    let cancel = CancellationToken::new();
    if let Ok(mut c) = st.pull_cancel.lock() {
        *c = cancel.clone();
    }
    let res = llm::pull_stream(&name, &cancel, |status, done, total| {
        if let Ok(mut p) = st.pull.lock() {
            p.status = status.to_string();
            p.completed = done;
            p.total = total;
        }
    })
    .await;
    let guard = st.pull.lock();
    if let Ok(mut p) = guard {
        p.active = false;
        match res {
            Ok(()) => {
                p.done = true;
                p.status = "success".to_string();
                p.error = None;
            }
            Err(e) => {
                p.done = false;
                p.error = Some(e);
            }
        }
    }
}

#[tauri::command]
pub fn ai_pull_progress(ai: State<'_, AiState>) -> Res<PullInfo> {
    Ok(ai.pull.lock().map_err(err)?.clone())
}

#[tauri::command]
pub fn ai_pull_cancel(ai: State<'_, AiState>) {
    if let Ok(c) = ai.pull_cancel.lock() {
        c.cancel();
    }
}

fn sanitize_name(name: &str, path: &str) -> String {
    let src = if name.trim().is_empty() {
        let stem = std::path::Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("model");
        format!("kinetix-{stem}")
    } else {
        name.trim().to_string()
    };
    let cleaned: String = src
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '-' })
        .take(48)
        .collect();
    if cleaned.is_empty() {
        "kinetix-model".to_string()
    } else {
        cleaned
    }
}

/// Bring-your-own-model: generates a Modelfile for a user-picked .gguf and registers it with Ollama.
#[tauri::command]
pub async fn ai_register_gguf(
    app: AppHandle,
    db: State<'_, Db>,
    ai: State<'_, AiState>,
    path: String,
    name: String,
    template: String,
) -> Res<String> {
    ai.touch();
    let name = sanitize_name(&name, &path);
    let dir = app.path().app_data_dir().map_err(err)?;
    let registered = llm::register_gguf(&dir, &path, &name, &template).await?;
    if let Ok(conn) = db.conn.lock() {
        let _ = conn.execute(
            "INSERT INTO meta(key,value) VALUES('ai_model',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![registered],
        );
    }
    Ok(registered)
}

/// Appends one line to the activity log (input for the idle compactor).
#[tauri::command]
pub fn ai_log(db: State<'_, Db>, project_id: String, line: String) -> Res<()> {
    let conn = db.conn.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO activity_log(project_id,line) VALUES(?1,?2)",
        params![project_id, cut(&line, 200)],
    )
    .map_err(err)?;
    Ok(())
}
