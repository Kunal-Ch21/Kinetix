//! Pre-LLM SQLite gatekeeper.
//! Reads ONLY the normalised tables (objects / parts / keyframes / story_events) and builds the tiny,
//! pipe-delimited micro-context that is sent to the stateless model:
//!   1. Cast roster + fuzzy alias matching
//!   2. Spatial slice (selected / keyword-matched object only)
//!   3. Temporal slice (only keyframes active at the playhead) + story-event index
//!   4. Syntax minification (no uuid / timestamps — flat `key:value | key:value` lines)

use super::schema::SYSTEM_RULES;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const BUDGET: usize = 1024;
/// Animatable track props of the Scene model (x / y are the position channels).
pub const CHANNELS: [&str; 8] = ["x", "y", "rotation", "scale", "opacity", "morph", "glow", "rim"];

const STOP: [&str; 24] = [
    "the", "and", "make", "add", "with", "over", "into", "that", "this", "from", "for", "then", "selected",
    "object", "faster", "slower", "twice", "half", "move", "right", "left", "down", "its", "them",
];

#[allow(dead_code)]
pub struct CastEntry {
    pub short: String,
    pub id: String,
    pub label: String,
    pub aliases: String,
    pub tags: String,
    pub kind: String,
}

#[allow(dead_code)]
pub struct KeyRow {
    pub id: String,
    pub t: f64,
    pub v: Value,
    pub ease: [f64; 4],
    /// Ease exactly as stored (preset name or 4-number cubic-bezier) so tracks round-trip losslessly.
    pub ease_raw: Value,
}

#[allow(dead_code)]
pub struct NodeInfo {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub parent: Option<String>,
    pub blueprint: Value,
    pub x: f64,
    pub y: f64,
    pub rot: f64,
    pub scale: f64,
}

pub struct EventRow {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub title: String,
}

pub struct Built {
    /// (key, label, text)
    pub sections: Vec<(String, String, String)>,
    pub tokens: usize,
    pub system: String,
    pub user: String,
}

impl Built {
    pub fn to_json(&self, summary: Option<String>) -> Value {
        json!({
            "sections": self.sections.iter().map(|(k, l, t)| json!({ "key": k, "label": l, "text": t })).collect::<Vec<_>>(),
            "tokens": self.tokens,
            "budget": BUDGET,
            "summary": summary,
        })
    }
}

/* ------------------------------------------------------------------ small helpers */

fn r1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

pub fn fmt_num(v: f64) -> String {
    let r = r1(v);
    if r.fract() == 0.0 {
        format!("{}", r as i64)
    } else {
        format!("{r}")
    }
}

fn fmt_value(v: &Value) -> String {
    if let Some(arr) = v.as_array() {
        arr.iter()
            .map(|x| fmt_num(x.as_f64().unwrap_or(0.0)))
            .collect::<Vec<_>>()
            .join(",")
    } else {
        fmt_num(v.as_f64().unwrap_or(0.0))
    }
}

fn est(s: &str) -> usize {
    ((s.chars().count() as f64) / 3.6).ceil() as usize
}

pub fn words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| w.len() >= 3 && !STOP.contains(w))
        .map(String::from)
        .collect()
}

fn norm(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .trim()
        .to_string()
}

/// 0..1 similarity used for alias matching and the hard duplicate lock.
pub fn name_score(a: &str, b: &str) -> f64 {
    let (a, b) = (norm(a), norm(b));
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    if (a.len() >= 3 && b.contains(&a)) || (b.len() >= 3 && a.contains(&b)) {
        return 0.95;
    }
    strsim::jaro_winkler(&a, &b)
}

/// Best cast entry for a free-text name (label or any comma-separated alias).
pub fn best_cast(cast: &[CastEntry], name: &str) -> Option<(usize, f64)> {
    let mut best: Option<(usize, f64)> = None;
    for (i, c) in cast.iter().enumerate() {
        let mut score = name_score(&c.label, name);
        for al in c.aliases.split(',') {
            let al = al.trim();
            if !al.is_empty() {
                score = score.max(name_score(al, name));
            }
        }
        if best.map_or(true, |(_, s)| score > s) {
            best = Some((i, score));
        }
    }
    best
}

fn entry_matches(c: &CastEntry, ws: &[String]) -> bool {
    let hay = format!("{} {} {}", c.label, c.aliases, c.tags).to_lowercase();
    let toks: Vec<&str> = hay
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|t| t.len() >= 3)
        .collect();
    ws.iter()
        .any(|w| hay.contains(w.as_str()) || toks.iter().any(|t| strsim::jaro_winkler(w, t) >= 0.92))
}

/* ------------------------------------------------------------------ DB readers */

pub fn load_cast(conn: &Connection, pid: &str) -> Vec<CastEntry> {
    let mut out: Vec<CastEntry> = Vec::new();
    let mut counters: HashMap<&'static str, u32> = HashMap::new();
    let mut stmt = match conn
        .prepare("SELECT id,label,aliases,tags,kind FROM objects WHERE project_id=?1 ORDER BY z_index")
    {
        Ok(s) => s,
        Err(_) => return out,
    };
    let rows = match stmt.query_map(params![pid], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
        ))
    }) {
        Ok(r) => r,
        Err(_) => return out,
    };
    for row in rows.flatten() {
        let (id, label, aliases, tags, kind) = row;
        let prefix: &'static str = match kind.as_str() {
            "image" => "img",
            "text" => "txt",
            _ => "asset",
        };
        let n = counters.entry(prefix).or_insert(0);
        *n += 1;
        out.push(CastEntry {
            short: format!("{prefix}_{:02}", *n),
            id,
            label,
            aliases,
            tags,
            kind,
        });
        if out.len() >= 14 {
            break;
        }
    }
    out
}

pub fn node_info(conn: &Connection, pid: &str, id: &str) -> Option<NodeInfo> {
    let bp = |s: String| serde_json::from_str::<Value>(&s).unwrap_or(Value::Null);
    if let Ok(Some(n)) = conn
        .query_row(
            "SELECT label,kind,x,y,rotation,scale,blueprint FROM objects WHERE project_id=?1 AND id=?2",
            params![pid, id],
            |r| {
                Ok(NodeInfo {
                    id: id.to_string(),
                    label: r.get(0)?,
                    kind: r.get(1)?,
                    parent: None,
                    x: r.get(2)?,
                    y: r.get(3)?,
                    rot: r.get(4)?,
                    scale: r.get(5)?,
                    blueprint: bp(r.get::<_, String>(6)?),
                })
            },
        )
        .optional()
    {
        return Some(n);
    }
    conn.query_row(
        "SELECT parent_id,label,kind,dx,dy,rotation,scale,blueprint FROM parts WHERE project_id=?1 AND id=?2",
        params![pid, id],
        |r| {
            Ok(NodeInfo {
                id: id.to_string(),
                parent: Some(r.get(0)?),
                label: r.get(1)?,
                kind: r.get(2)?,
                x: r.get(3)?,
                y: r.get(4)?,
                rot: r.get(5)?,
                scale: r.get(6)?,
                blueprint: bp(r.get::<_, String>(7)?),
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

pub fn all_node_ids(conn: &Connection, pid: &str) -> Vec<String> {
    let mut out = Vec::new();
    for sql in [
        "SELECT id FROM objects WHERE project_id=?1",
        "SELECT id FROM parts WHERE project_id=?1",
    ] {
        if let Ok(mut stmt) = conn.prepare(sql) {
            if let Ok(rows) = stmt.query_map(params![pid], |r| r.get::<_, String>(0)) {
                out.extend(rows.flatten());
            }
        }
    }
    out
}

/// Direct children as (id, label).
pub fn children_of(conn: &Connection, pid: &str, id: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id,label FROM parts WHERE project_id=?1 AND parent_id=?2 ORDER BY z_index")
    {
        if let Ok(rows) = stmt.query_map(params![pid, id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
            out.extend(rows.flatten());
        }
    }
    out
}

pub fn descendants(conn: &Connection, pid: &str, id: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut stack = vec![id.to_string()];
    let mut seen: HashSet<String> = HashSet::new();
    while let Some(cur) = stack.pop() {
        if !seen.insert(cur.clone()) {
            continue;
        }
        for (cid, _) in children_of(conn, pid, &cur) {
            out.push(cid.clone());
            stack.push(cid);
        }
    }
    out
}

pub fn find_part_by_label(conn: &Connection, pid: &str, label: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM parts WHERE project_id=?1 AND lower(label)=lower(?2) LIMIT 1",
        params![pid, label],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
}

/// Ease as stored: a preset name (`"ease_in_out"`) or a 4-number cubic-bezier array.
pub fn ease_bezier(v: &Value) -> [f64; 4] {
    if let Some(a) = v.as_array() {
        if a.len() == 4 {
            let g = |i: usize| a[i].as_f64().unwrap_or(0.0);
            return [g(0), g(1), g(2), g(3)];
        }
    }
    super::schema::ease(v.as_str().unwrap_or("ease_in_out"))
}

fn parse_ease(s: &str) -> (Value, [f64; 4]) {
    let v = serde_json::from_str::<Value>(s).unwrap_or(Value::Null);
    let b = ease_bezier(&v);
    (if v.is_null() { json!("ease_in_out") } else { v }, b)
}

pub fn load_track(conn: &Connection, pid: &str, owner: &str, ch: &str) -> Vec<KeyRow> {
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id,t_ms,value_json,ease_json FROM keyframes WHERE project_id=?1 AND owner_id=?2 AND channel=?3 ORDER BY t_ms",
    ) {
        if let Ok(rows) = stmt.query_map(params![pid, owner, ch], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        }) {
            for (id, t, v, e) in rows.flatten() {
                let (ease_raw, ease) = parse_ease(&e);
                out.push(KeyRow {
                    id,
                    t: t as f64 / 1000.0,
                    v: serde_json::from_str(&v).unwrap_or(json!(0)),
                    ease,
                    ease_raw,
                });
            }
        }
    }
    out
}

pub fn load_events(conn: &Connection, pid: &str) -> Vec<EventRow> {
    let mut out = Vec::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT id,start_ms,end_ms,title FROM story_events WHERE project_id=?1 ORDER BY start_ms")
    {
        if let Ok(rows) = stmt.query_map(params![pid], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
            ))
        }) {
            for (id, s, e, title) in rows.flatten() {
                out.push(EventRow {
                    id,
                    start: s as f64 / 1000.0,
                    end: e as f64 / 1000.0,
                    title,
                });
            }
        }
    }
    out
}

/// (duration seconds, fps)
pub fn project_meta(conn: &Connection, pid: &str) -> (f64, f64) {
    conn.query_row(
        "SELECT json_extract(json,'$.duration'), json_extract(json,'$.fps') FROM projects WHERE id=?1",
        params![pid],
        |r| Ok((r.get::<_, Option<f64>>(0)?, r.get::<_, Option<f64>>(1)?)),
    )
    .ok()
    .map(|(d, f)| (d.unwrap_or(8.0), f.unwrap_or(60.0)))
    .unwrap_or((8.0, 60.0))
}

/* ------------------------------------------------------------------ keyframe evaluation */

pub fn cubic_bezier(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let bx = |s: f64| 3.0 * (1.0 - s).powi(2) * s * x1 + 3.0 * (1.0 - s) * s * s * x2 + s.powi(3);
    let by = |s: f64| 3.0 * (1.0 - s).powi(2) * s * y1 + 3.0 * (1.0 - s) * s * s * y2 + s.powi(3);
    let (mut lo, mut hi) = (0.0_f64, 1.0_f64);
    let mut s = x;
    for _ in 0..32 {
        s = (lo + hi) / 2.0;
        if bx(s) < x {
            lo = s;
        } else {
            hi = s;
        }
    }
    by(s)
}

fn lerp_v(a: &Value, b: &Value, k: f64) -> Value {
    match (a.as_array(), b.as_array()) {
        (Some(x), Some(y)) => Value::Array(
            x.iter()
                .zip(y.iter())
                .map(|(p, q)| {
                    let (p, q) = (p.as_f64().unwrap_or(0.0), q.as_f64().unwrap_or(0.0));
                    json!(p + (q - p) * k)
                })
                .collect(),
        ),
        _ => {
            let (p, q) = (a.as_f64().unwrap_or(0.0), b.as_f64().unwrap_or(0.0));
            json!(p + (q - p) * k)
        }
    }
}

pub fn eval_track(keys: &[KeyRow], t: f64) -> Option<Value> {
    let first = keys.first()?;
    let last = keys.last()?;
    if t <= first.t {
        return Some(first.v.clone());
    }
    if t >= last.t {
        return Some(last.v.clone());
    }
    for w in keys.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        if t >= a.t && t <= b.t {
            let span = (b.t - a.t).max(1e-9);
            let k = cubic_bezier(a.ease[0], a.ease[1], a.ease[2], a.ease[3], (t - a.t) / span);
            return Some(lerp_v(&a.v, &b.v, k));
        }
    }
    Some(last.v.clone())
}

/// Value of a track prop at `t` (falls back to the object's base value).
pub fn current_value(conn: &Connection, pid: &str, node: &NodeInfo, ch: &str, t: f64) -> Value {
    if let Some(v) = eval_track(&load_track(conn, pid, &node.id, ch), t) {
        return v;
    }
    match ch {
        "x" => json!(node.x),
        "y" => json!(node.y),
        "rotation" => json!(node.rot),
        "scale" => json!(node.scale),
        "opacity" => json!(node.blueprint["opacity"].as_f64().unwrap_or(1.0)),
        "morph" => json!(node.blueprint["morph"].as_f64().unwrap_or(0.0)),
        "glow" => json!(node.blueprint["glow"].as_f64().unwrap_or(0.0)),
        "rim" => json!(1.0),
        _ => json!(0),
    }
}

pub fn current_num(conn: &Connection, pid: &str, node: &NodeInfo, ch: &str, t: f64) -> f64 {
    current_value(conn, pid, node, ch, t).as_f64().unwrap_or(0.0)
}

/* ------------------------------------------------------------------ micro-context builder */

fn rim_color(conn: &Connection, pid: &str, n: &NodeInfo) -> Option<String> {
    if n.blueprint["rim"].is_object() {
        return n.blueprint["rim"]["color"].as_str().map(String::from);
    }
    for d in descendants(conn, pid, &n.id) {
        if let Some(c) = node_info(conn, pid, &d) {
            if c.blueprint["rim"].is_object() {
                return c.blueprint["rim"]["color"].as_str().map(String::from);
            }
        }
    }
    None
}

fn describe(conn: &Connection, pid: &str, n: &NodeInfo, name: &str, tag: &str, time: f64) -> String {
    let (x, y) = (current_num(conn, pid, n, "x", time), current_num(conn, pid, n, "y", time));
    let mut parts = vec![format!("{tag}: {name}"), format!("pos:{},{}", fmt_num(x), fmt_num(y))];
    let rot = current_num(conn, pid, n, "rotation", time);
    if rot.abs() > 0.01 {
        parts.push(format!("rot:{}", fmt_num(rot)));
    }
    let sc = current_num(conn, pid, n, "scale", time);
    if (sc - 1.0).abs() > 0.001 {
        parts.push(format!("sc:{}", (sc * 100.0).round() / 100.0));
    }
    if let Some(c) = rim_color(conn, pid, n) {
        parts.push(format!("rim:{c}"));
    }
    parts.join(" | ")
}

pub fn build(conn: &Connection, pid: &str, selection: &[String], time: f64, prompt: &str) -> Built {
    let cast = load_cast(conn, pid);
    let ws = words(prompt);

    // ---- 1. roster + fuzzy alias matching
    let mut picked: HashSet<String> = selection.iter().cloned().collect();
    for c in &cast {
        if entry_matches(c, &ws) {
            picked.insert(c.id.clone());
        }
    }
    let cast_line = if cast.is_empty() {
        "CAST: (empty scene)".to_string()
    } else {
        format!(
            "CAST: {}",
            cast.iter()
                .map(|c| format!("[{}: \"{}\"]", c.short, c.label))
                .collect::<Vec<_>>()
                .join(" ")
        )
    };

    // ---- 2. spatial slice
    let mut sel_lines: Vec<String> = Vec::new();
    for c in &cast {
        if !picked.contains(&c.id) {
            continue;
        }
        if let Some(n) = node_info(conn, pid, &c.id) {
            let tag = if selection.contains(&c.id) { "SEL" } else { "REF" };
            sel_lines.push(describe(conn, pid, &n, &c.short, tag, time));
        }
    }
    for id in selection {
        if cast.iter().any(|c| &c.id == id) {
            continue;
        }
        if let Some(n) = node_info(conn, pid, id) {
            let name = n.label.clone();
            sel_lines.push(describe(conn, pid, &n, &name, "SEL", time));
        }
    }

    // ---- 3a. story events (active at playhead OR named in the prompt)
    let ev_lines: Vec<String> = load_events(conn, pid)
        .into_iter()
        .filter(|e| {
            (time >= e.start && time <= e.end) || words(&e.title).iter().any(|w| ws.contains(w))
        })
        .map(|e| format!("{} | {:.1}s–{:.1}s | {}", e.id, e.start, e.end, e.title))
        .collect();

    // ---- 3b. temporal slice: keyframes active at the playhead only
    let mut kf_lines: Vec<String> = Vec::new();
    'outer: for c in &cast {
        if !picked.contains(&c.id) {
            continue;
        }
        let mut owners: Vec<(String, String)> = vec![(c.id.clone(), c.short.clone())];
        owners.extend(children_of(conn, pid, &c.id));
        for (id, name) in owners {
            for ch in CHANNELS {
                let keys = load_track(conn, pid, &id, ch);
                if let Some(k) = keys.iter().find(|k| (k.t - time).abs() < 1.0 / 120.0) {
                    kf_lines.push(format!(
                        "KF: {name}.{ch} | t:{} | v:{} | ease:{}",
                        fmt_num(k.t),
                        fmt_value(&k.v),
                        k.ease.iter().map(|e| format!("{}", (e * 100.0).round() / 100.0)).collect::<Vec<_>>().join(",")
                    ));
                    if kf_lines.len() >= 8 {
                        break 'outer;
                    }
                }
            }
        }
    }

    let sel_text = if sel_lines.is_empty() { "SEL: none".to_string() } else { sel_lines.join("\n") };
    let ev_text = if ev_lines.is_empty() { "EV: none in range".to_string() } else { ev_lines.join("\n") };
    let kf_text = if kf_lines.is_empty() { "KF: none at playhead".to_string() } else { kf_lines.join("\n") };
    let user: String = prompt.trim().chars().take(500).collect();

    let sections = vec![
        ("sys".to_string(), "SYSTEM RULES".to_string(), SYSTEM_RULES.to_string()),
        ("cast".to_string(), "CAST ROSTER".to_string(), cast_line.clone()),
        ("sel".to_string(), "SPATIAL SLICE".to_string(), sel_text.clone()),
        ("ev".to_string(), "STORY EVENTS".to_string(), ev_text.clone()),
        ("kf".to_string(), format!("TEMPORAL SLICE @ {:.1}s", time), kf_text.clone()),
        (
            "user".to_string(),
            "USER PROMPT".to_string(),
            if user.is_empty() { "(empty)".to_string() } else { user.clone() },
        ),
    ];
    let tokens: usize = sections.iter().map(|s| est(&s.2)).sum();
    let system = format!("{SYSTEM_RULES}\n{cast_line}\n{sel_text}\n{ev_text}\n{kf_text}");

    Built { sections, tokens, system, user }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::ripple::tests::fixture;

    fn cast_of(conn: &Connection) -> Vec<CastEntry> {
        load_cast(conn, "p1")
    }

    #[test]
    fn alias_fuzzy_match_finds_misspelled_and_synonym_names() {
        let c = fixture();
        let cast = cast_of(&c);
        assert_eq!(cast[0].short, "asset_01");
        for q in ["falcon", "Falcn", "the hawk", "peregrine falcon", "PEREGRINE  FALCON!"] {
            let (i, s) = best_cast(&cast, q).unwrap();
            assert_eq!(cast[i].id, "asset_01", "{q} -> {s}");
            assert!(s >= 0.8, "{q} scored {s}");
        }
        let (i, s) = best_cast(&cast, "boulder").unwrap();
        assert!(s < 0.8, "unrelated name must not match (rock? {}: {s})", cast[i].label);
    }

    #[test]
    fn name_score_is_symmetric_and_bounded() {
        assert_eq!(name_score("Logo", "logo"), 1.0);
        assert!(name_score("falcon", "peregrine falcon") >= 0.95);
        assert!(name_score("abc", "") == 0.0);
    }

    #[test]
    fn minifier_emits_flat_pipe_delimited_lines_without_metadata() {
        let c = fixture();
        let b = build(&c, "p1", &["asset_01".to_string()], 0.0, "make the falcon faster");
        let sel = b.sections.iter().find(|s| s.0 == "sel").unwrap().2.clone();
        assert_eq!(sel, "SEL: asset_01 | pos:45,40 | rim:#06B6D4");
        let all: String = b.sections.iter().filter(|s| s.0 != "sys").map(|s| s.2.clone()).collect::<Vec<_>>().join("\n");
        for banned in ["uuid", "created_at", "{", "\"x\":"] {
            assert!(!all.contains(banned), "minified context leaked `{banned}`:\n{all}");
        }
        let cast = b.sections.iter().find(|s| s.0 == "cast").unwrap().2.clone();
        assert_eq!(cast, "CAST: [asset_01: \"Peregrine Falcon\"] [asset_02: \"Rock\"]");
        assert!(b.tokens < BUDGET, "micro-context must fit the 1024 budget, was {}", b.tokens);
    }

    #[test]
    fn spatial_and_temporal_slicing_hide_unrelated_objects() {
        let c = fixture();
        // prompt names only the falcon -> the rock's blueprint/keyframes are not in the context
        let b = build(&c, "p1", &[], 1.0, "give the hawk a glow");
        let sel = b.sections.iter().find(|s| s.0 == "sel").unwrap().2.clone();
        assert!(sel.starts_with("REF: asset_01"), "{sel}");
        assert!(!sel.contains("asset_02"));
        // at t=1.0 the rock's x key is active, but it is only listed when the rock is picked
        let kf = b.sections.iter().find(|s| s.0 == "kf").unwrap().2.clone();
        assert!(!kf.contains("asset_02"), "{kf}");
        let b = build(&c, "p1", &["asset_02".to_string()], 1.0, "");
        let kf = b.sections.iter().find(|s| s.0 == "kf").unwrap().2.clone();
        assert!(kf.contains("KF: asset_02.x | t:1 | v:20"), "{kf}");
    }

    #[test]
    fn story_event_index_is_injected_when_playhead_inside_or_named() {
        let c = fixture();
        let b = build(&c, "p1", &[], 1.0, "");
        let ev = b.sections.iter().find(|s| s.0 == "ev").unwrap().2.clone();
        assert_eq!(ev, "ev_01 | 0.0s–3.5s | Falcon Soars");
        let b = build(&c, "p1", &[], 6.0, "edit the frame after the falcon soars");
        assert!(b.sections.iter().find(|s| s.0 == "ev").unwrap().2.contains("ev_01"));
    }

    #[test]
    fn eval_track_uses_cubic_bezier_between_keys() {
        let keys = vec![
            KeyRow { id: "a".into(), t: 0.0, v: json!(0), ease: [0.0, 0.0, 1.0, 1.0], ease_raw: json!("linear") },
            KeyRow { id: "b".into(), t: 2.0, v: json!(10), ease: [0.0, 0.0, 1.0, 1.0], ease_raw: json!("linear") },
        ];
        let v = eval_track(&keys, 1.0).unwrap().as_f64().unwrap();
        assert!((v - 5.0).abs() < 1e-6, "{v}");
        assert_eq!(eval_track(&keys, 9.0).unwrap().as_f64().unwrap(), 10.0);
    }
}
