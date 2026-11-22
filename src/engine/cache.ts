// Offscreen sprite / layer caches. Everything that is expensive to rasterise (radial glows, soft pools, vignette) is
// drawn ONCE into a small canvas and then blitted with drawImage — a handful of GPU-friendly copies per frame instead
// of recomputing gradients and shadow blurs 60 times a second.
import { mixColor, rgba } from "./math";

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const glowSprites = new Map<string, HTMLCanvasElement>();
const SPRITE = 96;

/** Soft round light sprite (white-hot centre → colour → transparent). Draw it scaled; never rebuild per frame. */
export function glowSprite(color: string, core = 0): HTMLCanvasElement {
  const key = `${color}|${core}`;
  let s = glowSprites.get(key);
  if (!s) {
    s = makeCanvas(SPRITE, SPRITE);
    const c = s.getContext("2d")!;
    const r = SPRITE / 2;
    const g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, core > 0 ? mixColor(color, "#ffffff", core) : rgba(color, 1));
    g.addColorStop(0.22, rgba(color, 0.62));
    g.addColorStop(0.55, rgba(color, 0.2));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, SPRITE, SPRITE);
    if (glowSprites.size > 160) glowSprites.clear();
    glowSprites.set(key, s);
  }
  return s;
}

/** Draw a cached glow sprite centred at (x,y) with radius r (pixels). */
export function blitGlow(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number, alpha: number) {
  if (alpha <= 0.002 || r <= 0.5) return;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
}

let softBlack: HTMLCanvasElement | null = null;
/** Black radial pool used for ambient occlusion. */
export function shadowPool(): HTMLCanvasElement {
  if (!softBlack) {
    softBlack = makeCanvas(SPRITE, SPRITE);
    const c = softBlack.getContext("2d")!;
    const r = SPRITE / 2;
    const g = c.createRadialGradient(r, r, r * 0.12, r, r, r);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.5, "rgba(0,0,0,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, SPRITE, SPRITE);
  }
  return softBlack;
}

/** Tiny reusable vignette (smooth, so it is rendered at 1/4 size and upscaled). */
export class VignetteCache {
  private c: HTMLCanvasElement | null = null;
  private key = "";
  get(W: number, H: number, strength: number): HTMLCanvasElement {
    const key = `${W}x${H}|${strength.toFixed(3)}`;
    if (this.c && this.key === key) return this.c;
    const w = Math.max(8, Math.round(W / 4));
    const h = Math.max(8, Math.round(H / 4));
    const c = this.c && this.c.width === w && this.c.height === h ? this.c : makeCanvas(w, h);
    const x = c.getContext("2d")!;
    x.clearRect(0, 0, w, h);
    const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${Math.min(1, Math.max(0, strength)).toFixed(3)})`);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    this.c = c;
    this.key = key;
    return c;
  }
}
