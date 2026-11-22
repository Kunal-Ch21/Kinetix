// 60 FPS Canvas2D renderer: environment → particles → lit/rimmed objects → volumetrics → multi-pass bloom → grade.
//
// Frame-budget rules (this file is the hot path):
//   * no ctx.shadowBlur, no full-canvas ctx.filter blur — soft shadows are layered strokes, bloom blurs only the tiny
//     down-sampled buffers;
//   * static art (sky, haze, mountains, clouds, vignette, glow sprites, AO pools) comes from offscreen caches;
//   * the bloom buffer is only cleared / processed when something actually wrote to it.
import { VignetteCache, blitGlow, shadowPool } from "./cache";
import { EnvCache } from "./environment";
import { Buf, LiveLight, drawRim, drawVolumetrics, evalLights, lightAffects, rimContribs } from "./lighting";
import { IDENT, Mat, applyM, clamp, invertM, mixColor, rgba, toPx } from "./math";
import { drawEmitters } from "./particles";
import { Bounds, Sub, boundsOf, lerpSubs, parseCached, prepareMorph, toPath2D } from "./path";
import { Resolved, resolveScene, stageH } from "./rig";
import { getImage } from "./images";
import { drawKinetic, fontOf, textBounds } from "./typography";
import type { Scene, SceneObject } from "./types";

export interface RenderOpts {
  t: number;
  selection?: string | null;
  editor?: boolean; // gizmos, light/emitter markers
}
export interface Gizmo {
  id: string;
  center: { x: number; y: number };
  rot: { x: number; y: number };
  scale: { x: number; y: number };
  corners: { x: number; y: number }[];
  pivot: { x: number; y: number };
}
export interface Marker {
  id: string;
  kind: "light" | "emitter";
  x: number;
  y: number;
}

interface Geo {
  bounds: Bounds;
  path?: Path2D;
  text?: boolean;
}

const staticPaths = new Map<string, Path2D>();

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layer: Buf | null = null;
  private glow: Buf | null = null;
  private b1: Buf | null = null;
  private b2: Buf | null = null;
  private b3: Buf | null = null;
  private hitCtx: CanvasRenderingContext2D;
  gizmo: Gizmo | null = null;
  markers: Marker[] = [];
  lastRes: Map<string, Resolved> | null = null;
  lastLights: LiveLight[] = [];
  lastU = 1;
  private filterOK: boolean;
  private env = new EnvCache();
  private vig = new VignetteCache();
  private glowDirty = true;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.hitCtx = document.createElement("canvas").getContext("2d")!;
    this.filterOK = typeof (this.ctx as unknown as { filter?: string }).filter === "string";
  }

  private mk(w: number, h: number, prev: Buf | null): Buf {
    const W = Math.max(8, Math.round(w));
    const H = Math.max(8, Math.round(h));
    if (prev && prev.w === W && prev.h === H) return prev;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return { c, x: c.getContext("2d", { willReadFrequently: false })!, w: W, h: H };
  }

  private geometry(o: SceneObject, morph: number): Geo {
    if (o.kind === "text" && o.text) {
      const b = textBounds(o.text);
      return { bounds: b, text: true };
    }
    if (o.morphTo && morph > 0.0005) {
      const m = prepareMorph(o.path, o.morphTo, parseCached);
      const subs: Sub[] = lerpSubs(m.a, m.b, clamp(morph, 0, 1));
      return { bounds: boundsOf(subs), path: toPath2D(subs) };
    }
    const subs = parseCached(o.path);
    let p = staticPaths.get(o.path);
    if (!p) {
      p = toPath2D(subs);
      if (staticPaths.size > 300) staticPaths.clear();
      staticPaths.set(o.path, p);
    }
    return { bounds: boundsOf(subs), path: p };
  }

  render(scene: Scene, opts: RenderOpts) {
    const { canvas, ctx } = this;
    const W = canvas.width;
    const H = canvas.height;
    const u = W / 100;
    const t = opts.t;
    this.lastU = u;
    this.layer = this.mk(W, H, this.layer);
    this.glow = this.mk(W, H, this.glow);
    this.b1 = this.mk(W / 4, H / 4, this.b1);
    this.b2 = this.mk(W / 8, H / 8, this.b2);
    this.b3 = this.mk(W / 16, H / 16, this.b3);
    const glow = this.glow;
    if (this.glowDirty) {
      glow.x.setTransform(1, 0, 0, 1, 0, 0);
      glow.x.globalCompositeOperation = "source-over";
      glow.x.globalAlpha = 1;
      glow.x.clearRect(0, 0, W, H);
      this.glowDirty = false;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    this.env.draw(ctx, scene.env, W, H, t, scene.duration);

    const res = resolveScene(scene, t);
    this.lastRes = res;
    const lights = evalLights(scene, t, res);
    this.lastLights = lights;

    if (drawEmitters(ctx, glow.x, scene, t, "back", u, res)) this.glowDirty = true;
    // atmosphere (light beams / washes) sits behind the actors so silhouettes stay crisp
    drawVolumetrics(ctx, lights, W, H, u);
    for (const o of scene.objects) {
      const r = res.get(o.id);
      if (!r || r.hidden || r.opacity <= 0.002) continue;
      this.drawObject(scene, o, r, lights, t, u);
    }
    if (drawEmitters(ctx, glow.x, scene, t, "front", u, res)) this.glowDirty = true;
    if (this.glowDirty) this.bloom(scene.env.bloom);

    if (scene.env.vignette > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.vig.get(W, H, scene.env.vignette), 0, 0, W, H);
      ctx.restore();
    }

    this.gizmo = null;
    this.markers = [];
    if (opts.editor) this.overlay(scene, res, lights, opts.selection ?? null, u, t);
  }

  /** Multi-pass bloom. The expensive blur runs on the tiny 1/4 · 1/8 · 1/16 buffers; the full-size canvas only gets
   *  cheap bilinear up-scaled additive blits (no ctx.filter on the big canvas). */
  private bloom(strength: number) {
    if (strength <= 0 || !this.glow || !this.b1 || !this.b2 || !this.b3) return;
    const { ctx, glow, b1, b2, b3 } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    let src: Buf = glow;
    for (const [dst, blur] of [
      [b1, 1],
      [b2, 1.5],
      [b3, 2],
    ] as [Buf, number][]) {
      dst.x.clearRect(0, 0, dst.w, dst.h);
      dst.x.imageSmoothingEnabled = true;
      dst.x.filter = this.filterOK ? `blur(${blur}px)` : "none";
      dst.x.drawImage(src.c, 0, 0, dst.w, dst.h);
      dst.x.filter = "none";
      src = dst;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    for (const [b, a] of [
      [b1, 0.85],
      [b2, 0.7],
      [b3, 0.6],
    ] as [Buf, number][]) {
      ctx.globalAlpha = clamp(strength * a, 0, 1);
      ctx.drawImage(b.c, 0, 0, b.w, b.h, 0, 0, W, H);
    }
    ctx.globalAlpha = clamp(strength * 0.55, 0, 1);
    ctx.drawImage(glow.c, 0, 0);
    ctx.restore();
    // the glow buffer is cleared lazily on the next frame
    this.glowDirty = true;
  }

  private drawObject(scene: Scene, o: SceneObject, r: Resolved, lights: LiveLight[], t: number, u: number) {
    const { ctx } = this;
    const env = scene.env;
    const M = toPx(r.geom, u);
    const geo = this.geometry(o, r.ev.morph);
    const b = geo.bounds;

    // colours: morph tween + atmospheric depth haze
    let fill = o.fillTo ? mixColor(o.fill, o.fillTo, r.ev.morph) : o.fill;
    const hazeK = env.haze ? clamp(o.depth * env.haze.amount * 1.8, 0, 0.9) : 0;
    if (env.haze && hazeK > 0 && fill !== "none") fill = mixColor(fill, env.haze.color, hazeK);

    const fillDraw = (c: CanvasRenderingContext2D, gradient = true) => {
      if (geo.text && o.text) {
        c.fillStyle = fill;
        drawKinetic(c, o.text, t);
      } else if (geo.path) {
        const img = o.image ? getImage(o.image) : null;
        if (img) {
          c.save();
          c.clip(geo.path);
          c.drawImage(img, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
          c.restore();
        } else if (fill !== "none" && o.fill !== "none") {
          if (gradient && o.gradient) {
            const a = (o.gradient.angle * Math.PI) / 180;
            const cx = (b.x0 + b.x1) / 2;
            const cy = (b.y0 + b.y1) / 2;
            const hw = ((b.x1 - b.x0) / 2) * Math.cos(a);
            const hh = ((b.y1 - b.y0) / 2) * Math.sin(a);
            const g = c.createLinearGradient(cx - hw, cy - hh, cx + hw, cy + hh);
            g.addColorStop(0, o.gradient.from);
            g.addColorStop(1, o.gradient.to);
            c.fillStyle = g;
          } else c.fillStyle = fill;
          c.fill(geo.path);
        }
      }
    };
    const maskDraw = (c: CanvasRenderingContext2D) => {
      if (geo.text && o.text) {
        c.font = fontOf(o.text);
        drawKinetic(c, o.text, t);
      } else if (geo.path) {
        const img = o.image ? getImage(o.image) : null;
        if (img) c.drawImage(img, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); // rim follows the sprite's alpha
        else c.fill(geo.path);
      }
    };

    // bounding box in pixel space (for scratch-buffer clipping, AO, glow)
    const c0 = applyM(M, b.x0, b.y0);
    const c1 = applyM(M, b.x1, b.y0);
    const c2 = applyM(M, b.x1, b.y1);
    const c3 = applyM(M, b.x0, b.y1);
    const minX = Math.min(c0.x, c1.x, c2.x, c3.x);
    const maxX = Math.max(c0.x, c1.x, c2.x, c3.x);
    const minY = Math.min(c0.y, c1.y, c2.y, c3.y);
    const maxY = Math.max(c0.y, c1.y, c2.y, c3.y);
    const centerLocal = applyM(r.geom, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); // stage units
    const radiusPx = Math.hypot(maxX - minX, maxY - minY) / 2;
    const objLights = lights.length ? lights.filter((L) => lightAffects(L, o.id)) : lights;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // ambient occlusion pool (cached sprite — no per-frame gradient)
    if (o.ao > 0) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2 + radiusPx * 0.25;
      const rad = radiusPx * 1.7;
      ctx.globalAlpha = clamp(o.ao * 0.55 * r.opacity, 0, 1);
      ctx.drawImage(shadowPool(), cx - rad, cy - rad, rad * 2, rad * 2);
    }

    // depth of field: only objects that are visibly out of focus pay for a blur, and only for their fill
    let dofBlur = 0;
    if (this.filterOK && env.dof.amount > 0 && o.depth !== env.dof.focus) {
      const blur = Math.abs(o.depth - env.dof.focus) * env.dof.amount * (this.canvas.width / 700);
      if (blur >= 0.75) dofBlur = blur;
    }

    ctx.globalAlpha = clamp(r.opacity, 0, 1);
    ctx.globalCompositeOperation = o.blend;
    ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);

    // soft cast shadow: layered offset silhouettes (no ctx.shadowBlur), direction from the strongest affecting light
    if (o.shadow && o.shadow.opacity > 0) {
      let key: LiveLight | undefined;
      for (const L of objLights) if (!key || L.intensity > key.intensity) key = L;
      let sx = o.shadow.dx;
      let sy = o.shadow.dy;
      if (o.shadow.auto && key) {
        let dx: number;
        let dy: number;
        if (key.l.type === "sun") {
          dx = Math.cos((key.angle * Math.PI) / 180);
          dy = Math.sin((key.angle * Math.PI) / 180);
        } else {
          const vx = key.x - centerLocal.x;
          const vy = key.y - centerLocal.y;
          const d = Math.hypot(vx, vy) || 1;
          dx = vx / d;
          dy = vy / d;
        }
        sx = -dx * o.shadow.dx;
        sy = -dy * o.shadow.dx;
      }
      const scale = Math.hypot(M[0], M[1]) || 1;
      const blurLocal = (o.shadow.blur * u) / scale; // blur radius in object units
      const LAYERS = 3;
      const base = ctx.globalAlpha;
      ctx.save();
      ctx.setTransform(M[0], M[1], M[2], M[3], M[4] + sx * u, M[5] + sy * u);
      ctx.fillStyle = "#000";
      ctx.strokeStyle = "#000";
      ctx.lineJoin = "round";
      ctx.globalAlpha = clamp((o.shadow.opacity * base) / LAYERS, 0, 1);
      for (let k = 0; k < LAYERS; k++) {
        const w = blurLocal * (1 - k / LAYERS);
        if (geo.text && o.text) {
          ctx.font = fontOf(o.text);
          const off = (blurLocal * (k - 1)) / 2;
          ctx.translate(off, off);
          drawKinetic(ctx, o.text, t);
          ctx.translate(-off, -off);
        } else if (geo.path) {
          ctx.fill(geo.path);
          if (w > 0.01) {
            ctx.lineWidth = w;
            ctx.stroke(geo.path);
          }
        }
      }
      ctx.restore();
    }

    if (dofBlur > 0) ctx.filter = `blur(${dofBlur.toFixed(1)}px)`;
    fillDraw(ctx);
    if (dofBlur > 0) ctx.filter = "none";
    if (o.stroke && geo.path) {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.strokeWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke(geo.path);
    }

    // diffuse light pass (clipped to the silhouette): directional wash, cone-limited spot, cached-sprite area light
    if (o.lit && geo.path && objLights.length) {
      ctx.save();
      ctx.clip(geo.path);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "screen";
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      for (const L of objLights) {
        if (L.l.type === "sun") {
          const a = (L.angle * Math.PI) / 180;
          const g = ctx.createLinearGradient(cx + Math.cos(a) * radiusPx, cy + Math.sin(a) * radiusPx, cx - Math.cos(a) * radiusPx, cy - Math.sin(a) * radiusPx);
          g.addColorStop(0, rgba(L.l.color, 0.12 * L.intensity));
          g.addColorStop(1, rgba(L.l.color, 0));
          ctx.fillStyle = g;
          ctx.globalAlpha = 1;
          ctx.fillRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
        } else if (L.l.type === "spot") {
          const beam = (L.angle * Math.PI) / 180;
          let da = Math.abs(Math.atan2(centerLocal.y - L.y, centerLocal.x - L.x) - beam);
          da = Math.min(da, Math.PI * 2 - da);
          const fall = 1 - clamp(((da * 180) / Math.PI - L.cone * 0.7) / (L.cone * 0.7 || 1), 0, 1);
          if (fall > 0.02) {
            const len = L.radius * u * 1.4;
            const g = ctx.createLinearGradient(L.x * u, L.y * u, L.x * u + Math.cos(beam) * len, L.y * u + Math.sin(beam) * len);
            g.addColorStop(0, rgba(L.l.color, 0.3 * L.intensity * fall));
            g.addColorStop(1, rgba(L.l.color, 0));
            ctx.fillStyle = g;
            ctx.globalAlpha = 1;
            ctx.fillRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
          }
        } else {
          blitGlow(ctx, L.l.color, L.x * u, L.y * u, L.radius * u, 0.2 * L.intensity);
        }
      }
      ctx.restore();
    }
    ctx.restore();

    // emissive glow → bloom buffer
    const glowAmt = r.ev.glow;
    if (glowAmt > 0 && this.glow) {
      const g = this.glow.x;
      this.glowDirty = true;
      g.save();
      g.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = clamp(glowAmt * r.opacity * 0.8, 0, 1);
      if (geo.text && o.text) {
        g.fillStyle = fill;
        drawKinetic(g, o.text, t);
      } else if (geo.path) {
        g.fillStyle = fill;
        g.fill(geo.path);
      }
      g.restore();
    }

    // rim light (directional rim highlight from every light that affects this object)
    if (o.rim && o.rim.intensity > 0 && r.ev.rim > 0 && this.layer && this.glow) {
      const spreadPx = o.rim.spread * u;
      const contribs = rimContribs(lights, centerLocal.x, centerLocal.y, o.rim.angle, o.rim.lightColor && lights.length ? null : o.rim.color, o.id);
      if (contribs.length) {
        const pad = spreadPx + 3;
        const toGlow = env.bloom > 0;
        if (toGlow) this.glowDirty = true;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        drawRim(
          ctx,
          this.layer,
          this.glow,
          M,
          { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
          maskDraw,
          contribs,
          o.rim.spread,
          o.rim.intensity * r.ev.rim * clamp(r.opacity, 0, 1),
          u,
          toGlow,
        );
        ctx.restore();
      }
    }
  }

  // ---------- editor overlay ----------
  private overlay(scene: Scene, res: Map<string, Resolved>, lights: LiveLight[], sel: string | null, u: number, t: number) {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.lineWidth = 1.25;

    void lights; // light emitters are edited through the SVG handle layer (Viewport), never drawn into the frame
    const Hu = stageH(scene);
    for (const e of scene.emitters) {
      if (!e.visible || e.follow) continue;
      const x = e.x * u;
      const y = (e.y / 100) * Hu * u;
      this.markers.push({ id: e.id, kind: "emitter", x, y });
      const on = sel === e.id;
      ctx.strokeStyle = on ? "#06B6D4" : "rgba(6,182,212,0.6)";
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 8, y);
      ctx.lineTo(x, y + 8);
      ctx.lineTo(x - 8, y);
      ctx.closePath();
      ctx.stroke();
    }

    const o = scene.objects.find((x) => x.id === sel);
    const r = o ? res.get(o.id) : undefined;
    if (o && r && !r.hidden) {
      const M = toPx(r.geom, u);
      const geo = this.geometry(o, r.ev.morph);
      const b = geo.bounds;
      const cs = [applyM(M, b.x0, b.y0), applyM(M, b.x1, b.y0), applyM(M, b.x1, b.y1), applyM(M, b.x0, b.y1)];
      const cx = (cs[0].x + cs[2].x) / 2;
      const cy = (cs[0].y + cs[2].y) / 2;
      const topMid = { x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2 };
      const dir = { x: topMid.x - cx, y: topMid.y - cy };
      const dl = Math.hypot(dir.x, dir.y) || 1;
      const rot = { x: topMid.x + (dir.x / dl) * 22, y: topMid.y + (dir.y / dl) * 22 };
      const pv = applyM(toPx(r.frame, u), 0, 0);
      this.gizmo = { id: o.id, center: { x: cx, y: cy }, rot, scale: cs[2], corners: cs, pivot: pv };
      ctx.strokeStyle = "#3B82F6";
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      cs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(topMid.x, topMid.y);
      ctx.lineTo(rot.x, rot.y);
      ctx.stroke();
      ctx.fillStyle = "#0E1118";
      for (const p of cs) {
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
        ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
      }
      ctx.beginPath();
      ctx.arc(rot.x, rot.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#06B6D4";
      ctx.beginPath();
      ctx.moveTo(pv.x - 8, pv.y);
      ctx.lineTo(pv.x + 8, pv.y);
      ctx.moveTo(pv.x, pv.y - 8);
      ctx.lineTo(pv.x, pv.y + 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pv.x, pv.y, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    void t;
    ctx.restore();
  }

  /** Top-most object under a canvas pixel. */
  hitTest(scene: Scene, px: number, py: number): string | null {
    const res = this.lastRes;
    if (!res) return null;
    const u = this.lastU;
    const hc = this.hitCtx;
    for (let i = scene.objects.length - 1; i >= 0; i--) {
      const o = scene.objects[i];
      const r = res.get(o.id);
      if (!r || r.hidden || r.opacity <= 0.01) continue;
      const inv = invertM(toPx(r.geom, u));
      const lp = applyM(inv, px, py);
      const geo = this.geometry(o, r.ev.morph);
      if (geo.text || !geo.path) {
        const b = geo.bounds;
        if (lp.x >= b.x0 && lp.x <= b.x1 && lp.y >= b.y0 && lp.y <= b.y1) return o.id;
        continue;
      }
      hc.setTransform(1, 0, 0, 1, 0, 0);
      hc.lineWidth = Math.max(o.strokeWidth, 2 / (u * Math.max(0.2, r.ev.scale)));
      if (hc.isPointInPath(geo.path, lp.x, lp.y) || ((o.fill === "none" || o.stroke) && hc.isPointInStroke(geo.path, lp.x, lp.y))) return o.id;
    }
    return null;
  }

  hitMarker(px: number, py: number): Marker | null {
    for (const m of this.markers) if (Math.hypot(m.x - px, m.y - py) <= 14) return m;
    return null;
  }
}

export { IDENT };
export type { Mat };
