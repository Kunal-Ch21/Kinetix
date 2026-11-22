// 2D realistic lighting. Lights are INVISIBLE studio emitters (no sun disc, no glowing orb):
//   point  = Area / Point light      — soft wash, no hot core
//   spot   = Spot / Cone beam        — cone from origin (x,y) toward target (tx,ty), `cone` = half-angle, `radius` = falloff
//   sun    = Directional rim light   — parallel light travelling from origin (x,y) across the scene toward target (tx,ty)
// They light / rim-highlight / shadow the objects they `affect` (all objects when the list is empty).
import { blitGlow } from "./cache";
import { Mat, clamp, mixColor, rgba } from "./math";
import { anchorNorm, evalProp, stageH } from "./rig";
import type { Resolved } from "./rig";
import type { Light, Scene } from "./types";

export interface Buf {
  c: HTMLCanvasElement;
  x: CanvasRenderingContext2D;
  w: number;
  h: number;
}
export interface LiveLight {
  l: Light;
  x: number; // origin, stage units (x 0-100, y 0-stageH)
  y: number;
  tx: number; // aim target, stage units
  ty: number;
  intensity: number;
  radius: number; // falloff distance
  /** spot: beam direction (deg, origin -> target). sun: direction TOWARD the light (deg). point: unused. */
  angle: number;
  cone: number;
  affects: string[] | null; // null = every object
}
export interface RimContrib {
  dx: number; // unit vector toward the light (pixel space)
  dy: number;
  color: string;
  k: number;
}

const DEG = Math.PI / 180;

/** True when this light illuminates the given object. */
export const lightAffects = (L: LiveLight, objId: string) => !L.affects || L.affects.includes(objId);

export function evalLights(scene: Scene, t: number, res: Map<string, Resolved>): LiveLight[] {
  const Hu = stageH(scene);
  const out: LiveLight[] = [];
  for (const l of scene.lights) {
    if (!l.visible) continue;
    const nx = evalProp(l.tracks, "x", t, l.x);
    const ny = evalProp(l.tracks, "y", t, l.y);
    let ax = 0;
    let ay = 0;
    if (l.follow) {
      const a = anchorNorm(scene, l.follow, t, res);
      if (a) {
        ax = a.x;
        ay = a.y;
      }
    }
    const aimed = l.tx !== undefined && l.ty !== undefined;
    let angle = evalProp(l.tracks, "angle", t, l.angle);
    let sx = ((nx + ax) / 100) * 100;
    let sy = ((ny + ay) / 100) * Hu;
    let stx: number;
    let sty: number;
    if (aimed) {
      stx = evalProp(l.tracks, "tx", t, l.tx as number) + ax;
      sty = (((evalProp(l.tracks, "ty", t, l.ty as number) + ay) / 100) * Hu);
      if (l.type === "spot") angle = Math.atan2(sty - sy, stx - sx) / DEG;
      else if (l.type === "sun") angle = Math.atan2(sy - sty, sx - stx) / DEG;
    } else if (l.type === "spot") {
      // legacy spot: beam direction only -> synthesise a target 25 units down the beam
      stx = sx + Math.cos(angle * DEG) * 25;
      sty = sy + Math.sin(angle * DEG) * 25;
    } else if (l.type === "sun") {
      // legacy directional: angle points toward the light; park the origin 45 units out from the stage centre
      stx = 50;
      sty = Hu / 2;
      sx = stx + Math.cos(angle * DEG) * 45;
      sy = sty + Math.sin(angle * DEG) * 45;
    } else {
      stx = sx;
      sty = sy;
    }
    out.push({
      l,
      x: sx,
      y: sy,
      tx: stx,
      ty: sty,
      intensity: Math.max(0, evalProp(l.tracks, "intensity", t, l.intensity)),
      radius: Math.max(1, evalProp(l.tracks, "radius", t, l.radius)),
      angle,
      cone: Math.max(2, evalProp(l.tracks, "cone", t, l.cone)),
      affects: l.affects && l.affects.length ? l.affects : null,
    });
  }
  return out;
}

const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Which lights rim-light an object centred at (cx,cy) stage units, strongest first. */
export function rimContribs(lights: LiveLight[], cx: number, cy: number, fallbackAngle: number, fixedColor: string | null, objId = ""): RimContrib[] {
  if (!lights.length) {
    const a = (fallbackAngle * Math.PI) / 180;
    return [{ dx: Math.cos(a), dy: Math.sin(a), color: fixedColor ?? "#FFFFFF", k: 1 }];
  }
  const out: RimContrib[] = [];
  for (const L of lights) {
    if (objId && !lightAffects(L, objId)) continue;
    let dx: number;
    let dy: number;
    let fall = 1;
    if (L.l.type === "sun") {
      const a = (L.angle * Math.PI) / 180;
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else {
      const vx = L.x - cx;
      const vy = L.y - cy;
      const dist = Math.hypot(vx, vy) || 1e-6;
      dx = vx / dist;
      dy = vy / dist;
      fall = Math.pow(clamp(1 - dist / (L.radius * 1.6), 0, 1), 0.8);
      if (L.l.type === "spot") {
        const beam = (L.angle * Math.PI) / 180;
        const toObj = Math.atan2(cy - L.y, cx - L.x);
        let da = Math.abs(toObj - beam);
        da = Math.min(da, Math.PI * 2 - da);
        fall *= 1 - smooth(L.cone * 0.7, L.cone * 1.4, (da * 180) / Math.PI);
      }
    }
    const k = L.intensity * fall;
    if (k > 0.04) out.push({ dx, dy, color: fixedColor ?? L.l.color, k });
  }
  out.sort((a, b) => b.k - a.k);
  return out.slice(0, 2);
}

/** Specular rim-lighting crescent: draw shape, erase an offset copy, colourise what's left, add to scene + bloom buffer. */
export function drawRim(
  main: CanvasRenderingContext2D,
  layer: Buf,
  glow: Buf,
  M: Mat,
  bbox: { x: number; y: number; w: number; h: number },
  draw: (c: CanvasRenderingContext2D) => void,
  contribs: RimContrib[],
  spread: number,
  intensity: number,
  u: number,
  toGlow = true,
) {
  const bx = Math.max(0, Math.floor(bbox.x));
  const by = Math.max(0, Math.floor(bbox.y));
  const bw = Math.min(layer.w - bx, Math.ceil(bbox.w));
  const bh = Math.min(layer.h - by, Math.ceil(bbox.h));
  if (bw <= 1 || bh <= 1) return;
  const lc = layer.x;
  const passes = [
    { sp: spread, a: 0.55, white: 0 },
    { sp: spread * 0.35, a: 0.95, white: 0.55 },
  ];
  for (const c of contribs) {
    for (const ps of passes) {
      lc.save();
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = "source-over";
      lc.globalAlpha = 1;
      lc.clearRect(bx, by, bw, bh);
      lc.beginPath();
      lc.rect(bx, by, bw, bh);
      lc.clip();
      lc.fillStyle = "#fff";
      lc.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      draw(lc);
      lc.globalCompositeOperation = "destination-out";
      lc.setTransform(M[0], M[1], M[2], M[3], M[4] - c.dx * ps.sp * u, M[5] - c.dy * ps.sp * u);
      draw(lc);
      lc.globalCompositeOperation = "source-in";
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.fillStyle = ps.white ? mixColor(c.color, "#ffffff", ps.white) : c.color;
      lc.fillRect(bx, by, bw, bh);
      lc.restore();
      const alpha = clamp(c.k * intensity * ps.a, 0, 1);
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalCompositeOperation = "lighter";
      main.globalAlpha = alpha;
      main.drawImage(layer.c, bx, by, bw, bh, bx, by, bw, bh);
      main.restore();
      if (toGlow && ps.white) {
        glow.x.save();
        glow.x.setTransform(1, 0, 0, 1, 0, 0);
        glow.x.globalCompositeOperation = "lighter";
        glow.x.globalAlpha = alpha * 0.6;
        glow.x.drawImage(layer.c, bx, by, bw, bh, bx, by, bw, bh);
        glow.x.restore();
      }
    }
  }
}

/**
 * Atmospheric light shafts (soft cone / wash). The emitter itself is never drawn — only the light it throws.
 * Spot: translucent cone from origin toward target. Directional: a faint parallel wash. Point: a soft area wash
 * from a cached glow sprite (no hot core, no rays).
 */
export function drawVolumetrics(ctx: CanvasRenderingContext2D, lights: LiveLight[], W: number, H: number, u: number) {
  for (const L of lights) {
    if (!L.l.volumetric || L.intensity <= 0.01) continue;
    const px = L.x * u;
    const py = L.y * u;
    const I = clamp(L.intensity, 0, 2);
    const col = L.l.color;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    if (L.l.type === "spot") {
      const ang = L.angle * DEG;
      const half = L.cone * DEG;
      const len = L.radius * u * 1.5;
      for (const w of [1, 0.68, 0.4]) {
        const a = half * w;
        const g = ctx.createLinearGradient(px, py, px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        g.addColorStop(0, rgba(col, 0.2 * I));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang - a) * len, py + Math.sin(ang - a) * len);
        ctx.lineTo(px + Math.cos(ang + a) * len, py + Math.sin(ang + a) * len);
        ctx.closePath();
        ctx.fill();
      }
    } else if (L.l.type === "point") {
      blitGlow(ctx, col, px, py, L.radius * u * 0.95, 0.34 * I);
    } else {
      // directional: wash travels origin -> target
      const g = ctx.createLinearGradient(px, py, L.tx * u, L.ty * u);
      g.addColorStop(0, rgba(col, 0.16 * I));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
}
