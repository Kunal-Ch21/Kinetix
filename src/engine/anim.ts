// Keyframe helpers + built-in parametric motion presets + morph_to builder.
import { mulberry32, round3 } from "./math";
import type { Ease } from "./math";
import { evalObj, stageH } from "./rig";
import type { Scene, SceneObject, Track } from "./types";

export function upsertKey(owner: { tracks: Track[] }, prop: string, t: number, v: number, ease?: Ease) {
  let tr = owner.tracks.find((x) => x.prop === prop);
  if (!tr) {
    tr = { prop, keys: [] };
    owner.tracks.push(tr);
  }
  const tt = round3(t);
  const ex = tr.keys.find((k) => Math.abs(k.t - tt) < 0.0005);
  if (ex) {
    ex.v = v;
    if (ease !== undefined) ex.ease = ease;
  } else {
    tr.keys.push(ease !== undefined ? { t: tt, v, ease } : { t: tt, v });
    tr.keys.sort((a, b) => a.t - b.t);
  }
}

export const PRESETS = ["linear_move", "ease_in_out", "spring_bounce", "arc_jump", "walk_cycle", "orbit", "pulse", "shake"] as const;
export type PresetName = (typeof PRESETS)[number];
type P = Record<string, unknown>;
const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);

export function applyPreset(scene: Scene, o: SceneObject, preset: string, p: P): void {
  const start = num(p.start, 0);
  const dur = Math.max(0.05, num(p.duration, 1));
  const end = start + dur;
  const cur = evalObj(o, start);
  const Hu = stageH(scene);
  const yScale = o.parent ? 1 : 100 / Hu; // stage units -> y value
  switch (preset) {
    case "linear_move":
    case "ease_in_out":
    case "spring_bounce": {
      const ease: Ease = preset === "linear_move" ? "linear" : preset === "ease_in_out" ? "ease_in_out" : "spring_bounce";
      const tx = p.to_x !== undefined ? num(p.to_x, cur.x) : cur.x + num(p.dx, 0);
      const ty = p.to_y !== undefined ? num(p.to_y, cur.y) : cur.y + num(p.dy, 0);
      upsertKey(o, "x", start, cur.x, ease);
      upsertKey(o, "x", end, tx);
      upsertKey(o, "y", start, cur.y, ease);
      upsertKey(o, "y", end, ty);
      break;
    }
    case "arc_jump": {
      const tx = p.to_x !== undefined ? num(p.to_x, cur.x) : cur.x + num(p.dx, 20);
      const ty = p.to_y !== undefined ? num(p.to_y, cur.y) : cur.y + num(p.dy, 0);
      const h = num(p.height, 15) * yScale;
      upsertKey(o, "x", start, cur.x, "linear");
      upsertKey(o, "x", end, tx);
      upsertKey(o, "y", start, cur.y, "ease_out");
      upsertKey(o, "y", start + dur / 2, Math.min(cur.y, ty) - h, "ease_in");
      upsertKey(o, "y", end, ty);
      break;
    }
    case "walk_cycle": {
      const steps = Math.max(1, Math.round(num(p.steps, 6)));
      const dist = num(p.distance, 20);
      const bob = num(p.bob, 0.8) * yScale;
      const sway = num(p.sway, 4);
      upsertKey(o, "x", start, cur.x, "linear");
      upsertKey(o, "x", end, cur.x + dist);
      for (let i = 0; i <= steps * 2; i++) {
        const tt = start + (dur * i) / (steps * 2);
        const up = i % 2 === 1;
        upsertKey(o, "y", tt, up ? cur.y - bob : cur.y, "ease_in_out");
        upsertKey(o, "rotation", tt, cur.rotation + (i % 4 === 1 ? sway : i % 4 === 3 ? -sway : 0), "ease_in_out");
      }
      break;
    }
    case "orbit": {
      const r = num(p.radius, 12);
      const turns = num(p.turns, 1);
      const cx = p.center_x !== undefined ? num(p.center_x, cur.x) : cur.x - r;
      const cy = p.center_y !== undefined ? num(p.center_y, cur.y) : cur.y;
      const n = Math.max(8, Math.round(24 * Math.abs(turns)));
      const a0 = p.center_x !== undefined ? Math.atan2((cur.y - cy) / yScale, cur.x - cx) : 0;
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * turns * Math.PI * 2;
        upsertKey(o, "x", start + (dur * i) / n, cx + Math.cos(a) * r, "linear");
        upsertKey(o, "y", start + (dur * i) / n, cy + Math.sin(a) * r * yScale, "linear");
      }
      break;
    }
    case "pulse": {
      const amp = num(p.amount, 0.15);
      const count = Math.max(1, Math.round(num(p.count, 3)));
      for (let i = 0; i <= count * 2; i++) upsertKey(o, "scale", start + (dur * i) / (count * 2), i % 2 === 1 ? cur.scale * (1 + amp) : cur.scale, "ease_in_out");
      break;
    }
    case "shake": {
      const amp = num(p.amplitude, 1.2);
      const count = Math.max(2, Math.round(num(p.count, 12)));
      const rnd = mulberry32(Math.round(start * 1000) + o.id.length * 97);
      for (let i = 0; i <= count; i++) {
        const last = i === 0 || i === count;
        const fade = 1 - i / count;
        upsertKey(o, "x", start + (dur * i) / count, cur.x + (last ? 0 : (rnd() - 0.5) * 2 * amp * fade), "linear");
        upsertKey(o, "y", start + (dur * i) / count, cur.y + (last ? 0 : (rnd() - 0.5) * 2 * amp * yScale * fade), "linear");
      }
      break;
    }
    default:
      throw new Error(`unknown preset "${preset}"`);
  }
}

/** morph_to: path morph from the object's current geometry to a target path, over [at, at+duration]. */
export function buildMorph(o: SceneObject, targetPath: string, targetFill: string | null, at: number, duration: number, ease: Ease = [0.65, 0, 0.35, 1]) {
  o.morphTo = targetPath;
  if (targetFill) o.fillTo = targetFill;
  o.tracks = o.tracks.filter((t) => t.prop !== "morph");
  upsertKey(o, "morph", Math.max(0, at), 0, ease);
  upsertKey(o, "morph", at + Math.max(0.05, duration), 1);
}
