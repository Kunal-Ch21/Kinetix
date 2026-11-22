// Kinetic typography: per-character / per-word staggered animation.
import { bounceOut, clamp, resolveEase, spring } from "./math";
import type { TextSpec } from "./types";

let mctx: CanvasRenderingContext2D | null = null;
export function fontOf(s: TextSpec): string {
  const fam = s.font === "mono" ? "'JetBrains Mono', ui-monospace, Menlo, monospace" : "Inter, ui-sans-serif, system-ui, sans-serif";
  return `${s.weight} ${s.size}px ${fam}`;
}
function measureCtx() {
  if (!mctx) mctx = document.createElement("canvas").getContext("2d")!;
  return mctx;
}

interface Unit {
  text: string;
  x: number; // left edge
  w: number;
}
function layout(s: TextSpec): { units: Unit[]; width: number } {
  const c = measureCtx();
  c.font = fontOf(s);
  const units: Unit[] = [];
  let x = 0;
  if (s.unit === "word") {
    const words = s.content.split(/(\s+)/);
    for (const w of words) {
      const m = c.measureText(w).width;
      if (w.trim()) units.push({ text: w, x, w: m });
      x += m;
    }
  } else {
    for (const ch of Array.from(s.content)) {
      const m = c.measureText(ch).width;
      if (ch.trim()) units.push({ text: ch, x, w: m });
      x += m;
    }
  }
  return { units, width: x };
}

export function textBounds(s: TextSpec) {
  const { width } = layout(s);
  const x0 = s.align === "left" ? 0 : s.align === "right" ? -width : -width / 2;
  return { x0, y0: -s.size * 0.62, x1: x0 + width, y1: s.size * 0.62 };
}

/** Draw the text with ctx.fillStyle already set. `t` is scene time. */
export function drawKinetic(ctx: CanvasRenderingContext2D, s: TextSpec, t: number) {
  const { units, width } = layout(s);
  const x0 = s.align === "left" ? 0 : s.align === "right" ? -width : -width / 2;
  ctx.font = fontOf(s);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ease = resolveEase("ease_out");
  const baseAlpha = ctx.globalAlpha;
  units.forEach((u, i) => {
    const lt = t - s.start - i * s.stagger;
    const p = clamp(lt / Math.max(0.01, s.duration), 0, 1);
    let a = 1;
    let dy = 0;
    let sc = 1;
    let rot = 0;
    switch (s.effect) {
      case "rise":
        a = ease(p);
        dy = (1 - ease(p)) * s.size * 0.8;
        break;
      case "fade":
        a = p;
        break;
      case "pop":
        sc = spring(p);
        a = Math.min(1, p * 4);
        break;
      case "drop":
        dy = -(1 - bounceOut(p)) * s.size * 2;
        a = Math.min(1, p * 5);
        break;
      case "spin":
        rot = (1 - ease(p)) * Math.PI;
        sc = ease(p);
        a = ease(p);
        break;
      case "wave":
        a = lt >= 0 ? 1 : 0;
        dy = lt >= 0 ? Math.sin(t * 4 + i * 0.5) * s.size * 0.15 : 0;
        break;
      case "typewriter":
        a = lt >= 0 ? 1 : 0;
        break;
    }
    if (a <= 0.001 || sc <= 0.001) return;
    ctx.save();
    ctx.globalAlpha = baseAlpha * clamp(a, 0, 1);
    ctx.translate(x0 + u.x + u.w / 2, dy);
    if (rot) ctx.rotate(rot);
    if (sc !== 1) ctx.scale(sc, sc);
    ctx.fillText(u.text, 0, 0);
    ctx.restore();
  });
}
