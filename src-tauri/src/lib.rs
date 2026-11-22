//! Kinetix Studio — native shell.
//! Milestone 1: SQLite (WAL) persistence, asset store, undo stack, dialog plugin.
//! Milestone 2: `ai` module — Ollama / llama.cpp client, Pre-LLM gatekeeper, ripple engine, idle compactor.
//! Milestone 4: `export` module — deterministic frame-by-frame exporter (PNG sequence / GIF / MP4 via FFmpeg).

mod ai;
mod commands;
mod db;
mod export;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            // Non-blocking startup: the window paints first, everything below runs off the main thread.
            let database = db::Db::open_deferred(&dir)?;
            app.manage(database);
            app.manage(ai::AiState::new());
            app.manage(export::ExportManager::new());
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                handle.state::<db::Db>().conn.init(); // WAL switch + schema (commands wait on this gate)
                export::purge_stale_temp();
                ai::compactor::spawn(handle.clone());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::is_first_launch,
            commands::mark_launched,
            commands::save_project,
            commands::load_project,
            commands::latest_project,
            commands::save_asset,
            commands::list_assets,
            commands::read_asset_data_url,
            commands::undo_push,
            commands::undo_pop,
            commands::redo_pop,
            ai::commands::ai_touch,
            ai::commands::ai_status,
            ai::commands::ai_set_model,
            ai::commands::ai_preview,
            ai::commands::ai_run,
            ai::commands::ai_cancel,
            ai::commands::ai_pull,
            ai::commands::ai_pull_progress,
            ai::commands::ai_pull_cancel,
            ai::commands::ai_register_gguf,
            ai::commands::ai_log,
            export::export_probe_ffmpeg,
            export::export_start,
            export::export_write_frame,
            export::export_progress,
            export::export_cancel,
            export::export_finish,
            export::export_write_text,
            export::export_write_base64,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kinetix Studio")
        .run(|app, event| {
            // Closing the window mid-export must not leave ffmpeg running or temp files behind.
            if let tauri::RunEvent::Exit = event {
                app.state::<export::ExportManager>().cancel_all();
            }
        });
}
