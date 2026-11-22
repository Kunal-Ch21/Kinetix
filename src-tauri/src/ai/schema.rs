//! Compact system rules + the JSON Schema handed to Ollama's `format` parameter
//! (constrained decoding: the model physically cannot emit filler text or invalid JSON).
//!
//! ONE op vocabulary: the `op` enum below is exactly the set of ops that `src/engine/ops.ts::applyOps`
//! interprets. `ripple::resolve` turns the model's relative ops into absolute ops of the same vocabulary.

use serde_json::{json, Map, Value};

/// Every op understood by `applyOps` (checked against ops.ts by `scripts/check-ops.mjs`).
#[allow(dead_code)]
pub const OPS: [&str; 22] = [
    "create_shape",
    "create_assembly",
    "attach_part",
    "detach_part",
    "clone",
    "morph_to",
    "animate",
    "keyframe",
    "speed",
    "set_rim",
    "set_shadow",
    "set_style",
    "add_light",
    "set_light",
    "add_text",
    "add_emitter",
    "set_background",
    "story_event",
    "delete",
    "set_track",
    "set_event",
    "set_duration",
];

/// Ops the model may emit. The rest (`set_track`, `set_event`, `set_duration`) are produced by the
/// Rust ripple engine only; the model is told not to use them and ripple ignores them if it does.
pub const MODEL_OPS: [&str; 19] = [
    "create_shape",
    "create_assembly",
    "attach_part",
    "detach_part",
    "clone",
    "morph_to",
    "animate",
    "keyframe",
    "speed",
    "set_rim",
    "set_shadow",
    "set_style",
    "add_light",
    "set_light",
    "add_text",
    "add_emitter",
    "set_background",
    "story_event",
    "delete",
];

pub const SYSTEM_RULES: &str = "RULES: JSON only, follow schema. Grid 0-100, (0,0)=top-left. Reuse CAST ids, never duplicate. Never compute math: give relative values {modifier:\"add|multiply|set\",value,speed_multiplier}. ops: create_shape|create_assembly|attach_part|detach_part|clone|morph_to|animate|keyframe|speed|set_rim|set_shadow|set_style|add_light|set_light|add_text|add_emitter|set_background|story_event|delete. keyframe=prop(x|y|rotation|scale|opacity|glow)+value+modifier+at+duration. Lights are invisible emitters: add_light/set_light take origin_x/origin_y -> target_x/target_y (grid), aim=object to cast onto, intensity, cone, falloff, color, at+duration to sweep. svg_path absolute M L C Z only.";

/// Cubic-bezier control points for the named easing presets (same defaults as the dope sheet).
pub fn ease(name: &str) -> [f64; 4] {
    match name {
        "linear" => [0.0, 0.0, 1.0, 1.0],
        "ease_in" => [0.42, 0.0, 1.0, 1.0],
        "ease_out" => [0.0, 0.0, 0.58, 1.0],
        "spring_bounce" => [0.34, 1.56, 0.64, 1.0],
        _ => [0.65, 0.0, 0.35, 1.0],
    }
}

pub const EASES: [&str; 5] = ["linear", "ease_in", "ease_out", "ease_in_out", "spring_bounce"];
pub const SHAPES: [&str; 7] = ["rect", "circle", "ellipse", "star", "polygon", "line", "svg_path"];
pub const EMITTERS: [&str; 6] = ["embers", "sparks", "mist", "rain", "snow", "trail"];
pub const BACKGROUNDS: [&str; 6] = ["none", "dusk", "night", "dawn", "storm", "day"];
pub const PRESETS: [&str; 8] = [
    "linear_move",
    "ease_in_out",
    "spring_bounce",
    "arc_jump",
    "walk_cycle",
    "orbit",
    "pulse",
    "shake",
];
pub const PROPS: [&str; 8] = ["x", "y", "rotation", "scale", "opacity", "morph", "glow", "rim"];

fn enm(values: &[&str]) -> Value {
    json!({ "type": "string", "enum": values })
}

fn part_props() -> Map<String, Value> {
    let mut pp: Map<String, Value> = Map::new();
    for k in ["label", "svg_path", "fill"] {
        pp.insert(k.into(), json!({ "type": "string" }));
    }
    for k in ["w", "h", "r", "dx", "dy", "rotation", "scale"] {
        pp.insert(k.into(), json!({ "type": "number" }));
    }
    pp.insert("shape".into(), enm(&SHAPES));
    pp
}

pub fn action_schema() -> Value {
    let mut p: Map<String, Value> = Map::new();
    p.insert("op".into(), enm(&MODEL_OPS));
    for k in [
        "id", "parent", "source", "follow", "target", "label", "content", "event", "fill", "fillTo", "stroke", "color",
        "color2", "svg_path", "title", "text", "aim",
    ] {
        p.insert(k.into(), json!({ "type": "string" }));
    }
    for k in [
        "x", "y", "w", "h", "r", "rx", "ry", "sides", "points", "outer", "inner", "length", "radius", "rotation", "scale",
        "opacity", "value", "at", "start", "end", "duration", "speed_multiplier", "intensity", "spread", "angle", "cone",
        "size", "rate", "life", "dx", "dy", "to_x", "to_y", "height", "steps", "distance", "glow", "depth", "stroke_width",
        "pivot_x", "pivot_y", "blur", "origin_x", "origin_y", "target_x", "target_y", "falloff",
    ] {
        p.insert(k.into(), json!({ "type": "number" }));
    }
    p.insert("modifier".into(), enm(&["set", "add", "multiply"]));
    p.insert("when".into(), enm(&["before", "during", "after"]));
    p.insert("ease".into(), enm(&EASES));
    p.insert("prop".into(), enm(&PROPS));
    p.insert("shape".into(), enm(&SHAPES));
    p.insert("preset".into(), enm(&PRESETS));
    p.insert("kind".into(), enm(&EMITTERS));
    p.insert("type".into(), enm(&["point", "spot", "sun"]));
    p.insert("background".into(), enm(&BACKGROUNDS));
    p.insert("effect".into(), enm(&["rise", "fade", "pop", "wave", "typewriter", "spin", "drop"]));
    p.insert("unit".into(), enm(&["char", "word"]));
    p.insert("volumetric".into(), json!({ "type": "boolean" }));
    p.insert(
        "parts".into(),
        json!({
            "type": "array",
            "maxItems": 8,
            "items": { "type": "object", "properties": Value::Object(part_props()), "required": ["label"] }
        }),
    );

    json!({
        "type": "object",
        "properties": {
            "ops": {
                "type": "array",
                "maxItems": 6,
                "items": {
                    "type": "object",
                    "properties": Value::Object(p),
                    "required": ["op"]
                }
            }
        },
        "required": ["ops"]
    })
}
