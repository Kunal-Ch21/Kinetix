// Core math: 2D affine matrices, colour helpers, easing (incl. cubic-bezier solver).

export type Mat = [number, number, number, number, number, number];
export const IDENT: Mat = [1, 0, 0, 1, 0, 0];

/** m · n  (n is applied first, then m). Same convention as canvas setTransform. */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const translateM = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scaleM = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];
export function rotateM(deg: number): Mat {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, -s, c, 0, 0];
}
export function applyM(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
export function invertM(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
/** Scale a unit-space matrix to pixel space. */
export const toPx = (m: Mat, u: number): Mat => [m[0] * u, m[1] * u, m[2] * u, m[3] * u, m[4] * u, m[5] * u];

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

// ---------- seeded randomness ----------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Stateless hash -> [0,1) so particles are a pure function of time (scrub-safe). */
export function hash01(seed: number, i: number, k: number): number {
  let h = (seed * 374761393 + i * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- colour ----------
export type RGBA = [number, number, number, number];
const colorCache = new Map<string, RGBA>();
export function parseColor(input: string): RGBA {
  const hit = colorCache.get(input);
  if (hit) return hit;
  let out: RGBA = [255, 255, 255, 1];
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(",").map((x) => parseFloat(x));
      out = [p[0] || 0, p[1] || 0, p[2] || 0, p[3] === undefined || isNaN(p[3]) ? 1 : p[3]];
    } else if (s === "white") out = [255, 255, 255, 1];
    else if (s === "black") out = [0, 0, 0, 1];
  }
  if (colorCache.size > 500) colorCache.clear();
  colorCache.set(input, out);
  return out;
}
export function rgba(color: string, alpha: number): string {
  const c = parseColor(color);
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(c[3] * alpha, 0, 1).toFixed(3)})`;
}
export function mixColor(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  const k = clamp(t, 0, 1);
  return `rgba(${Math.round(lerp(x[0], y[0], k))},${Math.round(lerp(x[1], y[1], k))},${Math.round(lerp(x[2], y[2], k))},${lerp(x[3], y[3], k).toFixed(3)})`;
}
export function toHex(color: string): string {
  const c = parseColor(color);
  return "#" + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

// ---------- easing ----------
export type Ease = string | [number, number, number, number];

const bezCache = new Map<string, (x: number) => number>();
export function cubicBezierFn(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const key = `${x1},${y1},${x2},${y2}`;
  const hit = bezCache.get(key);
  if (hit) return hit;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const fn = (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-5) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-5) break;
      if (e > 0) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
  bezCache.set(key, fn);
  return fn;
}

export const PRESET_BEZIER: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease_in: [0.42, 0, 1, 1],
  ease_out: [0, 0, 0.58, 1],
  ease_in_out: [0.42, 0, 0.58, 1],
  back_out: [0.34, 1.56, 0.64, 1],
  snap: [0.85, 0, 0.15, 1],
};
const bounceOut = (t: number) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
export const spring = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(t * Math.PI * 3.5));
export { bounceOut };

export function resolveEase(e: Ease | undefined): (t: number) => number {
  if (!e) return (t) => t;
  if (Array.isArray(e)) return cubicBezierFn(e[0], e[1], e[2], e[3]);
  if (e === "spring_bounce") return spring;
  if (e === "bounce") return bounceOut;
  if (e === "arc_jump") return (t) => 1 - (1 - t) * (1 - t);
  const p = PRESET_BEZIER[e];
  return p ? cubicBezierFn(p[0], p[1], p[2], p[3]) : (t) => t;
}
export function easeAsBezier(e: Ease | undefined): [number, number, number, number] {
  if (!e) return [0, 0, 1, 1];
  if (Array.isArray(e)) return e;
  return PRESET_BEZIER[e] ?? [0.34, 1.56, 0.64, 1];
}
