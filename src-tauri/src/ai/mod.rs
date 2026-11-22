//! Milestone 2 — zero-bloat local AI pipeline.
//!
//! * `llm`        – HTTP client for Ollama / llama.cpp (127.0.0.1 only), model pull, .gguf registration
//! * `gatekeeper` – Pre-LLM SQLite gatekeeper (cast roster, fuzzy aliases, slicing, minifier)
//! * `ripple`     – deterministic relative-math / ripple engine + duplicate lock
//! * `schema`     – compact system rules + JSON-Schema used for constrained decoding
//! * `compactor`  – lazy idle (>20 s) activity-log summariser with cancellation
//! * `commands`   – Tauri commands exposed to the front-end

pub mod commands;
pub mod compactor;
pub mod gatekeeper;
pub mod llm;
pub mod ripple;
pub mod schema;

use serde::Serialize;
use std::{sync::Mutex, time::Instant};
use tokio_util::sync::CancellationToken;

/// Background compaction only starts after this much user idle time.
pub const IDLE_SECS: u64 = 20;

#[derive(Clone, Default, Serialize)]
pub struct PullInfo {
    pub name: String,
    pub status: String,
    pub completed: u64,
    pub total: u64,
    pub active: bool,
    pub done: bool,
    pub error: Option<String>,
}

pub struct AiState {
    pub last_input: Mutex<Instant>,
    pub compact_cancel: Mutex<CancellationToken>,
    pub run_cancel: Mutex<CancellationToken>,
    pub pull_cancel: Mutex<CancellationToken>,
    pub pull: Mutex<PullInfo>,
}

impl AiState {
    pub fn new() -> Self {
        Self {
            last_input: Mutex::new(Instant::now()),
            compact_cancel: Mutex::new(CancellationToken::new()),
            run_cancel: Mutex::new(CancellationToken::new()),
            pull_cancel: Mutex::new(CancellationToken::new()),
            pull: Mutex::new(PullInfo::default()),
        }
    }

    /// Any user input: reset the idle clock and pre-empt a running compaction immediately.
    pub fn touch(&self) {
        if let Ok(mut t) = self.last_input.lock() {
            *t = Instant::now();
        }
        if let Ok(c) = self.compact_cancel.lock() {
            c.cancel();
        }
    }
}
