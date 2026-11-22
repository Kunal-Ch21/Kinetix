// Parametric shape -> cubic-Bézier SVG path strings (local units, centred on the origin).
const K = 0.5523;
const f = (n: number) => Math.round(n * 1000) / 1000;

export function rectPath(w: number, h: number, r = 0): string {
  const x = w / 2;
  const y = h / 2;
  const c = Math.min(r, x, y);
  if (c <= 0) return `M${f(-x)},${f(-y)}L${f(x)},${f(-y)}L${f(x)},${f(y)}L${f(-x)},${f(y)}Z`;
  const k = c * (1 - K);
  return (
    `M${f(-x + c)},${f(-y)}L${f(x - c)},${f(-y)}C${f(x - k)},${f(-y)} ${f(x)},${f(-y + k)} ${f(x)},${f(-y + c)}` +
    `L${f(x)},${f(y - c)}C${f(x)},${f(y - k)} ${f(x - k)},${f(y)} ${f(x - c)},${f(y)}` +
    `L${f(-x + c)},${f(y)}C${f(-x + k)},${f(y)} ${f(-x)},${f(y - k)} ${f(-x)},${f(y - c)}` +
    `L${f(-x)},${f(-y + c)}C${f(-x)},${f(-y + k)} ${f(-x + k)},${f(-y)} ${f(-x + c)},${f(-y)}Z`
  );
}
export function ellipsePath(rx: number, ry: number): string {
  const kx = rx * K;
  const ky = ry * K;
  return (
    `M${f(rx)},0C${f(rx)},${f(ky)} ${f(kx)},${f(ry)} 0,${f(ry)}` +
    `C${f(-kx)},${f(ry)} ${f(-rx)},${f(ky)} ${f(-rx)},0` +
    `C${f(-rx)},${f(-ky)} ${f(-kx)},${f(-ry)} 0,${f(-ry)}` +
    `C${f(kx)},${f(-ry)} ${f(rx)},${f(-ky)} ${f(rx)},0Z`
  );
}
export const circlePath = (r: number) => ellipsePath(r, r);

export function polygonPath(sides: number, r: number): string {
  const n = Math.max(3, Math.round(sides));
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    d += `${i ? "L" : "M"}${f(Math.cos(a) * r)},${f(Math.sin(a) * r)}`;
  }
  return d + "Z";
}
export function starPath(points: number, outer: number, inner: number): string {
  const n = Math.max(3, Math.round(points));
  let d = "";
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    d += `${i ? "L" : "M"}${f(Math.cos(a) * r)},${f(Math.sin(a) * r)}`;
  }
  return d + "Z";
}
export function linePath(len: number): string {
  return `M${f(-len / 2)},0L${f(len / 2)},0`;
}

type Spec = Record<string, unknown>;
const n = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);

/** Resolve an LLM/user shape spec to an SVG path. Returns whether it should be stroke-only. */
export function shapeToPath(spec: Spec): { d: string; strokeOnly: boolean } {
  const shape = String(spec.shape ?? "circle");
  switch (shape) {
    case "rect":
      return { d: rectPath(n(spec.w ?? spec.width, 20), n(spec.h ?? spec.height, 12), n(spec.radius, 0)), strokeOnly: false };
    case "ellipse":
      return { d: ellipsePath(n(spec.rx, 10), n(spec.ry, 6)), strokeOnly: false };
    case "star":
      return { d: starPath(n(spec.points, 5), n(spec.outer ?? spec.r, 10), n(spec.inner, n(spec.outer ?? spec.r, 10) * 0.45)), strokeOnly: false };
    case "polygon":
      return { d: polygonPath(n(spec.sides, 6), n(spec.r, 10)), strokeOnly: false };
    case "line":
      return { d: linePath(n(spec.length ?? spec.len, 20)), strokeOnly: true };
    case "svg_path":
    case "path":
      return { d: String(spec.svg_path ?? spec.d ?? "M-5,-5L5,-5L5,5L-5,5Z"), strokeOnly: false };
    default:
      return { d: circlePath(n(spec.r ?? spec.radius, 8)), strokeOnly: false };
  }
}
