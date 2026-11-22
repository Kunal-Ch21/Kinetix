//! Lazy async compaction.
//! Summarises the activity log ONLY after the user has been idle for more than 20 seconds.
//! Every new user input calls `AiState::touch()`, which cancels the token used here, so a running
//! summarisation is pre-empted immediately and never competes with interactive work.

use super::{llm, AiState, IDLE_SECS};
use crate::db::Db;
use rusqlite::params;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Compaction is only allowed after MORE than `IDLE_SECS` seconds without user input.
pub fn is_idle(elapsed: Duration) -> bool {
    elapsed > Duration::from_secs(IDLE_SECS)
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(4)).await;
            tick(&app).await;
        }
    });
}

async fn tick(app: &AppHandle) {
    let st = app.state::<AiState>();
    let db = app.state::<Db>();

    let idle = match st.last_input.lock() {
        Ok(t) => t.elapsed(),
        Err(_) => return,
    };
    if !is_idle(idle) {
        return;
    }

    // Pick one project that has enough un-compacted log lines.
    let batch: Option<(String, Vec<(i64, String)>)> = {
        let Ok(conn) = db.conn.lock() else { return };
        let pid: Option<String> = conn
            .query_row(
                "SELECT project_id FROM activity_log WHERE compacted=0 GROUP BY project_id HAVING COUNT(*)>=3 LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok();
        let found = match pid {
            None => None,
            Some(pid) => {
                let mut rows: Vec<(i64, String)> = Vec::new();
                if let Ok(mut stmt) = conn.prepare(
                    "SELECT id,line FROM activity_log WHERE project_id=?1 AND compacted=0 ORDER BY id LIMIT 40",
                ) {
                    if let Ok(it) = stmt.query_map(params![pid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))) {
                        rows.extend(it.flatten());
                    }
                }
                Some((pid, rows))
            }
        };
        found
    };
    let Some((pid, rows)) = batch else { return };
    if rows.len() < 3 {
        return;
    }

    // Publish a fresh cancellation token, then re-check idleness (closes the race with a just-arrived input).
    let token = CancellationToken::new();
    if let Ok(mut c) = st.compact_cancel.lock() {
        *c = token.clone();
    }
    if let Ok(t) = st.last_input.lock() {
        if !is_idle(t.elapsed()) {
            return;
        }
    }

    let lines: Vec<String> = rows.iter().map(|r| r.1.clone()).collect();
    let summary = summarize(&db, &lines, &token).await;
    if token.is_cancelled() {
        return;
    }
    if let Some(s) = summary {
        if let Ok(conn) = db.conn.lock() {
            let _ = conn.execute(
                "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![format!("summary:{pid}"), s],
            );
            let ids = rows.iter().map(|r| r.0.to_string()).collect::<Vec<_>>().join(",");
            let _ = conn.execute(&format!("UPDATE activity_log SET compacted=1 WHERE id IN ({ids})"), []);
        }
    }
}

async fn summarize(db: &Db, lines: &[String], token: &CancellationToken) -> Option<String> {
    if token.is_cancelled() || lines.is_empty() {
        return None;
    }
    let fallback = format!(
        "{} edits logged. First: {} Last: {}",
        lines.len(),
        cut(&lines[0], 60),
        cut(&lines[lines.len() - 1], 60)
    );
    let pref = llm::preferred_model(db);
    let Some((be, model)) = llm::active_model(pref).await else {
        return Some(fallback);
    };
    if token.is_cancelled() {
        return None;
    }
    let joined = lines.iter().map(|l| cut(l, 100)).collect::<Vec<_>>().join("\n");
    match llm::chat_content(
        be,
        &model,
        "Summarize these edit-log lines in ONE sentence of at most 25 words. Output plain text only.",
        &joined,
        None,
        token,
        64,
    )
    .await
    {
        Ok(s) if !s.trim().is_empty() => Some(cut(s.trim(), 220)),
        _ => {
            if token.is_cancelled() {
                None
            } else {
                Some(fallback)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_more_than_twenty_seconds_idle_counts() {
        assert!(!is_idle(Duration::from_secs(0)));
        assert!(!is_idle(Duration::from_secs(19)));
        assert!(!is_idle(Duration::from_secs(20)));
        assert!(is_idle(Duration::from_millis(20_001)));
    }

    #[test]
    fn user_input_cancels_a_running_compaction_immediately() {
        let st = AiState::new();
        let running = st.compact_cancel.lock().unwrap().clone();
        assert!(!running.is_cancelled());
        st.touch();
        assert!(running.is_cancelled(), "touch() must pre-empt the in-flight compaction token");
        // and the idle clock was reset
        assert!(st.last_input.lock().unwrap().elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn summarize_is_preempted_by_a_cancelled_token() {
        let dir = std::env::temp_dir().join(format!("kinetix-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = Db::open(&dir).unwrap();
        let lines: Vec<String> = (0..4).map(|i| format!("edit {i}")).collect();

        let live = CancellationToken::new();
        let done = summarize(&db, &lines, &live).await;
        assert!(done.is_some(), "an un-cancelled run produces a summary (model or fallback)");

        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert_eq!(summarize(&db, &lines, &cancelled).await, None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
