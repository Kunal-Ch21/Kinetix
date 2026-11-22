// Deterministic particle emitters: every particle is a pure function of time, so scrubbing & export are exact.
//
// PERFORMANCE
//  * Zero per-frame allocation: particles are gathered into a fixed struct-of-arrays pool (Float32Array), then drawn.
//  * Hard cap: MAX_TOTAL particles per frame across all emitters (budget is split fairly) — a runaway rate can't
//    tank the frame time.
//  * No ctx.save()/restore() per particle, no string building per particle (colour ramps are pre-baked per emitter).
//  * Emitters that follow an object used to re-resolve the WHOLE scene for every particle. Follow positions are now
//    sampled once per 1/60 s grid step per scene and linearly interpolated (still a pure function of time).
import { clamp, hash01, mixColor } from "./math";
import { anchorNorm, resolveScene, stageH } from "./rig";
import type { Resolved } from "./rig";
import type { Emitter, Scene } from "./types";

const MAX_TOTAL = 1200;
const MAX_PER_EMITTER = 500;
const STEPS = 9;

const sprites = new Map<string, HTMLCanvasElement>();
function sprite(color: string): HTMLCanvasElement {
  let s = sprites.get(color);
  if (!s) {
    s = document.createElement("canvas");
    s.width = s.height = 48;
    const c = s.getContext("2d")!;
    const g = c.createRadialGradient(24, 24, 0, 24, 24, 24);
    g.addColorStop(0, "rgba(255,255,255,0.75)");
    g.addColorStop(0.18, color);
    g.addColorStop(0.55, color.replace(/[\d.]+\)$/, "0.28)"));
    g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
    c.fillStyle = g;
    c.fillRect(0, 0, 48, 48);
    if (sprites.size > 160) sprites.clear();
    sprites.set(color, s);
  }
  return s;
}

const KIND = {
  embers: { shrink: 0.7, grow: 0, alpha: 1, line: false, glow: true },
  sparks: { shrink: 0.4, grow: 0, alpha: 1, line: true, glow: true },
  mist: { shrink: 0, grow: 1.6, alpha: 0.16, line: false, glow: false },
  rain: { shrink: 0, grow: 0, alpha: 0.5, line: true, glow: false },
  snow: { shrink: 0, grow: 0, alpha: 0.85, line: false, glow: false },
  trail: { shrink: 0.85, grow: 0, alpha: 0.6, line: false, glow: true },
} as const;

function toRgba(c: string): string {
  return c.startsWith("rgba(") ? c : mixColor(c, c, 0);
}

interface EmitCfg {
  sprites: HTMLCanvasElement[];
  strokes: string[];
}
const cfgCache = new WeakMap<Emitter, EmitCfg>();
function cfgOf(e: Emitter): EmitCfg {
  let c = cfgCache.get(e);
  if (!c) {
    c = { sprites: [], strokes: [] };
    for (let i = 0; i < STEPS; i++) {
      const col = toRgba(e.color2 ? mixColor(e.color, e.color2, i / (STEPS - 1)) : e.color);
      c.sprites.push(sprite(col));
      c.strokes.push(col.replace(/[\d.]+\)$/, "1)"));
    }
    cfgCache.set(e, c);
  }
  return c;
}

/* ---------- pooled particle storage (allocated once) ---------- */
const P = {
  x: new Float32Array(MAX_PER_EMITTER),
  y: new Float32Array(MAX_PER_EMITTER),
  size: new Float32Array(MAX_PER_EMITTER),
  alpha: new Float32Array(MAX_PER_EMITTER),
  dx: new Float32Array(MAX_PER_EMITTER),
  dy: new Float32Array(MAX_PER_EMITTER),
  step: new Uint8Array(MAX_PER_EMITTER),
  n: 0,
};

/* ---------- follow-position cache (1/60 s grid, per scene object) ---------- */
const FPS = 60;
const followCache = new WeakMap<Scene, Map<number, Map<string, number>>>();
function followIds(scene: Scene): string[] {
  const out: string[] = [];
  for (const e of scene.emitters) if (e.follow && !out.includes(e.follow)) out.push(e.follow);
  return out;
}
function sampleAt(scene: Scene, idx: number): Map<string, number> {
  let m = followCache.get(scene);
  if (!m) {
    m = new Map();
    followCache.set(scene, m);
  }
  let row = m.get(idx);
  if (!row) {
    row = new Map();
    const t = idx / FPS;
    const res = resolveScene(scene, t);
    for (const id of followIds(scene)) {
      const a = anchorNorm(scene, id, t, res);
      if (a) {
        row.set(id + ":x", a.x);
        row.set(id + ":y", a.y);
      }
    }
    if (m.size > 8000) m.clear();
    m.set(idx, row);
  }
  return row;
}
const fp = { x: 0, y: 0 };
function followAt(scene: Scene, id: string, t: number): boolean {
  const f = Math.max(0, t) * FPS;
  const i0 = Math.floor(f);
  const k = f - i0;
  const a = sampleAt(scene, i0);
  const ax = a.get(id + ":x");
  const ay = a.get(id + ":y");
  if (ax === undefined || ay === undefined) return false;
  const b = sampleAt(scene, i0 + 1);
  fp.x = ax + ((b.get(id + ":x") ?? ax) - ax) * k;
  fp.y = ay + ((b.get(id + ":y") ?? ay) - ay) * k;
  return true;
}

/** Draws all emitters of one layer. Returns true when the bloom (glow) buffer received pixels. */
export function drawEmitters(
  ctx: CanvasRenderingContext2D,
  glow: CanvasRenderingContext2D,
  scene: Scene,
  t: number,
  layer: "back" | "front",
  u: number,
  res: Map<string, Resolved>,
): boolean {
  const Hu = stageH(scene);
  let glowUsed = false;
  let budget = MAX_TOTAL;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = "round";
  for (const e of scene.emitters) {
    if (!e.visible || e.layer !== layer || t < e.start || budget <= 0) continue;
    const kind = KIND[e.kind];
    const live = e.end > 0 ? Math.min(t, e.end) : t;
    const iMax = Math.floor((live - e.start) * e.rate);
    const iMin = Math.max(0, Math.ceil((t - e.life - e.start) * e.rate));
    if (iMax < iMin) continue;
    const cap = Math.min(MAX_PER_EMITTER, budget);
    const step = Math.max(1, Math.ceil((iMax - iMin + 1) / cap));
    // gather into the pool
    P.n = 0;
    for (let i = iMin; i <= iMax && P.n < cap; i += step) gather(scene, e, kind, i, t, u, Hu, res);
    budget -= P.n;
    if (!P.n) continue;
    const cfg = cfgOf(e);
    ctx.globalCompositeOperation = e.additive ? "lighter" : "source-over";
    const bloom = kind.glow && e.additive;
    if (bloom) {
      glow.save();
      glow.setTransform(1, 0, 0, 1, 0, 0);
      glow.globalCompositeOperation = "lighter";
      glowUsed = true;
    }
    for (let j = 0; j < P.n; j++) {
      const a = P.alpha[j];
      if (kind.line) {
        ctx.globalAlpha = a;
        ctx.strokeStyle = cfg.strokes[P.step[j]];
        ctx.lineWidth = P.size[j];
        ctx.beginPath();
        ctx.moveTo(P.x[j], P.y[j]);
        ctx.lineTo(P.x[j] - P.dx[j], P.y[j] - P.dy[j]);
        ctx.stroke();
      } else {
        const s = P.size[j];
        const sp = cfg.sprites[P.step[j]];
        ctx.globalAlpha = a;
        ctx.drawImage(sp, P.x[j] - s, P.y[j] - s, s * 2, s * 2);
        if (bloom) {
          glow.globalAlpha = a * 0.7 > 1 ? 1 : a * 0.7;
          glow.drawImage(sp, P.x[j] - s * 1.8, P.y[j] - s * 1.8, s * 3.6, s * 3.6);
        }
      }
    }
    if (bloom) glow.restore();
  }
  ctx.restore();
  return glowUsed;
}

function gather(scene: Scene, e: Emitter, cfg: (typeof KIND)[keyof typeof KIND], i: number, t: number, u: number, Hu: number, res: Map<string, Resolved>) {
  const tb = e.start + i / e.rate;
  const age = t - tb;
  if (age < 0 || age > e.life) return;
  const f = age / e.life;
  const r1 = hash01(e.seed, i, 1);
  const r2 = hash01(e.seed, i, 2);
  const r3 = hash01(e.seed, i, 3);
  let ox = e.x;
  let oy = e.y;
  if (e.follow) {
    if (age < 1 / 120) {
      const a = anchorNorm(scene, e.follow, tb, res);
      if (a) {
        ox = a.x;
        oy = a.y;
      }
    } else if (followAt(scene, e.follow, tb)) {
      ox = fp.x;
      oy = fp.y;
    }
  }
  ox += (r1 - 0.5) * e.area;
  const ang = ((e.angle + (r2 - 0.5) * e.spread) * Math.PI) / 180;
  const v = e.speed * (0.6 + 0.8 * r3);
  let px = ox + Math.cos(ang) * v * age;
  const py = (oy / 100) * Hu + Math.sin(ang) * v * age + 0.5 * e.gravity * age * age;
  if (e.kind === "snow") px += Math.sin(age * 1.3 + r1 * 6.28) * 1.2;
  if (e.kind === "mist") px += Math.sin(age * 0.5 + r2 * 6.28) * 1.5;
  const fadeIn = clamp(f / 0.08, 0, 1);
  let alpha = fadeIn * (1 - f) * cfg.alpha;
  if (e.kind === "embers") alpha *= 0.7 + 0.3 * Math.sin(age * 18 + r1 * 40);
  const size = e.size * (0.6 + 0.8 * r2) * (1 - f * cfg.shrink) * (1 + f * cfg.grow);
  if (alpha <= 0.01 || size <= 0) return;
  const n = P.n++;
  P.x[n] = px * u;
  P.y[n] = py * u;
  P.alpha[n] = alpha > 1 ? 1 : alpha;
  P.step[n] = e.color2 ? Math.min(STEPS - 1, Math.round(f * (STEPS - 1))) : 0;
  if (cfg.line) {
    const vx = Math.cos(ang) * v;
    const vy = Math.sin(ang) * v + e.gravity * age;
    const len = e.kind === "rain" ? 2.4 : 0.9;
    const m = Math.hypot(vx, vy) || 1;
    P.dx[n] = (vx / m) * len * u;
    P.dy[n] = (vy / m) * len * u;
    P.size[n] = Math.max(1, size * u * (e.kind === "rain" ? 0.18 : 0.5));
  } else {
    P.size[n] = size * u;
  }
}
