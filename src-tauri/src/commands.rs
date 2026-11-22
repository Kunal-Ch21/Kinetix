//! Tauri commands exposed to the TypeScript front-end.
//! Naming: JS camelCase arguments are mapped to snake_case automatically by Tauri v2.

use crate::db::Db;
use base64::Engine;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use tauri::State;

type Res<T> = Result<T, String>;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

fn f(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(|x| x.as_f64()).unwrap_or(default)
}

/* ---------------------------------------------------------------- launch flag */

#[tauri::command]
pub fn is_first_launch(db: State<Db>) -> Res<bool> {
    let conn = db.conn.lock().map_err(err)?;
    let v: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key='launched'", [], |r| r.get(0))
        .optional()
        .map_err(err)?;
    Ok(v.is_none())
}

#[tauri::command]
pub fn mark_launched(db: State<Db>) -> Res<()> {
    let conn = db.conn.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO meta(key,value) VALUES('launched','1') ON CONFLICT(key) DO NOTHING",
        [],
    )
    .map_err(err)?;
    Ok(())
}

/* ---------------------------------------------------------------- projects */

/// Upserts the project document and re-projects the Scene (`objects` / `lights` / `emitters` / `events` /
/// `tracks`) into the normalised tables that the Pre-LLM gatekeeper queries.
#[tauri::command]
pub fn save_project(db: State<Db>, id: String, name: String, json: String) -> Res<()> {
    let mut conn = db.conn.lock().map_err(err)?;
    store_project(&mut conn, &id, &name, &json)
}

/// Comma-joins a JSON string array (`aliases` / `tags`).
fn joined(n: &Value, key: &str) -> String {
    match n.get(key) {
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", "),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

fn without_tracks(n: &Value) -> String {
    let mut bp = n.clone();
    if let Some(o) = bp.as_object_mut() {
        o.remove("tracks");
    }
    bp.to_string()
}

fn project_tracks(tx: &rusqlite::Transaction, pid: &str, owner: &str, n: &Value) -> Res<()> {
    let Some(tracks) = n.get("tracks").and_then(|t| t.as_array()) else { return Ok(()) };
    for tr in tracks {
        let prop = s(tr, "prop");
        let Some(keys) = tr.get("keys").and_then(|k| k.as_array()) else { continue };
        for (i, k) in keys.iter().enumerate() {
            tx.execute(
                "INSERT OR REPLACE INTO keyframes(id,project_id,owner_id,channel,track_name,t_ms,value_json,ease_json)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    format!("{owner}:{prop}:{i}"),
                    pid,
                    owner,
                    prop,
                    prop,
                    (f(k, "t", 0.0) * 1000.0).round() as i64,
                    k.get("v").map(|v| v.to_string()).unwrap_or_else(|| "0".into()),
                    k.get("ease").map(|v| v.to_string()).unwrap_or_else(|| "\"ease_in_out\"".into())
                ],
            )
            .map_err(err)?;
        }
    }
    Ok(())
}

/// Pure-SQLite half of `save_project` (also used by the unit tests).
pub fn store_project(conn: &mut rusqlite::Connection, id: &str, name: &str, json: &str) -> Res<()> {
    let doc: Value = serde_json::from_str(json).map_err(err)?;
    let tx = conn.transaction().map_err(err)?;

    tx.execute(
        "INSERT INTO projects(id,name,json,updated_at) VALUES(?1,?2,?3,strftime('%s','now'))
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, json=excluded.json, updated_at=excluded.updated_at",
        params![id, name, json],
    )
    .map_err(err)?;

    for table in ["objects", "parts", "keyframes", "story_events", "lights", "emitters"] {
        tx.execute(&format!("DELETE FROM {table} WHERE project_id=?1"), params![id])
            .map_err(err)?;
    }

    if let Some(objs) = doc.get("objects").and_then(|n| n.as_array()) {
        for (z, n) in objs.iter().enumerate() {
            let nid = s(n, "id");
            let blueprint = without_tracks(n);
            match n.get("parent").and_then(|p| p.as_str()) {
                None => {
                    tx.execute(
                        "INSERT INTO objects(id,project_id,label,aliases,tags,kind,z_index,x,y,rotation,scale,blueprint)
                         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                        params![
                            nid, id, s(n, "label"), joined(n, "aliases"), joined(n, "tags"), s(n, "kind"), z as i64,
                            f(n, "x", 50.0), f(n, "y", 50.0), f(n, "rotation", 0.0), f(n, "scale", 1.0), blueprint
                        ],
                    )
                    .map_err(err)?;
                }
                Some(pid) => {
                    tx.execute(
                        "INSERT INTO parts(id,project_id,parent_id,label,kind,z_index,dx,dy,pivot_x,pivot_y,rotation,scale,blueprint)
                         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                        params![
                            nid, id, pid, s(n, "label"), s(n, "kind"), z as i64,
                            f(n, "x", 0.0), f(n, "y", 0.0), f(n, "pivotX", 0.0), f(n, "pivotY", 0.0),
                            f(n, "rotation", 0.0), f(n, "scale", 1.0), blueprint
                        ],
                    )
                    .map_err(err)?;
                }
            }
            project_tracks(&tx, id, nid, n)?;
        }
    }

    for (table, key) in [("lights", "lights"), ("emitters", "emitters")] {
        if let Some(items) = doc.get(key).and_then(|n| n.as_array()) {
            for n in items {
                let kind = if table == "lights" { s(n, "type") } else { s(n, "kind") };
                tx.execute(
                    &format!("INSERT INTO {table}(id,project_id,label,kind,blueprint) VALUES(?1,?2,?3,?4,?5)"),
                    params![s(n, "id"), id, s(n, "label"), kind, without_tracks(n)],
                )
                .map_err(err)?;
                project_tracks(&tx, id, s(n, "id"), n)?;
            }
        }
    }

    if let Some(events) = doc.get("events").and_then(|e| e.as_array()) {
        for ev in events {
            tx.execute(
                "INSERT INTO story_events(id,project_id,start_ms,end_ms,title) VALUES(?1,?2,?3,?4,?5)",
                params![
                    s(ev, "id"),
                    id,
                    (f(ev, "start", 0.0) * 1000.0).round() as i64,
                    (f(ev, "end", 0.0) * 1000.0).round() as i64,
                    s(ev, "title")
                ],
            )
            .map_err(err)?;
        }
    }

    tx.commit().map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn load_project(db: State<Db>, id: String) -> Res<Option<String>> {
    let conn = db.conn.lock().map_err(err)?;
    conn.query_row("SELECT json FROM projects WHERE id=?1", params![id], |r| r.get(0))
        .optional()
        .map_err(err)
}

#[tauri::command]
pub fn latest_project(db: State<Db>) -> Res<Option<String>> {
    let conn = db.conn.lock().map_err(err)?;
    conn.query_row("SELECT json FROM projects ORDER BY updated_at DESC LIMIT 1", [], |r| r.get(0))
        .optional()
        .map_err(err)
}

/* ---------------------------------------------------------------- assets */

/// Decodes a `data:` URL, stores the bytes in `<app-data>/assets/<id>.<ext>` and indexes it in SQLite.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn save_asset(
    db: State<Db>,
    id: String,
    label: String,
    tags: String,
    width: i64,
    height: i64,
    mime: String,
    file_name: String,
    data_url: String,
) -> Res<String> {
    let (_, b64) = data_url.split_once(',').ok_or("malformed data URL")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(err)?;

    let ext = match mime.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => "bin",
    };
    let safe_id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    let path = db.assets_dir.join(format!("{safe_id}.{ext}"));
    std::fs::write(&path, bytes).map_err(err)?;
    let path_str = path.to_string_lossy().to_string();

    let bbox = format!("{{\"x\":0,\"y\":0,\"w\":{width},\"h\":{height}}}");
    let conn = db.conn.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO assets(id,label,tags,width,height,bbox_json,mime,file_name,file_path)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET label=excluded.label, tags=excluded.tags, file_path=excluded.file_path",
        params![id, label, tags, width, height, bbox, mime, file_name, path_str],
    )
    .map_err(err)?;
    Ok(path_str)
}

#[tauri::command]
pub fn list_assets(db: State<Db>) -> Res<Vec<Value>> {
    let conn = db.conn.lock().map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id,label,tags,width,height,mime,file_path FROM assets ORDER BY created_at DESC")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "label": r.get::<_, String>(1)?,
                "tags": r.get::<_, String>(2)?,
                "width": r.get::<_, i64>(3)?,
                "height": r.get::<_, i64>(4)?,
                "mime": r.get::<_, String>(5)?,
                "path": r.get::<_, String>(6)?,
            }))
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

/// Returns an asset as a `data:` URL. The exporter decodes sprites from these so the export canvas is never tainted
/// by cross-origin `asset:` images (which would make `getImageData` / `toBlob` throw).
#[tauri::command]
pub fn read_asset_data_url(db: State<Db>, id: String) -> Res<String> {
    let conn = db.conn.lock().map_err(err)?;
    let (mime, path): (String, String) = conn
        .query_row("SELECT mime,file_path FROM assets WHERE id=?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("cannot read asset {id} at {path}: {e}"))?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/* ---------------------------------------------------------------- undo / redo */

const UNDO_CAP: i64 = 500;

/// Pushes the state BEFORE an edit. Any pending redo history is discarded.
#[tauri::command]
pub fn undo_push(db: State<Db>, project_id: String, label: String, snapshot: String) -> Res<()> {
    let conn = db.conn.lock().map_err(err)?;
    push_undo(&conn, &project_id, &label, &snapshot)
}

/// Pops the newest undo row, remembers `current` for redo, and returns the earlier snapshot.
#[tauri::command]
pub fn undo_pop(db: State<Db>, project_id: String, current: String) -> Res<Option<String>> {
    let conn = db.conn.lock().map_err(err)?;
    pop_undo(&conn, &project_id, &current)
}

#[tauri::command]
pub fn redo_pop(db: State<Db>, project_id: String) -> Res<Option<String>> {
    let conn = db.conn.lock().map_err(err)?;
    pop_redo(&conn, &project_id)
}

pub fn push_undo(conn: &rusqlite::Connection, project_id: &str, label: &str, snapshot: &str) -> Res<()> {
    conn.execute("DELETE FROM undo_stack WHERE project_id=?1 AND state='redo'", params![project_id])
        .map_err(err)?;
    conn.execute(
        "INSERT INTO undo_stack(project_id,label,snapshot) VALUES(?1,?2,?3)",
        params![project_id, label, snapshot],
    )
    .map_err(err)?;
    conn.execute(
        "DELETE FROM undo_stack WHERE project_id=?1 AND state='undo' AND seq <=
           (SELECT seq FROM undo_stack WHERE project_id=?1 AND state='undo' ORDER BY seq DESC LIMIT 1 OFFSET ?2)",
        params![project_id, UNDO_CAP],
    )
    .map_err(err)?;
    Ok(())
}

pub fn pop_undo(conn: &rusqlite::Connection, project_id: &str, current: &str) -> Res<Option<String>> {
    let row: Option<(i64, String)> = conn
        .query_row(
            "SELECT seq,snapshot FROM undo_stack WHERE project_id=?1 AND state='undo' ORDER BY seq DESC LIMIT 1",
            params![project_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((seq, snap)) = row {
        conn.execute(
            "UPDATE undo_stack SET state='redo', redo_snapshot=?2 WHERE seq=?1",
            params![seq, current],
        )
        .map_err(err)?;
        return Ok(Some(snap));
    }
    Ok(None)
}

pub fn pop_redo(conn: &rusqlite::Connection, project_id: &str) -> Res<Option<String>> {
    let row: Option<(i64, Option<String>)> = conn
        .query_row(
            "SELECT seq,redo_snapshot FROM undo_stack WHERE project_id=?1 AND state='redo' ORDER BY seq ASC LIMIT 1",
            params![project_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((seq, snap)) = row {
        conn.execute("UPDATE undo_stack SET state='undo' WHERE seq=?1", params![seq])
            .map_err(err)?;
        return Ok(snap);
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    //! Round-trip: the SAME `Scene` document the front-end saves (`Scene.objects / lights / emitters / events / tracks`,
    //! fixture generated from `src/engine/sample.ts`) is projected into the normalised tables, read back out of those
    //! tables, and must equal the original. The gatekeeper then reads the very same rows.
    use super::*;
    use crate::ai::gatekeeper;
    use rusqlite::Connection;
    use serde_json::{json, Map};

    const APEX: &str = include_str!("../tests/fixtures/apex_scene.json");
    const PID: &str = "proj_roundtrip";

    fn open() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::SCHEMA).unwrap();
        conn
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE project_id=?1"), params![PID], |r| r.get(0)).unwrap()
    }

    /// Rebuilds `tracks` for one owner from the `keyframes` table (ordered by time).
    fn tracks_of(conn: &Connection, owner: &str) -> Vec<Value> {
        let mut stmt = conn
            .prepare("SELECT channel,t_ms,value_json,ease_json FROM keyframes WHERE project_id=?1 AND owner_id=?2 ORDER BY rowid")
            .unwrap();
        let rows = stmt
            .query_map(params![PID, owner], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
            })
            .unwrap()
            .map(|r| r.unwrap());
        let mut order: Vec<String> = vec![];
        let mut by: std::collections::HashMap<String, Vec<Value>> = Default::default();
        for (ch, t_ms, v, e) in rows {
            if !by.contains_key(&ch) {
                order.push(ch.clone());
            }
            by.entry(ch).or_default().push(json!({
                "t": t_ms as f64 / 1000.0,
                "v": serde_json::from_str::<Value>(&v).unwrap(),
                "ease": serde_json::from_str::<Value>(&e).unwrap()
            }));
        }
        order.into_iter().map(|ch| json!({ "prop": ch.clone(), "keys": by.remove(&ch).unwrap() })).collect()
    }

    fn blueprint_with_tracks(conn: &Connection, table: &str, id: &str) -> Value {
        let bp: String = conn
            .query_row(&format!("SELECT blueprint FROM {table} WHERE project_id=?1 AND id=?2"), params![PID, id], |r| r.get(0))
            .unwrap();
        let mut v: Value = serde_json::from_str(&bp).unwrap();
        if table != "emitters" {
            // emitters have no `tracks` field in the Scene model
            v.as_object_mut().unwrap().insert("tracks".into(), Value::Array(tracks_of(conn, id)));
        }
        v
    }

    /// Numbers compare as f64 (1 == 1.0); a missing `ease` in the original matches the stored default.
    fn same(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() < 1e-9,
            (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
            (Value::Object(x), Value::Object(y)) => {
                let keys = |m: &Map<String, Value>| m.keys().filter(|k| *k != "ease").cloned().collect::<std::collections::BTreeSet<_>>();
                keys(x) == keys(y)
                    && keys(x).iter().all(|k| same(&x[k], &y[k]))
                    && (x.get("ease").is_none() || y.get("ease").is_none() || same(&x["ease"], &y["ease"]))
            }
            _ => a == b,
        }
    }

    #[test]
    fn scene_round_trips_through_objects_parts_keyframes_and_story_events() {
        let mut conn = open();
        let doc: Value = serde_json::from_str(APEX).unwrap();
        store_project(&mut conn, PID, "Apex Morph", APEX).unwrap();

        // 1. the project document loads back byte-identical
        let stored: String = conn.query_row("SELECT json FROM projects WHERE id=?1", params![PID], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(), doc);
        assert_eq!(stored, APEX);

        // 2. row counts == Scene shape
        let objs = doc["objects"].as_array().unwrap();
        let roots = objs.iter().filter(|o| o["parent"].is_null()).count() as i64;
        let parts = objs.len() as i64 - roots;
        assert_eq!((count(&conn, "objects"), count(&conn, "parts")), (roots, parts));
        assert!(roots >= 1 && parts >= 1, "fixture must exercise both tables");
        assert_eq!(count(&conn, "lights"), doc["lights"].as_array().unwrap().len() as i64);
        assert_eq!(count(&conn, "emitters"), doc["emitters"].as_array().unwrap().len() as i64);
        assert_eq!(count(&conn, "story_events"), doc["events"].as_array().unwrap().len() as i64);
        let keys_in = |items: &Vec<Value>| -> i64 {
            items.iter().flat_map(|o| o["tracks"].as_array().cloned().unwrap_or_default()).map(|t| t["keys"].as_array().unwrap().len() as i64).sum()
        };
        let expected_keys = keys_in(objs) + keys_in(doc["lights"].as_array().unwrap()) + keys_in(doc["emitters"].as_array().unwrap());
        assert_eq!(count(&conn, "keyframes"), expected_keys);

        // 3. every object (root AND part), light, emitter and event is rebuilt from the tables identical to the Scene
        for o in objs {
            let id = o["id"].as_str().unwrap();
            let table = if o["parent"].is_null() { "objects" } else { "parts" };
            let back = blueprint_with_tracks(&conn, table, id);
            assert!(same(o, &back), "{id} differs after round-trip\nwas: {o}\nnow: {back}");
        }
        for (key, table) in [("lights", "lights"), ("emitters", "emitters")] {
            for n in doc[key].as_array().unwrap() {
                let back = blueprint_with_tracks(&conn, table, n["id"].as_str().unwrap());
                assert!(same(n, &back), "{table} {} differs: {back}", n["id"]);
            }
        }
        for ev in doc["events"].as_array().unwrap() {
            let (s, e, title): (i64, i64, String) = conn
                .query_row("SELECT start_ms,end_ms,title FROM story_events WHERE project_id=?1 AND id=?2", params![PID, ev["id"].as_str().unwrap()], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap();
            assert_eq!((s as f64 / 1000.0, e as f64 / 1000.0, title.as_str()), (ev["start"].as_f64().unwrap(), ev["end"].as_f64().unwrap(), ev["title"].as_str().unwrap()));
        }

        // 4. the part rows carry the rig offsets the renderer reads (parent_id, dx/dy, pivot)
        for o in objs.iter().filter(|o| !o["parent"].is_null()) {
            let (parent, dx, dy): (String, f64, f64) = conn
                .query_row("SELECT parent_id,dx,dy FROM parts WHERE project_id=?1 AND id=?2", params![PID, o["id"].as_str().unwrap()], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap();
            assert_eq!(parent, o["parent"].as_str().unwrap());
            assert_eq!((dx, dy), (o["x"].as_f64().unwrap(), o["y"].as_f64().unwrap()));
        }

        // 5. saving again (autosave) replaces rows instead of duplicating them
        store_project(&mut conn, PID, "Apex Morph", APEX).unwrap();
        assert_eq!(count(&conn, "keyframes"), expected_keys);
        assert_eq!(count(&conn, "objects"), roots);
    }

    #[test]
    fn gatekeeper_reads_the_same_rows_the_front_end_saved() {
        let mut conn = open();
        store_project(&mut conn, PID, "Apex Morph", APEX).unwrap();
        let doc: Value = serde_json::from_str(APEX).unwrap();

        let cast = gatekeeper::load_cast(&conn, PID);
        let roots: Vec<&Value> = doc["objects"].as_array().unwrap().iter().filter(|o| o["parent"].is_null()).collect();
        assert_eq!(cast.len(), roots.len());
        assert!(cast.iter().any(|c| c.id == "asset_03" && c.label == "Peregrine Falcon"));
        let (i, _) = gatekeeper::best_cast(&cast, "the falcon").unwrap();
        assert_eq!(cast[i].id, "asset_03");

        let events = gatekeeper::load_events(&conn, PID);
        assert_eq!(events.len(), doc["events"].as_array().unwrap().len());
        let (duration, fps) = gatekeeper::project_meta(&conn, PID);
        assert_eq!((duration, fps), (doc["duration"].as_f64().unwrap(), doc["fps"].as_f64().unwrap()));

        // temporal slice: a child part (parts table) and its keyframes are reachable
        assert!(gatekeeper::node_info(&conn, PID, "asset_04").is_some(), "child part must be queryable");
        assert!(gatekeeper::descendants(&conn, PID, "asset_03").contains(&"asset_04".to_string()));
        let built = gatekeeper::build(&conn, PID, &["asset_03".to_string()], 4.0, "make the falcon faster");
        // the roster uses compact positional ids (asset_01 = first cast member) that ripple maps back to real ids
        let falcon = cast.iter().find(|c| c.id == "asset_03").unwrap();
        assert_eq!(falcon.short, "asset_01");
        assert!(built.system.contains("CAST: [asset_01: \"Peregrine Falcon\"]"), "{}", built.system);
        assert!(built.system.contains("SEL: asset_01"), "{}", built.system);
        assert!(built.system.contains("ev_02 | 3.5s–5.5s | Mid-Air Morph"), "{}", built.system);
    }

    #[test]
    fn undo_and_redo_return_the_snapshots_stored_in_sqlite() {
        let conn = open();
        // state A --edit--> B --edit--> C   (snapshots are the state BEFORE each edit)
        push_undo(&conn, PID, "to B", "A").unwrap();
        push_undo(&conn, PID, "to C", "B").unwrap();
        assert_eq!(pop_undo(&conn, PID, "C").unwrap().as_deref(), Some("B"));
        assert_eq!(pop_undo(&conn, PID, "B").unwrap().as_deref(), Some("A"));
        assert_eq!(pop_undo(&conn, PID, "A").unwrap(), None, "nothing left to undo");
        // redo replays the parked "after" states in order
        assert_eq!(pop_redo(&conn, PID).unwrap().as_deref(), Some("B"));
        assert_eq!(pop_redo(&conn, PID).unwrap().as_deref(), Some("C"));
        assert_eq!(pop_redo(&conn, PID).unwrap(), None);
        // a fresh edit after an undo discards the redo branch
        assert_eq!(pop_undo(&conn, PID, "C").unwrap().as_deref(), Some("B"));
        push_undo(&conn, PID, "new edit", "B").unwrap();
        assert_eq!(pop_redo(&conn, PID).unwrap(), None);
    }
}
