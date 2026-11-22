// Procedural environments: multi-stop sky, stars, drifting volumetric clouds, parallax mountains, horizon haze.
//
// PERFORMANCE: nothing static is recomputed per frame. The sky gradient, haze band, each mountain ridge and each cloud
// are rasterised once into offscreen canvases (`EnvCache`, one per Renderer) and re-built only when the environment's
// visuals or the canvas size actually change. A frame is then: 1 sky blit + N star dots + N cloud blits + M ridge
// blits + 1 haze blit.  There is deliberately NO sun disc: light comes from the invisible light emitters.
import { makeCanvas } from "./cache";
import { clamp, mixColor, mulberry32, rgba } from "./math";
import type { Environment } from "./types";

function ridge(x: number, seed: number) {
  return 0.5 + 0.5 * (Math.sin(x * 3.1 + seed) * 0.5 + Math.sin(x * 7.3 + seed * 2.1) * 0.3 + Math.sin(x * 17.7 + seed * 3.7) * 0.2);
}

interface Strip {
  c: HTMLCanvasElement;
  top: number; // canvas y of the strip's first row
  span: number; // horizontal scroll range baked into the strip (px)
  rate: number; // px of scroll per second
}
interface CloudSprite {
  c: HTMLCanvasElement;
  scale: number; // sprite pixels per canvas pixel
  w: number;
  h: number;
  base: number;
  yy: number;
  spd: number;
}
interface Star {
  x: number;
  y: number;
  f: number;
  ph: number;
  s: number;
}

const STAR_STYLE = Array.from({ length: 17 }, (_, i) => `rgba(255,255,255,${(i / 16).toFixed(3)})`);
const envKeys = new WeakMap<Environment, string>();

function visualKey(env: Environment): string {
  let k = envKeys.get(env);
  if (!k) {
    k = JSON.stringify([env.sky, env.stars, env.clouds, env.mountains, env.haze]);
    envKeys.set(env, k);
  }
  return k;
}

export class EnvCache {
  private key = "";
  private sky: HTMLCanvasElement | null = null;
  private haze: { c: HTMLCanvasElement; y: number } | null = null;
  private strips: Strip[] = [];
  private clouds: CloudSprite[] = [];
  private stars: Star[] = [];

  private build(env: Environment, W: number, H: number, duration: number) {
    // sky
    const sky = makeCanvas(W, H);
    const sx = sky.getContext("2d")!;
    const g = sx.createLinearGradient(0, 0, 0, H);
    const stops = env.sky.length ? env.sky : [{ at: 0, color: "#07090E" }, { at: 1, color: "#0E1424" }];
    for (const s of stops) g.addColorStop(clamp(s.at, 0, 1), s.color);
    sx.fillStyle = g;
    sx.fillRect(0, 0, W, H);
    this.sky = sky;

    // stars (positions only — twinkle is a cheap per-frame alpha)
    const rnd = mulberry32(42);
    this.stars = [];
    for (let i = 0; i < env.stars; i++) {
      const x = rnd() * W;
      const y = rnd() * H * 0.62;
      const f = 1 + rnd() * 2.5;
      const s = rnd() > 0.9 ? 2 : 1;
      this.stars.push({ x, y, f, ph: i, s });
    }

    // clouds → one sprite per cloud (rendered at half resolution; they are soft)
    this.clouds = [];
    const cl = env.clouds;
    if (cl && cl.count > 0) {
      const r2 = mulberry32(1337);
      const SC = 0.5;
      for (let i = 0; i < cl.count; i++) {
        const base = r2();
        const yy = ((cl.y0 + (cl.y1 - cl.y0) * r2()) / 100) * H;
        const sc = 0.6 + r2() * 0.9;
        const spd = 0.5 + r2();
        const cw = W * 0.09 * sc;
        const sw = Math.ceil(cw * 5.4 * SC);
        const sh = Math.ceil(cw * 2.6 * SC);
        const c = makeCanvas(sw, sh);
        const x = c.getContext("2d")!;
        const blobs = 7;
        for (let pass = 0; pass < 2; pass++) {
          for (let j = 0; j < blobs; j++) {
            const bx = sw / 2 + (j - (blobs - 1) / 2) * cw * 0.55 * SC;
            const by = sh / 2 + (Math.sin(j * 1.7 + i) * cw * 0.12 + (pass === 0 ? cw * 0.14 : -cw * 0.05)) * SC;
            const br = cw * (0.55 + 0.35 * Math.sin(j * 2.3 + i * 1.1) ** 2) * SC;
            const col = pass === 0 ? cl.shade : cl.color;
            const a = cl.opacity * (pass === 0 ? 0.55 : 0.42);
            const gr = x.createRadialGradient(bx, by, 0, bx, by, br);
            gr.addColorStop(0, rgba(col, a));
            gr.addColorStop(0.6, rgba(col, a * 0.45));
            gr.addColorStop(1, rgba(col, 0));
            x.fillStyle = gr;
            x.fillRect(bx - br, by - br, br * 2, br * 2);
          }
        }
        this.clouds.push({ c, scale: SC, w: sw / SC, h: sh / SC, base, yy, spd });
      }
    }

    // mountains → horizontal strips that scroll (parallax) instead of re-tracing the ridge each frame
    this.strips = [];
    const hazeCol = env.haze?.color ?? "#000000";
    for (const m of env.mountains) {
      const base = (m.base / 100) * H;
      const hh = (m.height / 100) * H;
      const rate = (m.parallax * 0.05 * W) / 3; // px / second
      const span = Math.max(0, Math.min(W * 2, Math.ceil(rate * Math.max(1, duration))));
      const top = Math.max(0, Math.floor(base - hh - 2));
      const c = makeCanvas(W + span + 8, H - top);
      const x = c.getContext("2d")!;
      const gr = x.createLinearGradient(0, base - hh - top, 0, base + hh * 0.2 - top);
      gr.addColorStop(0, mixColor(m.color, hazeCol, m.haze * 0.35));
      gr.addColorStop(1, mixColor(m.color, hazeCol, m.haze));
      x.fillStyle = gr;
      x.beginPath();
      x.moveTo(0, H - top);
      for (let px = 0; px <= W + span + 6; px += 6) x.lineTo(px, base - ridge((px / W) * 3, m.seed) * hh - top);
      x.lineTo(W + span + 8, H - top);
      x.closePath();
      x.fill();
      this.strips.push({ c, top, span, rate });
    }

    // horizon haze band
    this.haze = null;
    if (env.haze && env.haze.amount > 0) {
      const hy = (env.haze.horizon / 100) * H;
      const bh = H * 0.28;
      const c = makeCanvas(W, Math.ceil(bh * 2));
      const x = c.getContext("2d")!;
      const gr = x.createLinearGradient(0, 0, 0, bh * 2);
      gr.addColorStop(0, rgba(env.haze.color, 0));
      gr.addColorStop(0.5, rgba(env.haze.color, env.haze.amount));
      gr.addColorStop(1, rgba(env.haze.color, env.haze.amount * 0.5));
      x.fillStyle = gr;
      x.fillRect(0, 0, W, bh * 2);
      this.haze = { c, y: hy - bh };
    }
  }

  draw(ctx: CanvasRenderingContext2D, env: Environment, W: number, H: number, t: number, duration: number) {
    const key = `${W}x${H}|${Math.ceil(duration)}|${visualKey(env)}`;
    if (key !== this.key) {
      this.build(env, W, H, duration);
      this.key = key;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.sky!, 0, 0);

    for (const s of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * s.f + s.ph);
      const a = clamp(1 - s.y / (H * 0.6), 0, 1) * tw * 0.9;
      ctx.fillStyle = STAR_STYLE[Math.round(a * 16)];
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }

    const cl = env.clouds;
    if (cl) {
      ctx.imageSmoothingEnabled = true;
      for (const c of this.clouds) {
        const cx = ((((c.base + t * cl.speed * 0.012 * c.spd) % 1.5) + 1.5) % 1.5 - 0.25) * W;
        ctx.drawImage(c.c, cx - c.w / 2, c.yy - c.h / 2, c.w, c.h);
      }
    }

    for (const s of this.strips) {
      const off = s.span > 0 ? (t * s.rate) % s.span : 0;
      ctx.drawImage(s.c, off, 0, W, s.c.height, 0, s.top, W, s.c.height);
    }
    if (this.haze) ctx.drawImage(this.haze.c, 0, this.haze.y);
    ctx.restore();
  }
}
