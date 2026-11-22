// Cubic-Bézier path engine: SVG parsing -> normalised cubic sub-paths, morph preparation, interpolation.

export interface Pt {
  x: number;
  y: number;
}
export type Seg = [Pt, Pt, Pt, Pt];
export interface Sub {
  segs: Seg[];
  closed: boolean;
}
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const P = (x: number, y: number): Pt => ({ x, y });
const lp = (a: Pt, b: Pt, t: number): Pt => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const lineSeg = (a: Pt, b: Pt): Seg => [a, lp(a, b, 1 / 3), lp(a, b, 2 / 3), b];

function arcToCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number): Seg[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [lineSeg(P(x1, y1), P(x2, y2))];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy;
  const y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const th1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  let dth = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  else if (fs && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const step = dth / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const pt = (a: number) => P(cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp);
  const dv = (a: number) => P(-rx * Math.sin(a) * cp - ry * Math.cos(a) * sp, -rx * Math.sin(a) * sp + ry * Math.cos(a) * cp);
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const a = th1 + i * step;
    const b = a + step;
    const p0 = i === 0 ? P(x1, y1) : pt(a);
    const p3 = i === n - 1 ? P(x2, y2) : pt(b);
    const d0 = dv(a);
    const d1 = dv(b);
    out.push([p0, P(p0.x + k * d0.x, p0.y + k * d0.y), P(p3.x - k * d1.x, p3.y - k * d1.y), p3]);
  }
  return out;
}

export function parsePath(d: string): Sub[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const subs: Sub[] = [];
  let cur: Sub | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  let lastC: Pt | null = null;
  let lastQ: Pt | null = null;
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const isCmd = (s: string) => /^[A-Za-z]$/.test(s);
  const begin = (x: number, y: number) => {
    cur = { segs: [], closed: false };
    subs.push(cur);
    sx = cx = x;
    sy = cy = y;
  };
  const push = (s: Seg) => {
    if (!cur) begin(cx, cy);
    cur!.segs.push(s);
    cx = s[3].x;
    cy = s[3].y;
  };
  let guard = 0;
  while (i < tokens.length && guard++ < 100000) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    else if (cmd === "") {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    if (C === "Z") {
      if (cur) {
        const c = cur as Sub;
        if (Math.hypot(cx - sx, cy - sy) > 1e-6) c.segs.push(lineSeg(P(cx, cy), P(sx, sy)));
        c.closed = true;
      }
      cx = sx;
      cy = sy;
      cur = null;
      lastC = lastQ = null;
      cmd = "";
      continue;
    }
    if (C === "M") {
      const x = num() + ox;
      const y = num() + oy;
      begin(x, y);
      cmd = rel ? "l" : "L";
      lastC = lastQ = null;
    } else if (C === "L") {
      const x = num() + ox;
      const y = num() + oy;
      push(lineSeg(P(cx, cy), P(x, y)));
      lastC = lastQ = null;
    } else if (C === "H") {
      const x = num() + ox;
      push(lineSeg(P(cx, cy), P(x, cy)));
      lastC = lastQ = null;
    } else if (C === "V") {
      const y = num() + oy;
      push(lineSeg(P(cx, cy), P(cx, y)));
      lastC = lastQ = null;
    } else if (C === "C") {
      const a = P(num() + ox, num() + oy);
      const b = P(num() + ox, num() + oy);
      const e = P(num() + ox, num() + oy);
      push([P(cx, cy), a, b, e]);
      lastC = b;
      lastQ = null;
    } else if (C === "S") {
      const a = lastC ? P(2 * cx - lastC.x, 2 * cy - lastC.y) : P(cx, cy);
      const b = P(num() + ox, num() + oy);
      const e = P(num() + ox, num() + oy);
      push([P(cx, cy), a, b, e]);
      lastC = b;
      lastQ = null;
    } else if (C === "Q" || C === "T") {
      let q: Pt;
      if (C === "Q") q = P(num() + ox, num() + oy);
      else q = lastQ ? P(2 * cx - lastQ.x, 2 * cy - lastQ.y) : P(cx, cy);
      const e = P(num() + ox, num() + oy);
      const p0 = P(cx, cy);
      push([p0, lp(p0, q, 2 / 3), lp(e, q, 2 / 3), e]);
      lastQ = q;
      lastC = null;
    } else if (C === "A") {
      const rx = num();
      const ry = num();
      const rot = num();
      const fa = num();
      const fs = num();
      const x = num() + ox;
      const y = num() + oy;
      for (const s of arcToCubics(cx, cy, rx, ry, rot, fa ? 1 : 0, fs ? 1 : 0, x, y)) push(s);
      lastC = lastQ = null;
    } else {
      i++;
    }
  }
  return subs.filter((s) => s.segs.length > 0);
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();
export function subsToD(subs: Sub[]): string {
  let d = "";
  for (const s of subs) {
    if (!s.segs.length) continue;
    d += `M${f2(s.segs[0][0].x)},${f2(s.segs[0][0].y)}`;
    for (const [, a, b, e] of s.segs) d += `C${f2(a.x)},${f2(a.y)} ${f2(b.x)},${f2(b.y)} ${f2(e.x)},${f2(e.y)}`;
    if (s.closed) d += "Z";
  }
  return d;
}

export function toPath2D(subs: Sub[]): Path2D {
  const p = new Path2D();
  for (const s of subs) {
    if (!s.segs.length) continue;
    p.moveTo(s.segs[0][0].x, s.segs[0][0].y);
    for (const [, a, b, e] of s.segs) p.bezierCurveTo(a.x, a.y, b.x, b.y, e.x, e.y);
    if (s.closed) p.closePath();
  }
  return p;
}

export function boundsOf(subs: Sub[]): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of subs)
    for (const seg of s.segs)
      for (const p of seg) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
  if (!isFinite(x0)) return { x0: -1, y0: -1, x1: 1, y1: 1 };
  return { x0, y0, x1, y1 };
}

// ---------- morph preparation ----------
function split(s: Seg, t = 0.5): [Seg, Seg] {
  const [a, b, c, d] = s;
  const ab = lp(a, b, t);
  const bc = lp(b, c, t);
  const cd = lp(c, d, t);
  const abc = lp(ab, bc, t);
  const bcd = lp(bc, cd, t);
  const m = lp(abc, bcd, t);
  return [
    [a, ab, abc, m],
    [m, bcd, cd, d],
  ];
}
const segLen = (s: Seg) => Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y) + Math.hypot(s[2].x - s[1].x, s[2].y - s[1].y) + Math.hypot(s[3].x - s[2].x, s[3].y - s[2].y);
const cloneSub = (s: Sub): Sub => ({ closed: s.closed, segs: s.segs.map((g) => g.map((p) => ({ ...p })) as Seg) });

function subdivideTo(s: Sub, n: number): Sub {
  const segs = s.segs.slice();
  while (segs.length < n) {
    let bi = 0;
    let bl = -1;
    for (let i = 0; i < segs.length; i++) {
      const l = segLen(segs[i]);
      if (l > bl) {
        bl = l;
        bi = i;
      }
    }
    const [a, b] = split(segs[bi]);
    segs.splice(bi, 1, a, b);
  }
  return { closed: s.closed, segs };
}
function subArea(s: Sub): number {
  let a = 0;
  const pts: Pt[] = [];
  for (const g of s.segs) {
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      const u = 1 - t;
      pts.push(P(u * u * u * g[0].x + 3 * u * u * t * g[1].x + 3 * u * t * t * g[2].x + t * t * t * g[3].x, u * u * u * g[0].y + 3 * u * u * t * g[1].y + 3 * u * t * t * g[2].y + t * t * t * g[3].y));
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
function reverseSub(s: Sub): Sub {
  return { closed: s.closed, segs: s.segs.map((g) => [g[3], g[2], g[1], g[0]] as Seg).reverse() };
}
function subCenter(s: Sub): Pt {
  const b = boundsOf([s]);
  return P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
}
function degenerate(p: Pt, n: number): Sub {
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) segs.push([p, p, p, p]);
  return { closed: true, segs };
}

const morphCache = new Map<string, { a: Sub[]; b: Sub[] }>();
export function prepareMorph(da: string, db: string, parse: (d: string) => Sub[] = parsePath): { a: Sub[]; b: Sub[] } {
  const key = da + "|" + db;
  const hit = morphCache.get(key);
  if (hit) return hit;
  const A = parse(da).map(cloneSub);
  const B = parse(db).map(cloneSub);
  while (A.length < B.length) A.push(degenerate(subCenter(B[A.length]), 1));
  while (B.length < A.length) B.push(degenerate(subCenter(A[B.length]), 1));
  for (let i = 0; i < A.length; i++) {
    const n = Math.max(A[i].segs.length, B[i].segs.length);
    const a = subdivideTo(A[i], n);
    let b = subdivideTo(B[i], n);
    a.closed = b.closed = a.closed && b.closed;
    if (a.closed && Math.sign(subArea(a)) !== Math.sign(subArea(b)) && Math.abs(subArea(a)) > 1e-6 && Math.abs(subArea(b)) > 1e-6) b = reverseSub(b);
    if (a.closed) {
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < n; k++) {
        let d = 0;
        for (let j = 0; j < n; j++) {
          const p = a.segs[j][0];
          const q = b.segs[(j + k) % n][0];
          d += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        }
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      if (best) b = { closed: true, segs: b.segs.slice(best).concat(b.segs.slice(0, best)) };
    }
    A[i] = a;
    B[i] = b;
  }
  if (morphCache.size > 60) morphCache.clear();
  const out = { a: A, b: B };
  morphCache.set(key, out);
  return out;
}

export function lerpSubs(A: Sub[], B: Sub[], t: number): Sub[] {
  return A.map((a, i) => {
    const b = B[i];
    return {
      closed: a.closed,
      segs: a.segs.map((g, j) => g.map((p, k) => lp(p, b.segs[j][k], t)) as Seg),
    };
  });
}

const parseCache = new Map<string, Sub[]>();
export function parseCached(d: string): Sub[] {
  let s = parseCache.get(d);
  if (!s) {
    s = parsePath(d);
    if (parseCache.size > 300) parseCache.clear();
    parseCache.set(d, s);
  }
  return s;
}
