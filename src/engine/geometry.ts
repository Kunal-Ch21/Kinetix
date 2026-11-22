import type { Anchor, BezierPath, ShapeKind, SubPath, Vec2 } from "./types";

/* ---------- construction helpers ---------- */

export const corner = (x: number, y: number): Anchor => ({ x, y, ix: x, iy: y, ox: x, oy: y });

export function clonePath(p: BezierPath): BezierPath {
  return p.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ ...a })) }));
}

export function mapPath(p: BezierPath, f: (x: number, y: number) => Vec2): BezierPath {
  return p.map((s) => ({
    closed: s.closed,
    anchors: s.anchors.map((a) => {
      const [x, y] = f(a.x, a.y);
      const [ix, iy] = f(a.ix, a.iy);
      const [ox, oy] = f(a.ox, a.oy);
      return { x, y, ix, iy, ox, oy };
    }),
  }));
}

export const translatePath = (p: BezierPath, dx: number, dy: number) =>
  mapPath(p, (x, y) => [x + dx, y + dy]);

/* ---------- SVG path (M L C Z, absolute) <-> BezierPath ---------- */

export function parseSvgPath(d: string): BezierPath {
  const tokens = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const out: BezierPath = [];
  let cur: SubPath | null = null;
  let i = 0;
  let cmd = "";
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    const tk = tokens[i];
    if (/[A-Za-z]/.test(tk)) {
      cmd = tk.toUpperCase();
      i++;
      if (cmd === "Z") {
        if (cur) {
          cur.closed = true;
          const f = cur.anchors[0];
          const l = cur.anchors[cur.anchors.length - 1];
          if (cur.anchors.length > 1 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
            f.ix = l.ix;
            f.iy = l.iy;
            cur.anchors.pop();
          }
        }
        cur = null;
      }
      continue;
    }
    if (cmd === "M") {
      const x = num();
      const y = num();
      cur = { anchors: [corner(x, y)], closed: false };
      out.push(cur);
      cmd = "L";
    } else if (cmd === "L") {
      const x = num();
      const y = num();
      if (!cur) {
        cur = { anchors: [], closed: false };
        out.push(cur);
      }
      cur.anchors.push(corner(x, y));
    } else if (cmd === "C") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      if (!cur) {
        cur = { anchors: [corner(x1, y1)], closed: false };
        out.push(cur);
      }
      const prev = cur.anchors[cur.anchors.length - 1];
      prev.ox = x1;
      prev.oy = y1;
      cur.anchors.push({ x, y, ix: x2, iy: y2, ox: x, oy: y });
    } else {
      i++;
    }
  }
  return out.filter((s) => s.anchors.length > 0);
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

export function toSvgPath(p: BezierPath): string {
  let d = "";
  for (const s of p) {
    const a = s.anchors;
    if (!a.length) continue;
    d += `M${f2(a[0].x)} ${f2(a[0].y)}`;
    const seg = (p0: Anchor, p1: Anchor) =>
      `C${f2(p0.ox)} ${f2(p0.oy)} ${f2(p1.ix)} ${f2(p1.iy)} ${f2(p1.x)} ${f2(p1.y)}`;
    for (let i = 1; i < a.length; i++) d += seg(a[i - 1], a[i]);
    if (s.closed && a.length > 1) d += seg(a[a.length - 1], a[0]) + "Z";
  }
  return d;
}

export function toPath2D(p: BezierPath): Path2D {
  const path = new Path2D();
  for (const s of p) {
    const a = s.anchors;
    if (!a.length) continue;
    path.moveTo(a[0].x, a[0].y);
    for (let i = 1; i < a.length; i++) {
      path.bezierCurveTo(a[i - 1].ox, a[i - 1].oy, a[i].ix, a[i].iy, a[i].x, a[i].y);
    }
    if (s.closed && a.length > 1) {
      const l = a[a.length - 1];
      path.bezierCurveTo(l.ox, l.oy, a[0].ix, a[0].iy, a[0].x, a[0].y);
      path.closePath();
    }
  }
  return path;
}

const cache = new WeakMap<object, Path2D>();
export function cachedPath2D(p: BezierPath): Path2D {
  let c = cache.get(p);
  if (!c) {
    c = toPath2D(p);
    cache.set(p, c);
  }
  return c;
}

/* ---------- sampling / bounds ---------- */

export function bez(p0: number, p1: number, p2: number, p3: number, t: number) {
  const m = 1 - t;
  return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3;
}

export function flattenSub(s: SubPath, steps = 10): Vec2[] {
  const a = s.anchors;
  const pts: Vec2[] = [];
  if (!a.length) return pts;
  pts.push([a[0].x, a[0].y]);
  const segs = s.closed ? a.length : a.length - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = a[i];
    const p1 = a[(i + 1) % a.length];
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      pts.push([bez(p0.x, p0.ox, p1.ix, p1.x, t), bez(p0.y, p0.oy, p1.iy, p1.y, t)]);
    }
  }
  return pts;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pathBounds(p: BezierPath): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of p) {
    for (const [x, y] of flattenSub(s, 8)) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { x: -1, y: -1, w: 2, h: 2 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Re-centre a path on the centre of its bounds. Returns shift so the node can be compensated. */
export function recenter(p: BezierPath): { path: BezierPath; cx: number; cy: number } {
  const b = pathBounds(p);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { path: translatePath(p, -cx, -cy), cx, cy };
}

/* ---------- parametric shapes ---------- */

const K = 0.5522847498;

export function makeShape(kind: ShapeKind, w: number, h: number): BezierPath {
  const hw = w / 2;
  const hh = h / 2;
  switch (kind) {
    case "rect":
      return [
        {
          closed: true,
          anchors: [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)],
        },
      ];
    case "ellipse": {
      const a = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): Anchor => ({ x, y, ix, iy, ox, oy });
      return [
        {
          closed: true,
          anchors: [
            a(0, -hh, -hw * K, -hh, hw * K, -hh),
            a(hw, 0, hw, -hh * K, hw, hh * K),
            a(0, hh, hw * K, hh, -hw * K, hh),
            a(-hw, 0, -hw, hh * K, -hw, -hh * K),
          ],
        },
      ];
    }
    case "star":
    case "polygon": {
      const n = kind === "star" ? 5 : 6;
      const anchors: Anchor[] = [];
      const count = kind === "star" ? n * 2 : n;
      for (let i = 0; i < count; i++) {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / count;
        const rr = kind === "star" && i % 2 === 1 ? 0.42 : 1;
        anchors.push(corner(Math.cos(ang) * hw * rr, Math.sin(ang) * hh * rr));
      }
      return [{ closed: true, anchors }];
    }
    case "line":
    default:
      return [{ closed: false, anchors: [corner(-hw, -hh), corner(hw, hh)] }];
  }
}

/* ---------- Schneider curve fitting (freehand -> cubic Bézier) ---------- */

type P = Vec2;
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, s: number): P => [a[0] * s, a[1] * s];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
const len = (a: P) => Math.hypot(a[0], a[1]);
const norm = (a: P): P => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

type Seg = [P, P, P, P];

const B0 = (u: number) => (1 - u) ** 3;
const B1 = (u: number) => 3 * u * (1 - u) ** 2;
const B2 = (u: number) => 3 * u * u * (1 - u);
const B3 = (u: number) => u ** 3;

function evalBez(b: Seg, t: number): P {
  return [bez(b[0][0], b[1][0], b[2][0], b[3][0], t), bez(b[0][1], b[1][1], b[2][1], b[3][1], t)];
}

function chordParam(d: P[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[i - first - 1] + len(sub(d[i], d[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((x) => x / total);
}

function genBezier(d: P[], first: number, last: number, uP: number[], t1: P, t2: P): Seg {
  const n = last - first + 1;
  const C = [
    [0, 0],
    [0, 0],
  ];
  const X = [0, 0];
  for (let i = 0; i < n; i++) {
    const u = uP[i];
    const a0 = mul(t1, B1(u));
    const a1 = mul(t2, B2(u));
    C[0][0] += dot(a0, a0);
    C[0][1] += dot(a0, a1);
    C[1][1] += dot(a1, a1);
    const tmp = sub(
      d[first + i],
      add(add(mul(d[first], B0(u) + B1(u)), mul(d[last], B2(u) + B3(u))), [0, 0]),
    );
    X[0] += dot(a0, tmp);
    X[1] += dot(a1, tmp);
  }
  C[1][0] = C[0][1];
  const detC = C[0][0] * C[1][1] - C[1][0] * C[0][1];
  const detCX = C[0][0] * X[1] - C[1][0] * X[0];
  const detXC = X[0] * C[1][1] - X[1] * C[0][1];
  const al = detC === 0 ? 0 : detXC / detC;
  const ar = detC === 0 ? 0 : detCX / detC;
  const segLen = len(sub(d[last], d[first]));
  const eps = 1e-6 * segLen;
  if (al < eps || ar < eps) {
    const dist = segLen / 3;
    return [d[first], add(d[first], mul(t1, dist)), add(d[last], mul(t2, dist)), d[last]];
  }
  return [d[first], add(d[first], mul(t1, al)), add(d[last], mul(t2, ar)), d[last]];
}

function newton(b: Seg, p: P, u: number): number {
  const q = evalBez(b, u);
  const q1pts: P[] = [sub(b[1], b[0]), sub(b[2], b[1]), sub(b[3], b[2])].map((v) => mul(v, 3));
  const q2pts: P[] = [sub(q1pts[1], q1pts[0]), sub(q1pts[2], q1pts[1])].map((v) => mul(v, 2));
  const m = 1 - u;
  const q1 = add(add(mul(q1pts[0], m * m), mul(q1pts[1], 2 * m * u)), mul(q1pts[2], u * u));
  const q2 = add(mul(q2pts[0], m), mul(q2pts[1], u));
  const diff = sub(q, p);
  const num = dot(diff, q1);
  const den = dot(q1, q1) + dot(diff, q2);
  if (den === 0) return u;
  return Math.min(1, Math.max(0, u - num / den));
}

function maxErr(d: P[], first: number, last: number, b: Seg, uP: number[]): [number, number] {
  let split = Math.floor((last - first + 1) / 2);
  let maxD = 0;
  for (let i = first + 1; i < last; i++) {
    const p = evalBez(b, uP[i - first]);
    const v = sub(p, d[i]);
    const dist = v[0] * v[0] + v[1] * v[1];
    if (dist >= maxD) {
      maxD = dist;
      split = i;
    }
  }
  return [maxD, split];
}

function fitCubic(d: P[], first: number, last: number, t1: P, t2: P, error: number, out: Seg[]) {
  if (last - first === 1) {
    const dist = len(sub(d[last], d[first])) / 3;
    out.push([d[first], add(d[first], mul(t1, dist)), add(d[last], mul(t2, dist)), d[last]]);
    return;
  }
  let uP = chordParam(d, first, last);
  let b = genBezier(d, first, last, uP, t1, t2);
  let [me, split] = maxErr(d, first, last, b, uP);
  if (me < error) {
    out.push(b);
    return;
  }
  if (me < error * 16) {
    for (let it = 0; it < 4; it++) {
      uP = uP.map((u, i) => newton(b, d[first + i], u));
      b = genBezier(d, first, last, uP, t1, t2);
      [me, split] = maxErr(d, first, last, b, uP);
      if (me < error) {
        out.push(b);
        return;
      }
    }
  }
  split = Math.min(Math.max(split, first + 1), last - 1);
  const tc = norm(sub(d[split - 1], d[split + 1]));
  fitCubic(d, first, split, t1, tc, error, out);
  fitCubic(d, split, last, mul(tc, -1), t2, error, out);
}

/** Smooths a raw stroke into a clean open cubic Bézier sub-path. `smoothing` 0..1, units in u. */
export function fitFreehand(raw: Vec2[], smoothing: number): SubPath | null {
  // de-duplicate
  const pts: P[] = [];
  for (const p of raw) {
    if (!pts.length || len(sub(p, pts[pts.length - 1])) > 0.12) pts.push(p);
  }
  if (pts.length < 2) return null;
  // light moving-average pre-smoothing driven by the smoothing slider
  const passes = Math.round(smoothing * 3);
  let work = pts;
  for (let k = 0; k < passes; k++) {
    work = work.map((p, i) => {
      if (i === 0 || i === work.length - 1) return p;
      const a = work[i - 1];
      const c = work[i + 1];
      return [(a[0] + p[0] * 2 + c[0]) / 4, (a[1] + p[1] * 2 + c[1]) / 4] as P;
    });
  }
  if (work.length === 2) {
    return { closed: false, anchors: [corner(work[0][0], work[0][1]), corner(work[1][0], work[1][1])] };
  }
  const tol = 0.05 + smoothing * 1.4;
  const segs: Seg[] = [];
  const t1 = norm(sub(work[1], work[0]));
  const t2 = norm(sub(work[work.length - 2], work[work.length - 1]));
  fitCubic(work, 0, work.length - 1, t1, t2, tol * tol, segs);
  const anchors: Anchor[] = [];
  segs.forEach((s, i) => {
    if (i === 0) anchors.push({ x: s[0][0], y: s[0][1], ix: s[0][0], iy: s[0][1], ox: s[1][0], oy: s[1][1] });
    else {
      const a = anchors[anchors.length - 1];
      a.ox = s[1][0];
      a.oy = s[1][1];
    }
    anchors.push({ x: s[3][0], y: s[3][1], ix: s[2][0], iy: s[2][1], ox: s[3][0], oy: s[3][1] });
  });
  return { closed: false, anchors };
}

/** Variable-width ribbon (tapered brush stroke) as a closed SVG path `d` string, so it round-trips through the Scene. */
export function taperD(p: BezierPath, width: number, taper: number): string {
  let d = "";
  const f = (v: number) => Math.round(v * 100) / 100;
  for (const s of p) {
    const pts = flattenSub(s, 8);
    if (pts.length < 2) continue;
    const n = pts.length;
    const dists = [0];
    for (let i = 1; i < n; i++) dists.push(dists[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = dists[n - 1] || 1;
    const left: Vec2[] = [];
    const right: Vec2[] = [];
    const ramp = Math.max(0.02, taper * 0.5);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1;
      const nx = -ty / l;
      const ny = tx / l;
      const sPos = dists[i] / total;
      const k = Math.min(1, sPos / ramp, (1 - sPos) / ramp);
      const w = (width / 2) * (0.04 + 0.96 * Math.max(0, k) ** 0.8);
      left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
      right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
    }
    d += `M${f(left[0][0])} ${f(left[0][1])}`;
    for (let i = 1; i < n; i++) d += `L${f(left[i][0])} ${f(left[i][1])}`;
    for (let i = n - 1; i >= 0; i--) d += `L${f(right[i][0])} ${f(right[i][1])}`;
    d += "Z";
  }
  return d;
}
