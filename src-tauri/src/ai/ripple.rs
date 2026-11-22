//! Relative-math & ripple engine.
//!
//! The small local model NEVER does arithmetic: it emits relative modifiers (`modifier: add|multiply|set`,
//! `speed_multiplier`, `event` + `when`) and this deterministic code computes every concrete value, key time and
//! ripple shift. It returns ops in the SAME vocabulary that `src/engine/ops.ts::applyOps` interprets
//! (see `schema::OPS`), so the front-end applies exactly what Rust returns — no second translation layer.
//! It also enforces the hard duplicate lock (a create_* of an existing cast member is blocked and reported).

use super::gatekeeper::{
    all_node_ids, best_cast, current_num, descendants, find_part_by_label, load_track, name_score, node_info, CastEntry,
    EventRow, KeyRow, CHANNELS,
};
use super::schema::{self, BACKGROUNDS, EASES, PRESETS, PROPS, SHAPES};
use rusqlite::Connection;
use serde_json::{json, Map, Value};

pub struct Ctx<'a> {
    pub conn: &'a Connection,
    pub pid: &'a str,
    pub cast: &'a [CastEntry],
    pub selection: &'a [String],
    pub time: f64,
    pub duration: f64,
    pub fps: f64,
    pub events: Vec<EventRow>,
}

struct Out {
    ops: Vec<Value>,
    blocked: Vec<Value>,
    notes: Vec<String>,
    max_end: f64,
}

/* ------------------------------------------------------------------ helpers */

fn num(a: &Value, k: &str) -> Option<f64> {
    a.get(k).and_then(|v| v.as_f64()).filter(|v| v.is_finite())
}

fn text<'a>(a: &'a Value, k: &str) -> Option<&'a str> {
    a.get(k).and_then(|v| v.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty())
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

pub fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

pub fn norm_color(s: &str) -> Option<String> {
    let t = s.trim().to_lowercase();
    if t.starts_with('#') && t.len() == 7 && t[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(t.to_uppercase());
    }
    if t.starts_with('#') && t.len() == 4 && t[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        let c: Vec<char> = t[1..].chars().collect();
        return Some(format!("#{0}{0}{1}{1}{2}{2}", c[0], c[1], c[2]).to_uppercase());
    }
    let hex = match t.as_str() {
        "none" => return Some("none".to_string()),
        "cyan" => "#06B6D4",
        "amber" | "gold" | "yellow" => "#F59E0B",
        "blue" => "#3B82F6",
        "red" => "#EF4444",
        "green" => "#22C55E",
        "white" => "#FFFFFF",
        "black" => "#000000",
        "purple" | "violet" => "#8B5CF6",
        "pink" => "#EC4899",
        "orange" => "#F97316",
        "teal" => "#14B8A6",
        _ => return None,
    };
    Some(hex.to_string())
}

/// The front-end path parser handles absolute M / L / C / Z — reject anything else.
pub fn valid_svg(s: &str) -> bool {
    let s = s.trim();
    !s.is_empty()
        && s.len() <= 4000
        && s.starts_with('M')
        && s.chars().all(|c| c.is_ascii_digit() || c.is_whitespace() || ",.-+eE".contains(c) || "MLCZ".contains(c))
}

fn find_event<'a>(ctx: &'a Ctx<'_>, q: &str) -> Option<&'a EventRow> {
    let ql = q.trim().to_lowercase();
    if let Some(e) = ctx.events.iter().find(|e| e.id.to_lowercase() == ql) {
        return Some(e);
    }
    ctx.events
        .iter()
        .map(|e| (e, name_score(&e.title, q)))
        .filter(|(_, s)| *s >= 0.6)
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(e, _)| e)
}

/// Resolve a model-supplied reference (selection keyword, short cast id, real id, fuzzy alias, part label).
pub fn resolve_target(ctx: &Ctx<'_>, raw: Option<&str>, fallback_sel: bool) -> Option<String> {
    if let Some(r) = raw {
        let rl = r.to_lowercase();
        if ["selected", "selection", "sel", "this", "it", "current"].contains(&rl.as_str()) {
            return ctx.selection.first().cloned();
        }
        if let Some(c) = ctx.cast.iter().find(|c| c.short.to_lowercase() == rl || c.id == r) {
            return Some(c.id.clone());
        }
        if node_info(ctx.conn, ctx.pid, r).is_some() {
            return Some(r.to_string());
        }
        if let Some((i, s)) = best_cast(ctx.cast, r) {
            if s >= 0.8 {
                return Some(ctx.cast[i].id.clone());
            }
        }
        if let Some(id) = find_part_by_label(ctx.conn, ctx.pid, r) {
            return Some(id);
        }
    }
    if fallback_sel {
        ctx.selection.first().cloned()
    } else {
        None
    }
}

/// (start, duration) in seconds. Honors at/start, end, duration, event+when; defaults to the playhead.
fn timing(ctx: &Ctx<'_>, a: &Value, default_dur: f64) -> (f64, f64) {
    let mut start = ctx.time;
    let probe = clamp(num(a, "duration").unwrap_or(default_dur), 0.05, ctx.duration.max(1.0));
    if let Some(s) = num(a, "at").or_else(|| num(a, "start")) {
        start = s;
    }
    if let Some(q) = text(a, "event") {
        if let Some(e) = find_event(ctx, q) {
            start = match text(a, "when").unwrap_or("during") {
                "after" => e.end,
                "before" => (e.start - probe).max(0.0),
                _ => e.start,
            };
        }
    }
    let start = clamp(start, 0.0, ctx.duration.max(1.0) * 4.0);
    let mut dur = num(a, "duration").unwrap_or(default_dur);
    if num(a, "duration").is_none() {
        if let Some(en) = num(a, "end") {
            dur = en - start;
        }
    }
    (round3(start), round3(clamp(dur, 0.05, ctx.duration.max(1.0) * 4.0)))
}

fn ease_value(a: &Value) -> Value {
    match a.get("ease") {
        Some(Value::String(s)) if EASES.contains(&s.as_str()) => json!(s),
        Some(Value::Array(v)) if v.len() == 4 && v.iter().all(|x| x.is_number()) => Value::Array(v.clone()),
        _ => json!("ease_in_out"),
    }
}

fn prop_range(prop: &str) -> (f64, f64) {
    match prop {
        "rotation" => (-3600.0, 3600.0),
        "scale" => (0.01, 100.0),
        "opacity" | "morph" => (0.0, 1.0),
        "glow" => (0.0, 5.0),
        "rim" => (0.0, 10.0),
        _ => (-50.0, 150.0),
    }
}

/// Merge `new` keys into a track, ripple-shifting later keys when the new span collides with them, then emit one
/// absolute `set_track` op (full replacement of the track — nothing for the front-end to compute).
fn push_keys(ctx: &Ctx<'_>, out: &mut Out, node: &str, prop: &str, new: Vec<(f64, f64)>, ease: Value, ripple: bool) {
    if new.is_empty() {
        return;
    }
    let eps = 1.0 / (ctx.fps.max(1.0) * 2.0);
    let first_t = new.iter().map(|k| k.0).fold(f64::MAX, f64::min);
    let last_t = new.iter().map(|k| k.0).fold(0.0_f64, f64::max);
    let existing: Vec<KeyRow> = load_track(ctx.conn, ctx.pid, node, prop);
    let collides = |t: f64| new.iter().any(|n| (n.0 - t).abs() < eps);
    let later: Vec<&KeyRow> = existing.iter().filter(|k| k.t > first_t + eps && !collides(k.t)).collect();
    let min_t = later.iter().map(|k| k.t).fold(f64::INFINITY, f64::min);
    let delta = if ripple && min_t.is_finite() && min_t <= last_t + eps {
        last_t - min_t + 1.0 / ctx.fps.max(1.0)
    } else {
        0.0
    };

    let mut keys: Vec<(f64, Value, Value)> = Vec::new();
    for k in &existing {
        if collides(k.t) {
            continue;
        }
        let t = if delta > 0.0 && k.t > first_t + eps { k.t + delta } else { k.t };
        keys.push((round3(t), k.v.clone(), k.ease_raw.clone()));
    }
    for (t, v) in &new {
        keys.push((round3(*t), json!(round3(*v)), ease.clone()));
    }
    keys.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    out.max_end = out.max_end.max(keys.last().map(|k| k.0).unwrap_or(0.0));
    out.ops.push(json!({
        "op": "set_track",
        "id": node,
        "prop": prop,
        "keys": keys.iter().map(|(t, v, e)| json!({ "t": t, "v": v, "ease": e })).collect::<Vec<_>>()
    }));
}

fn lock_check(ctx: &Ctx<'_>, out: &mut Out, label: &str) -> bool {
    if let Some((i, s)) = best_cast(ctx.cast, label) {
        if s >= 0.88 {
            out.blocked.push(json!({
                "label": label,
                "reuse": ctx.cast[i].short,
                "id": ctx.cast[i].id,
                "reason": "duplicate lock"
            }));
            return true;
        }
    }
    false
}

/// Copy an op, dropping nulls / unusable colours / bad paths and clamping positions.
fn clean(a: &Value) -> Map<String, Value> {
    let mut m = Map::new();
    let Some(obj) = a.as_object() else { return m };
    for (k, v) in obj {
        if v.is_null() {
            continue;
        }
        match k.as_str() {
            "fill" | "fillTo" | "stroke" | "color" | "color2" => {
                if let Some(c) = v.as_str().and_then(norm_color) {
                    m.insert(k.clone(), json!(c));
                }
            }
            "svg_path" => {
                if v.as_str().map(valid_svg).unwrap_or(false) {
                    m.insert(k.clone(), v.clone());
                }
            }
            "x" | "y" => {
                if let Some(n) = v.as_f64() {
                    m.insert(k.clone(), json!(clamp(n, -50.0, 150.0)));
                }
            }
            "parts" => {}
            _ => {
                m.insert(k.clone(), v.clone());
            }
        }
    }
    m
}

/* ------------------------------------------------------------------ entry point */

pub fn resolve(ctx: &Ctx<'_>, ops: &[Value]) -> Value {
    let mut out = Out { ops: vec![], blocked: vec![], notes: vec![], max_end: 0.0 };
    for a in ops.iter().take(6) {
        let name = text(a, "op").unwrap_or("");
        if !schema::MODEL_OPS.contains(&name) {
            out.notes.push(format!("Unknown or internal op '{name}' ignored"));
            continue;
        }
        match name {
            "keyframe" => do_keyframe(ctx, a, &mut out),
            "speed" => do_speed(ctx, a, &mut out),
            "animate" => do_animate(ctx, a, &mut out),
            "morph_to" => do_morph(ctx, a, &mut out),
            "create_shape" | "add_text" => create_one(ctx, a, &mut out, name),
            "create_assembly" => create_assembly(ctx, a, &mut out),
            "attach_part" => attach_part(ctx, a, &mut out),
            "clone" => do_clone(ctx, a, &mut out),
            "delete" => do_delete(ctx, a, &mut out),
            "set_rim" => do_rim(ctx, a, &mut out),
            "set_background" => do_background(a, &mut out),
            "story_event" => do_event(ctx, a, &mut out),
            "add_light" | "set_light" | "add_emitter" => do_world(ctx, a, &mut out, name),
            // set_shadow | set_style | detach_part: resolve the target and pass the cleaned op through
            other => do_targeted(ctx, a, &mut out, other),
        }
    }
    if out.max_end > ctx.duration {
        out.ops.push(json!({ "op": "set_duration", "duration": out.max_end.ceil() }));
    }
    json!({ "ops": out.ops, "blocked": out.blocked, "notes": out.notes })
}

/* ------------------------------------------------------------------ motion */

fn do_keyframe(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    let Some(id) = resolve_target(ctx, text(a, "id").or_else(|| text(a, "target")), true) else {
        out.notes.push("keyframe: no target found".into());
        return;
    };
    let Some(node) = node_info(ctx.conn, ctx.pid, &id) else { return };
    let prop = text(a, "prop").unwrap_or("x");
    if !PROPS.contains(&prop) {
        out.notes.push(format!("keyframe: unknown prop '{prop}'"));
        return;
    }
    let Some(v) = num(a, "value") else {
        out.notes.push(format!("keyframe: no value given for {prop}"));
        return;
    };
    let (start, dur) = timing(ctx, a, 1.0);
    let cur = current_num(ctx.conn, ctx.pid, &node, prop, start);
    let target = match text(a, "modifier").unwrap_or("set") {
        "add" => cur + v,
        "multiply" => cur * v,
        _ => v,
    };
    let (lo, hi) = prop_range(prop);
    let nv = clamp(target, lo, hi);
    let ease = ease_value(a);
    let timed = num(a, "duration").is_some() || text(a, "event").is_some() || num(a, "end").is_some();
    if timed {
        push_keys(ctx, out, &id, prop, vec![(start, cur), (round3(start + dur), nv)], ease, true);
    } else {
        push_keys(ctx, out, &id, prop, vec![(start, nv)], ease, false);
    }
}

fn do_animate(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    let Some(id) = resolve_target(ctx, text(a, "id").or_else(|| text(a, "target")), true) else {
        out.notes.push("animate: no target found".into());
        return;
    };
    let Some(node) = node_info(ctx.conn, ctx.pid, &id) else { return };
    let preset = text(a, "preset").unwrap_or("ease_in_out");
    if !PRESETS.contains(&preset) {
        out.notes.push(format!("animate: unknown preset '{preset}'"));
        return;
    }
    let (start, dur) = timing(ctx, a, 1.0);
    let mut m = clean(a);
    m.remove("event");
    m.remove("when");
    m.remove("at");
    m.insert("op".into(), json!("animate"));
    m.insert("id".into(), json!(id));
    m.insert("preset".into(), json!(preset));
    m.insert("start".into(), json!(start));
    m.insert("duration".into(), json!(dur));
    // relative dx/dy -> absolute to_x/to_y (computed here, never by the model or the front-end)
    if matches!(preset, "linear_move" | "ease_in_out" | "spring_bounce" | "arc_jump") {
        let (cx, cy) = (current_num(ctx.conn, ctx.pid, &node, "x", start), current_num(ctx.conn, ctx.pid, &node, "y", start));
        if num(a, "to_x").is_none() {
            m.insert("to_x".into(), json!(round3(clamp(cx + num(a, "dx").unwrap_or(if preset == "arc_jump" { 20.0 } else { 0.0 }), -50.0, 150.0))));
        }
        if num(a, "to_y").is_none() {
            m.insert("to_y".into(), json!(round3(clamp(cy + num(a, "dy").unwrap_or(0.0), -50.0, 150.0))));
        }
        m.remove("dx");
        m.remove("dy");
    }
    out.max_end = out.max_end.max(start + dur);
    out.ops.push(Value::Object(m));
}

fn do_speed(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    let m = clamp(num(a, "speed_multiplier").or_else(|| num(a, "value")).unwrap_or(1.0), 0.1, 10.0);
    if (m - 1.0).abs() < 1e-6 {
        out.notes.push("speed: speed_multiplier is 1 — nothing to do".into());
        return;
    }
    let ev = text(a, "event").and_then(|q| find_event(ctx, q));
    let explicit = text(a, "id").or_else(|| text(a, "target"));
    let mut ids: Vec<String> = Vec::new();
    let global;
    if explicit.is_some() {
        if let Some(t) = resolve_target(ctx, explicit, true) {
            ids.push(t.clone());
            ids.extend(descendants(ctx.conn, ctx.pid, &t));
        }
        global = false;
    } else if ev.is_some() || ctx.selection.is_empty() {
        ids = all_node_ids(ctx.conn, ctx.pid);
        global = true;
    } else {
        for s in ctx.selection {
            ids.push(s.clone());
            ids.extend(descendants(ctx.conn, ctx.pid, s));
        }
        global = false;
    }
    let prop_filter = text(a, "prop");
    let mut tracks: Vec<(String, &str, Vec<KeyRow>)> = Vec::new();
    for id in &ids {
        for ch in CHANNELS {
            if prop_filter.is_some_and(|f| f != ch) {
                continue;
            }
            let ks = load_track(ctx.conn, ctx.pid, id, ch);
            if !ks.is_empty() {
                tracks.push((id.clone(), ch, ks));
            }
        }
    }
    if tracks.is_empty() {
        out.notes.push("speed: no keyframes found to retime".into());
        return;
    }
    let mut max_t = tracks.iter().flat_map(|t| t.2.iter().map(|k| k.t)).fold(0.0_f64, f64::max);
    if global {
        // a whole-project retime also covers the story-event flags, so they stay aligned with the motion
        max_t = ctx.events.iter().map(|e| e.end).fold(max_t, f64::max);
    }
    let (rs, re) = if let Some(e) = ev {
        match text(a, "when").unwrap_or("during") {
            "after" => (e.end, max_t.max(e.end)),
            "before" => (0.0, e.start),
            _ => (e.start, e.end),
        }
    } else {
        (num(a, "start").unwrap_or(0.0), num(a, "end").unwrap_or(max_t))
    };
    if re <= rs + 1e-6 {
        out.notes.push("speed: empty time range".into());
        return;
    }
    let delta = (rs + (re - rs) / m) - re;
    let map = |t: f64| -> f64 {
        if t < rs {
            t
        } else if t <= re {
            rs + (t - rs) / m
        } else {
            t + delta
        }
    };
    for (id, ch, ks) in &tracks {
        let moved: Vec<Value> = ks
            .iter()
            .map(|k| json!({ "t": round3(map(k.t).max(0.0)), "v": k.v, "ease": k.ease_raw }))
            .collect();
        out.ops.push(json!({ "op": "set_track", "id": id, "prop": ch, "keys": moved }));
    }
    if global {
        for e in &ctx.events {
            let (ns, ne) = (map(e.start), map(e.end));
            if (ns - e.start).abs() > 1e-6 || (ne - e.end).abs() > 1e-6 {
                out.ops.push(json!({ "op": "set_event", "id": e.id, "start": round3(ns), "end": round3(ne) }));
            }
        }
    }
    out.max_end = out.max_end.max(map(max_t));
}

fn do_morph(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    let Some(id) = resolve_target(ctx, text(a, "id"), true) else {
        out.notes.push("morph_to: no target object found".into());
        return;
    };
    let (at, dur) = timing(ctx, a, 1.5);
    let mut m = clean(a);
    for k in ["event", "when", "start", "target"] {
        m.remove(k);
    }
    m.insert("op".into(), json!("morph_to"));
    m.insert("id".into(), json!(id));
    m.insert("at".into(), json!(at));
    m.insert("duration".into(), json!(dur));
    match a.get("target") {
        Some(Value::String(s)) => match resolve_target(ctx, Some(s), false) {
            Some(t) => {
                m.insert("target".into(), json!(t));
            }
            None => {
                out.notes.push(format!("morph_to: target '{s}' not found"));
                return;
            }
        },
        Some(t @ Value::Object(_)) => {
            m.insert("target".into(), Value::Object(clean(t)));
        }
        _ => {
            if !m.contains_key("svg_path") && !m.contains_key("shape") {
                out.notes.push("morph_to: needs target / svg_path / shape".into());
                return;
            }
        }
    }
    out.max_end = out.max_end.max(at + dur);
    out.ops.push(Value::Object(m));
}

/* ------------------------------------------------------------------ creation / rig */

fn create_one(ctx: &Ctx<'_>, a: &Value, out: &mut Out, op: &str) {
    let default = if op == "add_text" { "Text" } else { text(a, "shape").unwrap_or("Shape") };
    let label = text(a, "label").or_else(|| text(a, "content")).or_else(|| text(a, "text")).unwrap_or(default);
    if lock_check(ctx, out, label) {
        return;
    }
    if op == "create_shape" {
        let shape = text(a, "shape").unwrap_or("circle");
        if !SHAPES.contains(&shape) {
            out.notes.push(format!("create_shape: unknown shape '{shape}'"));
            return;
        }
        if shape == "svg_path" && !text(a, "svg_path").map(valid_svg).unwrap_or(false) {
            out.notes.push("create_shape: svg_path must use absolute M L C Z commands only".into());
            return;
        }
    }
    let mut m = clean(a);
    m.insert("label".into(), json!(label));
    m.insert("force_new".into(), json!(false));
    if let Some(p) = text(a, "parent").and_then(|p| resolve_target(ctx, Some(p), false)) {
        m.insert("parent".into(), json!(p));
    } else {
        m.remove("parent");
    }
    out.ops.push(Value::Object(m));
}

fn create_assembly(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    let label = text(a, "label").unwrap_or("Assembly");
    if lock_check(ctx, out, label) {
        return;
    }
    let mut parts: Vec<Value> = Vec::new();
    if let Some(arr) = a.get("parts").and_then(|v| v.as_array()) {
        for p in arr.iter().take(8) {
            let mut m = clean(p);
            m.entry("label").or_insert(json!("Part"));
            let shape = m.get("shape").and_then(|s| s.as_str()).unwrap_or("rect").to_string();
            if !SHAPES.contains(&shape.as_str()) || (shape == "svg_path" && !m.contains_key("svg_path")) {
                m.insert("shape".into(), json!("rect"));
            }
            parts.push(Value::Object(m));
        }
    }
    if parts.is_empty() {
        out.notes.push("create_assembly: no parts given".into());
        return;
    }
    let mut m = clean(a);
    m.insert("parts".into(), Value::Array(parts));
    m.insert("label".into(), json!(label));
    out.ops.push(Value::Object(m));
}

fn attach_part(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    let node = resolve_target(ctx, text(a, "id").or_else(|| text(a, "target")), true);
    let parent = resolve_target(ctx, text(a, "parent"), false);
    let (Some(node), Some(parent)) = (node, parent) else {
        out.notes.push("attach_part: need an existing object and parent".into());
        return;
    };
    if node == parent || descendants(ctx.conn, ctx.pid, &node).contains(&parent) {
        out.notes.push("attach_part: would create a cycle".into());
        return;
    }
    let mut m = clean(a);
    m.insert("op".into(), json!("attach_part"));
    m.insert("id".into(), json!(node));
    m.insert("parent".into(), json!(parent));
    m.remove("target");
    out.ops.push(Value::Object(m));
}

fn do_clone(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    let Some(src) = resolve_target(ctx, text(a, "source").or_else(|| text(a, "id")).or_else(|| text(a, "target")), true) else {
        out.notes.push("clone: no source found".into());
        return;
    };
    let mut m = clean(a);
    m.remove("id");
    m.remove("target");
    m.insert("op".into(), json!("clone"));
    m.insert("source".into(), json!(src));
    out.ops.push(Value::Object(m));
}

fn do_delete(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    match resolve_target(ctx, text(a, "id").or_else(|| text(a, "target")), false) {
        Some(id) => out.ops.push(json!({ "op": "delete", "id": id })),
        None => out.notes.push("delete: name the object to delete (nothing removed)".into()),
    }
}

fn do_targeted(ctx: &Ctx<'_>, a: &Value, out: &mut Out, op: &str) {
    let Some(id) = resolve_target(ctx, text(a, "id").or_else(|| text(a, "target")), true) else {
        out.notes.push(format!("{op}: no target found"));
        return;
    };
    let mut m = clean(a);
    m.remove("target");
    m.insert("op".into(), json!(op));
    m.insert("id".into(), json!(id));
    out.ops.push(Value::Object(m));
}

fn do_rim(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    let Some(id) = resolve_target(ctx, text(a, "id").or_else(|| text(a, "target")), true) else {
        out.notes.push("set_rim: no target found".into());
        return;
    };
    let Some(node) = node_info(ctx.conn, ctx.pid, &id) else { return };
    let cur = node.blueprint["rim"]["intensity"].as_f64().unwrap_or(1.0);
    let mut m = clean(a);
    m.remove("target");
    if let Some(i) = num(a, "intensity").or_else(|| num(a, "value")) {
        let nv = match text(a, "modifier") {
            Some("add") => cur + i,
            Some("multiply") => cur * i,
            _ => i,
        };
        m.insert("intensity".into(), json!(round3(clamp(nv, 0.0, 10.0))));
    }
    if let Some(s) = num(a, "spread") {
        m.insert("spread".into(), json!(clamp(s, 0.0, 20.0)));
    }
    m.remove("value");
    m.insert("op".into(), json!("set_rim"));
    // An empty rig root (fill:none assembly) has no silhouette of its own — light its parts instead.
    let hollow = node.blueprint["fill"].as_str() == Some("none") && node.blueprint["stroke"].is_null();
    let kids = descendants(ctx.conn, ctx.pid, &id);
    let targets: Vec<String> = if hollow && !kids.is_empty() { kids } else { vec![id] };
    for t in targets {
        let mut mm = m.clone();
        mm.insert("id".into(), json!(t));
        out.ops.push(Value::Object(mm));
    }
}

fn do_background(a: &Value, out: &mut Out) {
    let key = text(a, "background").or_else(|| text(a, "preset")).unwrap_or("dusk");
    if !BACKGROUNDS.contains(&key) {
        out.notes.push(format!("set_background: unknown preset '{key}'"));
        return;
    }
    out.ops.push(json!({ "op": "set_background", "background": key }));
}

fn do_event(ctx: &Ctx<'_>, a: &Value, out: &mut Out) {
    let (start, _) = timing(ctx, a, 1.0);
    let end = num(a, "end").unwrap_or(start + num(a, "duration").unwrap_or(1.0));
    if end <= start {
        out.notes.push("story_event: end must be after start".into());
        return;
    }
    let title = text(a, "title").or_else(|| text(a, "label")).unwrap_or("Event");
    out.max_end = out.max_end.max(end);
    out.ops.push(json!({ "op": "story_event", "start": start, "end": round3(end), "title": title }));
}

fn do_world(ctx: &Ctx<'_>, a: &Value, out: &mut Out, op: &str) {
    let mut m = clean(a);
    m.insert("op".into(), json!(op));
    match text(a, "follow") {
        Some(f) => match resolve_target(ctx, Some(f), false) {
            Some(id) => {
                m.insert("follow".into(), json!(id));
            }
            None => {
                m.remove("follow");
                out.notes.push(format!("{op}: follow target '{f}' not found — placed at x/y instead"));
            }
        },
        None => {
            m.remove("follow");
        }
    }
    out.ops.push(Value::Object(m));
}

/* ------------------------------------------------------------------ tests */

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::ai::gatekeeper;
    use crate::commands::store_project;

    const PID: &str = "p1";

    pub fn fixture() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::SCHEMA).unwrap();
        let scene = json!({
            "name": "t", "duration": 8, "fps": 60, "width": 1280, "height": 720,
            "objects": [
                { "id": "asset_01", "label": "Peregrine Falcon", "aliases": ["falcon", "hawk"], "tags": [], "kind": "shape",
                  "parent": null, "x": 45, "y": 40, "rotation": 0, "scale": 1, "opacity": 1, "fill": "#334155",
                  "rim": { "color": "#06B6D4", "intensity": 1, "spread": 0.8 }, "tracks": [] },
                { "id": "asset_02", "label": "Rock", "aliases": [], "tags": [], "kind": "shape", "parent": null,
                  "x": 20, "y": 70, "rotation": 0, "scale": 1, "opacity": 1, "fill": "#444444",
                  "tracks": [ { "prop": "x", "keys": [
                      { "t": 1.0, "v": 20, "ease": "linear" }, { "t": 2.0, "v": 30, "ease": "linear" }, { "t": 3.0, "v": 40, "ease": "linear" } ] } ] }
            ],
            "lights": [], "emitters": [],
            "events": [ { "id": "ev_01", "start": 0.0, "end": 3.5, "title": "Falcon Soars" } ]
        });
        store_project(&mut conn, PID, "t", &scene.to_string()).unwrap();
        conn
    }

    fn run(conn: &Connection, selection: &[String], time: f64, ops: Value) -> Value {
        let cast = gatekeeper::load_cast(conn, PID);
        let events = gatekeeper::load_events(conn, PID);
        let (duration, fps) = gatekeeper::project_meta(conn, PID);
        let ctx = Ctx { conn, pid: PID, cast: &cast, selection, time, duration, fps, events };
        resolve(&ctx, ops.as_array().unwrap())
    }

    fn track(res: &Value, id: &str, prop: &str) -> Vec<(f64, f64)> {
        res["ops"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["op"] == "set_track" && o["id"] == id && o["prop"] == prop)
            .unwrap_or_else(|| panic!("no set_track for {id}.{prop}: {res}"))["keys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| (k["t"].as_f64().unwrap(), k["v"].as_f64().unwrap()))
            .collect()
    }

    #[test]
    fn relative_add_is_computed_in_rust() {
        let c = fixture();
        // x at t=4 is the last key (40); "add 10 over 2s" -> 40 -> 50, no model arithmetic.
        let r = run(&c, &[], 0.0, json!([{ "op": "keyframe", "id": "asset_02", "prop": "x", "value": 10, "modifier": "add", "at": 4, "duration": 2 }]));
        let k = track(&r, "asset_02", "x");
        assert!(k.contains(&(4.0, 40.0)), "{k:?}");
        assert!(k.contains(&(6.0, 50.0)), "{k:?}");
        assert_eq!(k.len(), 5, "existing keys preserved: {k:?}");
    }

    #[test]
    fn relative_multiply_and_clamp() {
        let c = fixture();
        let r = run(&c, &["asset_01".into()], 1.0, json!([{ "op": "keyframe", "prop": "scale", "value": 2, "modifier": "multiply", "duration": 1 }]));
        let k = track(&r, "asset_01", "scale");
        assert_eq!(k, vec![(1.0, 1.0), (2.0, 2.0)]);
        let r = run(&c, &["asset_01".into()], 0.0, json!([{ "op": "keyframe", "prop": "opacity", "value": 5, "modifier": "set", "duration": 1 }]));
        assert_eq!(track(&r, "asset_01", "opacity").last().unwrap().1, 1.0);
    }

    #[test]
    fn ripple_shifts_later_keys_and_splits_segment() {
        let c = fixture();
        // New span 1.5s..2.5s lands inside the 1s..2s / 2s..3s segments of the existing x track.
        let r = run(&c, &[], 0.0, json!([{ "op": "keyframe", "id": "asset_02", "prop": "x", "value": 99, "at": 1.5, "duration": 1 }]));
        let k = track(&r, "asset_02", "x");
        // split: the start key holds the value the old curve had at 1.5s (linear 20 -> 30 => 25)
        assert!(k.contains(&(1.5, 25.0)), "{k:?}");
        assert!(k.contains(&(2.5, 99.0)), "{k:?}");
        // ripple: former keys at 2s and 3s were pushed behind the new span (nothing overwritten)
        let later: Vec<_> = k.iter().filter(|p| p.0 > 2.5).collect();
        assert_eq!(later.len(), 2, "{k:?}");
        assert!(later.iter().any(|p| p.1 == 30.0) && later.iter().any(|p| p.1 == 40.0), "{k:?}");
        assert!(k.windows(2).all(|w| w[0].0 < w[1].0), "strictly increasing: {k:?}");
        // the project grows to fit
        assert!(r["ops"].as_array().unwrap().iter().any(|o| o["op"] == "set_duration" || k.last().unwrap().0 <= 8.0));
    }

    #[test]
    fn speed_multiplier_retimes_without_model_math() {
        let c = fixture();
        let r = run(&c, &["asset_02".into()], 0.0, json!([{ "op": "speed", "speed_multiplier": 2 }]));
        let k = track(&r, "asset_02", "x");
        assert_eq!(k.iter().map(|p| p.0).collect::<Vec<_>>(), vec![0.5, 1.0, 1.5]);
        assert_eq!(k.iter().map(|p| p.1).collect::<Vec<_>>(), vec![20.0, 30.0, 40.0]);
    }

    #[test]
    fn global_speed_also_retimes_story_events() {
        let c = fixture();
        let r = run(&c, &[], 0.0, json!([{ "op": "speed", "speed_multiplier": 2 }]));
        let ev = r["ops"].as_array().unwrap().iter().find(|o| o["op"] == "set_event").expect("event retimed");
        assert_eq!(ev["id"], "ev_01");
        assert_eq!(ev["end"].as_f64().unwrap(), 1.75);
    }

    #[test]
    fn event_relative_timing() {
        let c = fixture();
        let r = run(&c, &[], 0.0, json!([{ "op": "keyframe", "id": "asset_01", "prop": "x", "value": 10, "modifier": "add", "event": "falcon soars", "when": "after", "duration": 1 }]));
        let k = track(&r, "asset_01", "x");
        assert_eq!(k, vec![(3.5, 45.0), (4.5, 55.0)]);
    }

    #[test]
    fn duplicate_lock_blocks_and_reports_reuse() {
        let c = fixture();
        let r = run(&c, &[], 0.0, json!([{ "op": "create_shape", "shape": "circle", "label": "peregrine falcon" }]));
        assert!(r["ops"].as_array().unwrap().is_empty(), "{r}");
        assert_eq!(r["blocked"][0]["reuse"], "asset_01");
        assert_eq!(r["blocked"][0]["id"], "asset_01");
        // a genuinely new name is allowed through
        let r = run(&c, &[], 0.0, json!([{ "op": "create_shape", "shape": "star", "label": "Moon" }]));
        assert_eq!(r["ops"][0]["op"], "create_shape");
    }

    #[test]
    fn alias_references_resolve_to_real_ids() {
        let c = fixture();
        let r = run(&c, &[], 0.0, json!([{ "op": "set_style", "id": "the hawk", "fill": "amber" }]));
        assert_eq!(r["ops"][0]["id"], "asset_01");
        assert_eq!(r["ops"][0]["fill"], "#F59E0B");
    }

    #[test]
    fn internal_ops_from_the_model_are_ignored() {
        let c = fixture();
        let r = run(&c, &[], 0.0, json!([{ "op": "set_track", "id": "asset_02", "prop": "x", "keys": [] }]));
        assert!(r["ops"].as_array().unwrap().is_empty());
        assert!(!r["notes"].as_array().unwrap().is_empty());
    }

    #[test]
    fn every_op_in_the_schema_is_known() {
        for op in schema::MODEL_OPS {
            assert!(schema::OPS.contains(&op));
        }
        let s = schema::action_schema();
        assert_eq!(s["properties"]["ops"]["items"]["properties"]["op"]["enum"].as_array().unwrap().len(), schema::MODEL_OPS.len());
    }
}
