//! SQLite persistence layer (WAL mode, bundled engine).
//!
//! Startup is non-blocking: `Db::open_deferred` only opens the file handle (microseconds) so the window can
//! paint immediately; the WAL switch, pragmas and schema run on a background thread (`GatedConn::init`).
//! Every command goes through `GatedConn::lock`, which waits (briefly) until that init finished, so a command
//! can never observe a half-initialised database.

use rusqlite::Connection;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Condvar, LockResult, Mutex, MutexGuard},
};

pub const SCHEMA: &str = include_str!("schema.sql");

pub struct GatedConn {
    inner: Mutex<Connection>,
    ready: Mutex<bool>,
    cv: Condvar,
}

impl GatedConn {
    fn new(conn: Connection) -> Self {
        Self { inner: Mutex::new(conn), ready: Mutex::new(false), cv: Condvar::new() }
    }

    fn mark_ready(&self) {
        let mut r = self.ready.lock().unwrap_or_else(|e| e.into_inner());
        *r = true;
        self.cv.notify_all();
    }

    /// Same signature as `Mutex::lock`, but blocks until the deferred initialisation has completed.
    pub fn lock(&self) -> LockResult<MutexGuard<'_, Connection>> {
        {
            let mut r = self.ready.lock().unwrap_or_else(|e| e.into_inner());
            while !*r {
                r = self.cv.wait(r).unwrap_or_else(|e| e.into_inner());
            }
        }
        self.inner.lock()
    }

    /// WAL + pragmas + schema. Always releases waiting commands, even if it fails (the error is logged).
    pub fn init(&self) {
        let res = (|| -> rusqlite::Result<()> {
            let conn = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "synchronous", "NORMAL")?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            conn.pragma_update(None, "temp_store", "MEMORY")?;
            conn.pragma_update(None, "busy_timeout", 3000)?;
            conn.execute_batch(SCHEMA)?;
            Ok(())
        })();
        if let Err(e) = res {
            eprintln!("[kinetix] database init failed: {e}");
        }
        self.mark_ready();
    }
}

pub struct Db {
    pub conn: GatedConn,
    pub assets_dir: PathBuf,
}

impl Db {
    /// Opens `<dir>/kinetix.db` WITHOUT touching the schema. Call `conn.init()` (off the main thread).
    pub fn open_deferred(dir: &Path) -> rusqlite::Result<Self> {
        let assets_dir = dir.join("assets");
        let _ = fs::create_dir_all(&assets_dir);
        let conn = Connection::open(dir.join("kinetix.db"))?;
        Ok(Self { conn: GatedConn::new(conn), assets_dir })
    }

    /// Opens (creating if necessary) `<dir>/kinetix.db`, switches it to WAL and applies the schema (blocking).
    #[allow(dead_code)]
    pub fn open(dir: &Path) -> rusqlite::Result<Self> {
        let db = Self::open_deferred(dir)?;
        db.conn.init();
        Ok(db)
    }
}
