// Keyframe evaluation + parent-child rig resolution (children inherit parent transforms every frame).
import { IDENT, Mat, applyM, mul, resolveEase, rotateM, scaleM, translateM } from "./math";
import type { Scene, SceneObject, Track } from "./types";

export const stageH = (s: Pick<Scene, "width" | "height">) => (100 * s.height) / s.width;

export function evalTrack(tr: Track, t: number): number {
  const k = tr.keys;
  if (!k.length) return 0;
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < k.length - 1 && k[i + 1].t <= t) i++;
  const a = k[i];
  const b = k[i + 1];
  const p = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return a.v + (b.v - a.v) * resolveEase(a.ease)(p);
}
export function evalProp(tracks: Track[], prop: string, t: number, base: number): number {
  const tr = tracks.find((x) => x.prop === prop);
  return tr && tr.keys.length ? evalTrack(tr, t) : base;
}

export interface Evaled {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  opacity: number;
  morph: number;
  glow: number;
  rim: number;
}
export function evalObj(o: SceneObject, t: number): Evaled {
  const g = (p: string, b: number) => evalProp(o.tracks, p, t, b);
  return {
    x: g("x", o.x),
    y: g("y", o.y),
    rotation: g("rotation", o.rotation),
    scale: g("scale", o.scale),
    opacity: g("opacity", o.opacity),
    morph: g("morph", o.morph),
    glow: g("glow", o.glow),
    rim: g("rim", 1),
  };
}

export interface Resolved {
  ev: Evaled;
  frame: Mat; // anchor frame (origin = object position)
  geom: Mat; // frame · T(-pivot): maps local geometry -> stage units
  parentGeom: Mat | null;
  opacity: number; // inherited
  hidden: boolean;
}

export function resolveScene(scene: Scene, t: number): Map<string, Resolved> {
  const by = new Map<string, SceneObject>();
  for (const o of scene.objects) by.set(o.id, o);
  const memo = new Map<string, Resolved>();
  const Hu = stageH(scene);
  const visit = (o: SceneObject, stack: Set<string>): Resolved => {
    const hit = memo.get(o.id);
    if (hit) return hit;
    const ev = evalObj(o, t);
    const parent = o.parent && !stack.has(o.parent) ? by.get(o.parent) : undefined;
    const local = mul(rotateM(ev.rotation), scaleM(ev.scale, ev.scale));
    let frame: Mat;
    let parentGeom: Mat | null = null;
    let opacity = ev.opacity;
    let hidden = !o.visible;
    if (parent) {
      stack.add(o.id);
      const pr = visit(parent, stack);
      stack.delete(o.id);
      parentGeom = pr.geom;
      opacity *= pr.opacity;
      hidden = hidden || pr.hidden;
      frame = mul(pr.geom, mul(translateM(ev.x, ev.y), local));
    } else {
      frame = mul(translateM(ev.x, (ev.y / 100) * Hu), local);
    }
    const r: Resolved = { ev, frame, geom: mul(frame, translateM(-o.pivotX, -o.pivotY)), parentGeom, opacity, hidden };
    memo.set(o.id, r);
    return r;
  };
  for (const o of scene.objects) visit(o, new Set([o.id]));
  return memo;
}

/** Anchor of one object in normalised 0-100 grid coords at time t (for trails, light follow). */
export function anchorNorm(scene: Scene, id: string, t: number, res?: Map<string, Resolved>): { x: number; y: number } | null {
  const r = (res ?? resolveScene(scene, t)).get(id);
  if (!r) return null;
  const p = applyM(r.frame, 0, 0);
  return { x: p.x, y: (p.y / stageH(scene)) * 100 };
}

export { IDENT };
