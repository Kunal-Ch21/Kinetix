-- Kinetix Studio — SQLite schema (WAL mode is enabled in db.rs before this runs).
-- All times are stored in integer milliseconds so keyframe math is exact.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  json       TEXT NOT NULL,                 -- full project document (assets stripped of pixel data)
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Cast roster: every top-level object. `aliases` is a comma-separated synonym list used by the
-- Milestone-2 fuzzy matcher and the hard duplicate lock.
CREATE TABLE IF NOT EXISTS objects (
  id         TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  aliases    TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL,
  z_index    INTEGER NOT NULL DEFAULT 0,
  x          REAL NOT NULL DEFAULT 50,
  y          REAL NOT NULL DEFAULT 50,
  rotation   REAL NOT NULL DEFAULT 0,
  scale      REAL NOT NULL DEFAULT 1,
  blueprint  TEXT NOT NULL,                 -- object JSON minus tracks
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_objects_label ON objects(project_id, label COLLATE NOCASE);

-- Parent-child rig: every non-root node (limbs, armor, attached props...) with local offsets.
CREATE TABLE IF NOT EXISTS parts (
  id         TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id  TEXT NOT NULL,                 -- object id or another part id
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  z_index    INTEGER NOT NULL DEFAULT 0,
  dx         REAL NOT NULL DEFAULT 0,
  dy         REAL NOT NULL DEFAULT 0,
  pivot_x    REAL NOT NULL DEFAULT 0,
  pivot_y    REAL NOT NULL DEFAULT 0,
  rotation   REAL NOT NULL DEFAULT 0,
  scale      REAL NOT NULL DEFAULT 1,
  blueprint  TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_parts_parent ON parts(project_id, parent_id);

-- Temporal slicing index: the gatekeeper reads ONLY the keyframe active at the playhead.
CREATE TABLE IF NOT EXISTS keyframes (
  id         TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id   TEXT NOT NULL,                 -- object or part id
  channel    TEXT NOT NULL,                 -- track prop: x | y | rotation | scale | opacity | morph | glow | rim
  track_name TEXT,
  t_ms       INTEGER NOT NULL,
  value_json TEXT NOT NULL,
  ease_json  TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_kf_time ON keyframes(project_id, owner_id, channel, t_ms);

-- Semantic Story Event Index: "ev_02 | 3.5s-5.5s | Mid-Air Morph"
CREATE TABLE IF NOT EXISTS story_events (
  id         TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER NOT NULL,
  title      TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_events_time ON story_events(project_id, start_ms);

-- Imported sprites/images. Pixels live on disk in <app-data>/assets, metadata lives here.
CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '',
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  bbox_json  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  file_name  TEXT NOT NULL,
  file_path  TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Row-level undo/redo snapshots. `snapshot` = state BEFORE the edit, `redo_snapshot` = state AFTER (filled on undo).
CREATE TABLE IF NOT EXISTS undo_stack (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT NOT NULL,
  label         TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'undo' CHECK (state IN ('undo','redo')),
  snapshot      TEXT NOT NULL,
  redo_snapshot TEXT,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_undo_project ON undo_stack(project_id, state, seq);

-- Activity log (input for the Milestone-2 lazy idle compactor; summarised only after >20 s idle).
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  line       TEXT NOT NULL,
  compacted  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Scene lights / particle emitters (Milestone 3 scene model). Light tracks live in `keyframes` (owner_id = light id).
CREATE TABLE IF NOT EXISTS lights (
  id         TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL,                 -- point | spot | sun
  blueprint  TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE TABLE IF NOT EXISTS emitters (
  id         TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL,                 -- embers | sparks | mist | rain | snow | trail
  blueprint  TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
