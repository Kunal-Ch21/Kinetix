// Declarative op interpreter: the JSON vocabulary a stateless local LLM (or a docs recipe) emits.
// All arithmetic (relative modifiers, ripple, morph timing) is deterministic code — never done by the model.
import { PRESETS, applyPreset, buildMorph, upsertKey } from "./anim";
import { Ease, PRESET_BEZIER, round3 } from "./math";
import { evalObj, evalProp } from "./rig";
import { ENV_PRESETS, cloneEnv, descendantsOf, findObject, makeEmitter, makeLight, makeObject, newId } from "./scene";
import { shapeToPath } from "./shapes";
import type { EmitterKind, Light, Scene, SceneObject, TextSpec } from "./types";

type Op = Record<string, unknown>;
const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" && v ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

function parseEase(v: unknown): Ease | undefined {
  if (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "number")) return v as [number, number, number, number];
  if (typeof v === "string") return v in PRESET_BEZIER || ["spring_bounce", "bounce", "arc_jump"].includes(v) ? v : undefined;
  return undefined;
}

/** Copy whitelisted styling / transform fields from an op onto an object. */
function styleObject(o: SceneObject, p: Op) {
  if (p.x !== undefined) o.x = num(p.x, o.x);
  if (p.y !== undefined) o.y = num(p.y, o.y);
  if (p.dx !== undefined) o.x = num(p.dx, o.x);
  if (p.dy !== undefined) o.y = num(p.dy, o.y);
  if (p.rotation !== undefined) o.rotation = num(p.rotation, o.rotation);
  if (p.scale !== undefined) o.scale = num(p.scale, o.scale);
  if (p.opacity !== undefined) o.opacity = num(p.opacity, o.opacity);
  if (p.pivot_x !== undefined) o.pivotX = num(p.pivot_x, o.pivotX);
  if (p.pivot_y !== undefined) o.pivotY = num(p.pivot_y, o.pivotY);
  if (typeof p.fill === "string") o.fill = p.fill;
  if (typeof p.stroke === "string") o.stroke = p.stroke === "none" ? null : p.stroke;
  if (p.stroke_width !== undefined) o.strokeWidth = num(p.stroke_width, o.strokeWidth);
  if (typeof p.blend === "string") o.blend = p.blend as GlobalCompositeOperation;
  if (p.glow !== undefined) o.glow = num(p.glow, o.glow);
  if (p.depth !== undefined) o.depth = num(p.depth, o.depth);
  if (p.ao !== undefined) o.ao = num(p.ao, o.ao);
  if (p.lit !== undefined) o.lit = bool(p.lit, o.lit);
  if (Array.isArray(p.aliases)) o.aliases = p.aliases.map(String);
  if (Array.isArray(p.tags)) o.tags = p.tags.map(String);
  if (p.gradient && typeof p.gradient === "object") {
    const g = p.gradient as Op;
    o.gradient = { from: str(g.from, "#ffffff"), to: str(g.to, "#000000"), angle: num(g.angle, 90) };
  }
  if (p.rim && typeof p.rim === "object") setRim(o, p.rim as Op);
  if (p.shadow && typeof p.shadow === "object") setShadow(o, p.shadow as Op);
}
function setRim(o: SceneObject, p: Op) {
  const r = o.rim ?? { color: "#06B6D4", intensity: 1, spread: 0.8, lightColor: false, angle: -45 };
  o.rim = {
    color: str(p.color, r.color),
    intensity: num(p.intensity, r.intensity),
    spread: num(p.spread, r.spread),
    lightColor: bool(p.light_color ?? p.lightColor, r.lightColor),
    angle: num(p.angle, r.angle),
  };
  o.lit = true;
}
function setShadow(o: SceneObject, p: Op) {
  const s = o.shadow ?? { opacity: 0.4, blur: 3, dx: 3, dy: 3, auto: true };
  o.shadow = { opacity: num(p.opacity, s.opacity), blur: num(p.blur, s.blur), dx: num(p.dx ?? p.distance, s.dx), dy: num(p.dy, s.dy), auto: bool(p.auto, p.dx === undefined && p.dy === undefined ? true : false) };
}

function need(scene: Scene, ref: unknown, what = "object"): SceneObject {
  const o = findObject(scene, ref);
  if (!o) throw new Error(`${what} "${String(ref)}" not found`);
  return o;
}

function createShape(scene: Scene, p: Op, parent: SceneObject | null = null): SceneObject {
  const label = str(p.label, str(p.shape, "Shape"));
  // Hard duplicate lock: same label returns the existing object instead of making a twin.
  const dupe = scene.objects.find((x) => x.label.toLowerCase() === label.toLowerCase() && x.parent === (parent ? parent.id : null));
  if (dupe && !p.force_new) {
    styleObject(dupe, p);
    return dupe;
  }
  const { d, strokeOnly } = shapeToPath(p);
  const o = makeObject({ id: str(p.id, newId(scene, "asset")), label, path: d, x: 50, y: 50 });
  if (strokeOnly) {
    o.fill = "none";
    o.stroke = "#E5E7EB";
    o.strokeWidth = 0.6;
  }
  if (parent) {
    o.parent = parent.id;
    o.x = 0;
    o.y = 0;
  }
  styleObject(o, p);
  scene.objects.push(o);
  return o;
}

function attach(scene: Scene, child: SceneObject, parent: SceneObject, p: Op) {
  if (child.id === parent.id || descendantsOf(scene, child.id).some((d) => d.id === parent.id)) throw new Error("cannot attach: would create a cycle");
  child.parent = parent.id;
  child.x = num(p.dx, num(p.x, 0));
  child.y = num(p.dy, num(p.y, 0));
  if (p.rotation !== undefined) child.rotation = num(p.rotation, 0);
  if (p.scale !== undefined) child.scale = num(p.scale, 1);
  if (p.pivot_x !== undefined) child.pivotX = num(p.pivot_x, 0);
  if (p.pivot_y !== undefined) child.pivotY = num(p.pivot_y, 0);
  // keep z-order sane: children render after their parent
  const pi = scene.objects.indexOf(parent);
  const ci = scene.objects.indexOf(child);
  if (ci < pi) {
    scene.objects.splice(ci, 1);
    scene.objects.splice(scene.objects.indexOf(parent) + 1, 0, child);
  }
}

/** clone: deep-copy an object + its whole rig subtree, then apply differential overrides. */
export function cloneObject(scene: Scene, src: SceneObject, label: string, overrides: Op = {}, partOverrides: Op = {}, addParts: Op[] = []): SceneObject {
  const family = [src, ...descendantsOf(scene, src.id)];
  const idMap = new Map<string, string>();
  const copies: SceneObject[] = [];
  for (const o of family) {
    const c = JSON.parse(JSON.stringify(o)) as SceneObject;
    c.id = newId(scene, "asset");
    idMap.set(o.id, c.id);
    copies.push(c);
  }
  copies.forEach((c, i) => {
    const orig = family[i];
    c.parent = i === 0 ? src.parent : orig.parent ? (idMap.get(orig.parent) ?? orig.parent) : null;
    if (i > 0) c.label = orig.label;
  });
  const root = copies[0];
  root.label = label;
  root.aliases = [];
  root.x = src.x + 8;
  root.y = src.y + 8;
  // Roots with position tracks: shift the whole track too, so the clone is visibly offset.
  for (const tr of root.tracks) if (tr.prop === "x" || tr.prop === "y") tr.keys.forEach((k) => (k.v += 8));
  styleObject(root, overrides);
  for (const [ref, ov] of Object.entries(partOverrides)) {
    const hit = copies.find((c) => c.label.toLowerCase() === ref.toLowerCase());
    if (hit && ov && typeof ov === "object") styleObject(hit, ov as Op);
  }
  const at = scene.objects.indexOf(src);
  const lastIdx = Math.max(at, ...family.map((f) => scene.objects.indexOf(f)));
  scene.objects.splice(lastIdx + 1, 0, ...copies);
  for (const part of addParts) createShape(scene, { ...part, force_new: true }, root);
  return root;
}

function addText(scene: Scene, p: Op): SceneObject {
  const text: TextSpec = {
    content: str(p.content ?? p.text, "Text"),
    size: num(p.size, 6),
    weight: num(p.weight, 700),
    align: (str(p.align, "center") as TextSpec["align"]),
    unit: (str(p.unit, "char") as TextSpec["unit"]),
    effect: (str(p.effect, "rise") as TextSpec["effect"]),
    stagger: num(p.stagger, 0.06),
    duration: num(p.duration, 0.6),
    start: num(p.start, 0),
    font: (str(p.font, "sans") as TextSpec["font"]),
  };
  const o = makeObject({ id: str(p.id, newId(scene, "txt")), label: str(p.label, text.content.slice(0, 24)), kind: "text", text, path: "", x: 50, y: 50, fill: "#F4F6FB" });
  styleObject(o, p);
  scene.objects.push(o);
  return o;
}


/* ------------------------------------------------------------------ lights (invisible studio emitters) */

export function findLight(scene: Scene, ref: unknown): Light | undefined {
  if (typeof ref !== "string" || !ref) return undefined;
  const q = ref.trim().toLowerCase();
  const L = scene.lights;
  return (
    L.find((l) => l.id.toLowerCase() === q) ??
    L.find((l) => l.label.toLowerCase() === q) ??
    L.find((l) => l.label.toLowerCase().includes(q) || q.includes(l.label.toLowerCase())) ??
    (q === "rim" || q.includes("rim") ? L.find((l) => l.type === "sun") : undefined) ??
    (q.includes("spot") || q.includes("beam") ? L.find((l) => l.type === "spot") : undefined)
  );
}

/** Centre of an object (0-100 grid) at time t — where an `aim` points the beam. */
function aimPoint(scene: Scene, ref: unknown, t: number): { o: SceneObject; x: number; y: number } | null {
  const o = findObject(scene, ref);
  if (!o) return null;
  const e = evalObj(o, t);
  return { o, x: e.x, y: e.y };
}

const LIGHT_PROPS: [string, string][] = [
  ["origin_x", "x"],
  ["origin_y", "y"],
  ["target_x", "tx"],
  ["target_y", "ty"],
  ["intensity", "intensity"],
  ["cone", "cone"],
  ["falloff", "radius"],
  ["radius", "radius"],
];

/** Make sure an object can show a rim highlight from the lights that hit it. */
function ensureRim(o: SceneObject) {
  if (!o.rim) setRim(o, { light_color: true, intensity: 1, spread: 0.8 });
  else o.lit = true;
}

/**
 * Create / re-aim a light. Static when no duration is given; with `at` + `duration` the origin, target, intensity and
 * cone are keyframed from their value at `at` to the new value at `at + duration` (a smooth sweep).
 */
function configureLight(scene: Scene, l: Light, p: Op, creating: boolean) {
  const at = num(p.at ?? p.start, 0);
  const dur = Math.max(0, num(p.duration, 0));
  const ease = parseEase(p.ease) ?? "ease_in_out";
  if (typeof p.type === "string" && ["point", "spot", "sun"].includes(p.type)) l.type = p.type as Light["type"];
  if (typeof p.color === "string") l.color = p.color;
  if (typeof p.label === "string" && p.label) l.label = p.label;
  if (p.volumetric !== undefined) l.volumetric = bool(p.volumetric, l.volumetric);
  if (p.visible !== undefined) l.visible = bool(p.visible, l.visible);
  const vals: Record<string, number> = {};
  for (const [k, prop] of LIGHT_PROPS) if (p[k] !== undefined) vals[prop] = num(p[k], (l as unknown as Record<string, number>)[prop]);
  if (p.x !== undefined && vals.x === undefined) vals.x = num(p.x, l.x);
  if (p.y !== undefined && vals.y === undefined) vals.y = num(p.y, l.y);
  if (p.to_x !== undefined) vals.tx = num(p.to_x, l.tx ?? 50);
  if (p.to_y !== undefined) vals.ty = num(p.to_y, l.ty ?? 50);
  const aim = p.aim !== undefined ? aimPoint(scene, p.aim, at + dur) : null;
  if (p.aim !== undefined && !aim) throw new Error(`aim object "${String(p.aim)}" not found`);
  if (aim) {
    vals.tx = aim.x;
    vals.ty = aim.y;
    if (l.type !== "point") ensureRim(aim.o);
    if (bool(p.exclusive, false)) l.affects = [aim.o.id];
  }
  if (Array.isArray(p.affects)) {
    l.affects = p.affects.map((r) => findObject(scene, r)?.id).filter((x): x is string => !!x);
  }
  if (creating && l.tx === undefined && l.type !== "point") {
    // sensible default aim: straight down the legacy beam angle
    const a = (l.angle * Math.PI) / 180;
    l.tx = vals.tx ?? l.x + Math.cos(a) * 30;
    l.ty = vals.ty ?? l.y + Math.sin(a) * 30;
  }
  const rec = l as unknown as Record<string, number | undefined>;
  for (const [prop, v] of Object.entries(vals)) {
    const cur = evalProp(l.tracks, prop, at, rec[prop] ?? (prop === "tx" ? l.x : prop === "ty" ? l.y : 0));
    if (dur > 0) {
      upsertKey(l, prop, at, round3(cur), ease);
      upsertKey(l, prop, at + dur, round3(v), ease);
    } else if (l.tracks.some((t) => t.prop === prop && t.keys.length)) upsertKey(l, prop, at, round3(v), ease);
    else rec[prop] = round3(v);
  }
}

export function applyOps(scene: Scene, ops: unknown): string[] {
  const list: Op[] = Array.isArray(ops) ? (ops as Op[]) : ops && typeof ops === "object" ? [ops as Op] : [];
  const log: string[] = [];
  for (const p of list) {
    const name = str(p.op ?? p.action, "");
    try {
      switch (name) {
        case "create_shape": {
          const parent = typeof p.parent === "string" ? (findObject(scene, p.parent) ?? null) : null;
          const o = createShape(scene, p, parent);
          log.push(`create_shape → ${o.label} (${o.id})`);
          break;
        }
        case "create_assembly": {
          const root = createShape(scene, { ...p, shape: p.shape ?? "circle", r: p.r ?? 1, fill: p.fill ?? "none", opacity: p.opacity ?? 1 });
          const parts = Array.isArray(p.parts) ? (p.parts as Op[]) : [];
          for (const part of parts) createShape(scene, part, root);
          log.push(`create_assembly → ${root.label} with ${parts.length} parts`);
          break;
        }
        case "attach_part": {
          const child = need(scene, p.id ?? p.child, "part");
          const parent = need(scene, p.parent, "parent");
          attach(scene, child, parent, p);
          log.push(`attach_part → ${child.label} → ${parent.label}`);
          break;
        }
        case "detach_part": {
          const c = need(scene, p.id, "part");
          c.parent = null;
          log.push(`detach_part → ${c.label}`);
          break;
        }
        case "clone": {
          const src = need(scene, p.source ?? p.id, "source");
          const c = cloneObject(scene, src, str(p.label, `${src.label} Variant`), (p.overrides as Op) ?? p, (p.part_overrides as Op) ?? {}, Array.isArray(p.add_parts) ? (p.add_parts as Op[]) : []);
          log.push(`clone → ${c.label} (${c.id}) from ${src.label}`);
          break;
        }
        case "morph_to": {
          const o = need(scene, p.id, "object");
          let path = "";
          let fillTo: string | null = typeof p.fill === "string" ? p.fill : null;
          if (p.target && typeof p.target === "object") path = shapeToPath(p.target as Op).d;
          else if (typeof p.svg_path === "string") path = p.svg_path;
          else if (p.shape) path = shapeToPath(p).d;
          else {
            const t = need(scene, p.target, "morph target");
            path = t.path;
            fillTo = fillTo ?? t.fill;
          }
          buildMorph(o, path, fillTo, num(p.at, 0), num(p.duration, 1.5), parseEase(p.ease));
          log.push(`morph_to → ${o.label} @${num(p.at, 0)}s for ${num(p.duration, 1.5)}s`);
          break;
        }
        case "animate": {
          const o = need(scene, p.id, "object");
          const preset = str(p.preset, "ease_in_out");
          if (!(PRESETS as readonly string[]).includes(preset)) throw new Error(`unknown preset ${preset}`);
          applyPreset(scene, o, preset, p);
          log.push(`animate → ${o.label}: ${preset}`);
          break;
        }
        case "keyframe": {
          const o = need(scene, p.id, "object");
          const prop = str(p.prop, "x");
          const t = num(p.t ?? p.at, 0);
          let v = num(p.value, 0);
          const cur = (evalObj(o, t) as unknown as Record<string, number>)[prop] ?? 0;
          if (p.modifier === "add" || (p.op2 === "add")) v = cur + v;
          else if (p.modifier === "multiply" || p.op2 === "multiply") v = cur * v;
          upsertKey(o, prop, t, round3(v), parseEase(p.ease));
          log.push(`keyframe → ${o.label}.${prop}@${t}s = ${round3(v)}`);
          break;
        }
        case "speed": {
          // speed_multiplier on an object's tracks: deterministic time-scaling, no LLM arithmetic.
          const o = need(scene, p.id, "object");
          const k = num(p.speed_multiplier, 1) || 1;
          for (const tr of o.tracks) tr.keys.forEach((key) => (key.t = round3(key.t / k)));
          log.push(`speed → ${o.label} ×${k}`);
          break;
        }
        case "set_rim": {
          const o = need(scene, p.id, "object");
          setRim(o, p);
          log.push(`set_rim → ${o.label}`);
          break;
        }
        case "set_shadow": {
          const o = need(scene, p.id, "object");
          setShadow(o, p);
          log.push(`set_shadow → ${o.label}`);
          break;
        }
        case "set_style": {
          const o = need(scene, p.id, "object");
          styleObject(o, p);
          log.push(`set_style → ${o.label}`);
          break;
        }
        case "add_light": {
          const l = makeLight({
            id: str(p.id, newId(scene, "lt")),
            label: str(p.label, `${str(p.type, "point")} light`),
            type: str(p.type, "point") as "point" | "spot" | "sun",
            x: num(p.origin_x ?? p.x, 50),
            y: num(p.origin_y ?? p.y, 30),
            color: str(p.color, "#FFD08A"),
            intensity: num(p.intensity, 1),
            radius: num(p.falloff ?? p.radius, 50),
            angle: num(p.angle, 90),
            cone: num(p.cone, 28),
            volumetric: bool(p.volumetric, true),
            follow: typeof p.follow === "string" ? (findObject(scene, p.follow)?.id ?? null) : null,
          });
          configureLight(scene, l, { ...p, id: undefined, label: undefined, type: undefined, color: undefined, origin_x: undefined, origin_y: undefined, x: undefined, y: undefined, intensity: undefined, falloff: undefined, radius: undefined, cone: undefined, volumetric: undefined, at: p.duration ? p.at : 0 }, true);
          if (p.target_x !== undefined) l.tx = num(p.target_x, l.tx ?? 50);
          if (p.target_y !== undefined) l.ty = num(p.target_y, l.ty ?? 50);
          scene.lights.push(l);
          log.push(`add_light → ${l.label} (${l.id})`);
          break;
        }
        case "set_light": {
          const l = findLight(scene, p.id ?? p.target ?? p.label);
          if (!l) throw new Error(`light "${String(p.id ?? p.target ?? p.label)}" not found`);
          configureLight(scene, l, { ...p, label: undefined }, false);
          log.push(`set_light → ${l.label}`);
          break;
        }
        case "add_text": {
          const o = addText(scene, p);
          log.push(`add_text → "${o.text?.content}" (${o.text?.effect}/${o.text?.unit})`);
          break;
        }
        case "add_emitter": {
          const kind = str(p.kind, "embers") as EmitterKind;
          const defaults: Record<EmitterKind, Partial<ReturnType<typeof makeEmitter>>> = {
            embers: { rate: 18, life: 4, speed: 3, angle: -90, spread: 50, size: 0.7, color: "#FFB347", gravity: -0.4, y: 100, area: 100 },
            sparks: { rate: 40, life: 0.9, speed: 14, angle: -90, spread: 120, size: 0.5, color: "#FFE08A", gravity: 18, y: 70, area: 4 },
            mist: { rate: 3, life: 9, speed: 1.2, angle: 0, spread: 20, size: 12, color: "#C9D6F0", gravity: 0, y: 85, area: 100, additive: false, layer: "back" },
            rain: { rate: 120, life: 1.1, speed: 55, angle: 100, spread: 6, size: 1, color: "#BFD7FF", gravity: 0, y: -4, area: 110, additive: false },
            snow: { rate: 40, life: 9, speed: 3, angle: 90, spread: 30, size: 0.45, color: "#FFFFFF", gravity: 0, y: -4, area: 110, additive: false },
            trail: { rate: 80, life: 1.2, speed: 2, angle: 180, spread: 60, size: 0.9, color: "#F59E0B", gravity: 0, area: 0 },
          };
          const d = defaults[kind] ?? defaults.embers;
          const follow = typeof p.follow === "string" ? (findObject(scene, p.follow)?.id ?? null) : null;
          const e = makeEmitter({
            ...d,
            id: str(p.id, newId(scene, "em")),
            label: str(p.label, `${kind} emitter`),
            kind,
            follow,
            ...(p.x !== undefined ? { x: num(p.x, 50) } : {}),
            ...(p.y !== undefined ? { y: num(p.y, 50) } : {}),
            ...(p.rate !== undefined ? { rate: num(p.rate, 20) } : {}),
            ...(p.life !== undefined ? { life: num(p.life, 3) } : {}),
            ...(p.color !== undefined ? { color: str(p.color, "#FFB347") } : {}),
            ...(p.color2 !== undefined ? { color2: str(p.color2, "#FF5533") } : {}),
            ...(p.size !== undefined ? { size: num(p.size, 0.8) } : {}),
            ...(p.start !== undefined ? { start: num(p.start, 0) } : {}),
            ...(p.end !== undefined ? { end: num(p.end, 0) } : {}),
            ...(p.area !== undefined ? { area: num(p.area, 100) } : {}),
          });
          scene.emitters.push(e);
          log.push(`add_emitter → ${e.label} (${e.id})`);
          break;
        }
        case "set_background": {
          const key = str(p.background ?? p.preset, "dusk");
          const preset = ENV_PRESETS[key];
          if (!preset) throw new Error(`unknown background preset "${key}" (${Object.keys(ENV_PRESETS).join(", ")})`);
          scene.env = cloneEnv(preset);
          log.push(`set_background → ${key}`);
          break;
        }
        case "set_track": {
          // Absolute track replacement computed by the Rust ripple engine (relative math, shift, split, retime).
          const o = findObject(scene, p.id) ?? scene.lights.find((l) => l.id === p.id);
          if (!o) throw new Error(`object "${String(p.id)}" not found`);
          const prop = str(p.prop, "x");
          const keys = (Array.isArray(p.keys) ? (p.keys as Op[]) : []).map((k) => {
            const e = parseEase(k.ease);
            return e !== undefined ? { t: round3(num(k.t, 0)), v: num(k.v, 0), ease: e } : { t: round3(num(k.t, 0)), v: num(k.v, 0) };
          });
          keys.sort((a, b) => a.t - b.t);
          o.tracks = o.tracks.filter((tr) => tr.prop !== prop);
          if (keys.length) o.tracks.push({ prop, keys });
          log.push(`set_track → ${o.label}.${prop} (${keys.length} keys)`);
          break;
        }
        case "set_event": {
          const ev = scene.events.find((e) => e.id === p.id);
          if (!ev) throw new Error(`event "${String(p.id)}" not found`);
          ev.start = num(p.start, ev.start);
          ev.end = num(p.end, ev.end);
          if (typeof p.title === "string") ev.title = p.title;
          log.push(`set_event → ${ev.title} ${ev.start}s–${ev.end}s`);
          break;
        }
        case "set_duration": {
          scene.duration = Math.max(1, Math.min(120, num(p.duration, scene.duration)));
          log.push(`set_duration → ${scene.duration}s`);
          break;
        }
        case "story_event": {
          scene.events.push({ id: newId(scene, "ev"), start: num(p.start, 0), end: num(p.end, 1), title: str(p.title, "Event") });
          log.push(`story_event → ${str(p.title, "Event")}`);
          break;
        }
        case "delete": {
          const o = need(scene, p.id, "object");
          const kill = new Set([o.id, ...descendantsOf(scene, o.id).map((d) => d.id)]);
          scene.objects = scene.objects.filter((x) => !kill.has(x.id));
          log.push(`delete → ${o.label}`);
          break;
        }
        default:
          throw new Error(`unknown op "${name}"`);
      }
    } catch (e) {
      log.push(`✗ ${name || "?"}: ${(e as Error).message}`);
    }
  }
  return log;
}
