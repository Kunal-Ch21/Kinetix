import { upsertKey } from "@/engine/anim";
import { evalObj } from "@/engine/rig";
import type { Emitter, Light, Scene, SceneObject, Track } from "@/engine/types";

export type Selected =
  | { kind: "object"; item: SceneObject }
  | { kind: "light"; item: Light }
  | { kind: "emitter"; item: Emitter }
  | null;

export function lookup(scene: Scene, id: string | null): Selected {
  if (!id) return null;
  const o = scene.objects.find((x) => x.id === id);
  if (o) return { kind: "object", item: o };
  const l = scene.lights.find((x) => x.id === id);
  if (l) return { kind: "light", item: l };
  const e = scene.emitters.find((x) => x.id === id);
  if (e) return { kind: "emitter", item: e };
  return null;
}

export function trackOwner(scene: Scene, id: string): { tracks: Track[]; label: string } | null {
  const s = lookup(scene, id);
  if (!s) return null;
  if (s.kind === "emitter") return null;
  return { tracks: s.item.tracks, label: s.item.label };
}

export interface KeyRef {
  owner: string;
  prop: string;
  t: number;
}

/** Set a property at the playhead: writes a keyframe if the prop is already animated, otherwise edits the base value. */
export function setObjProp(o: SceneObject, prop: string, v: number, t: number) {
  const tr = o.tracks.find((x) => x.prop === prop);
  if (tr && tr.keys.length) upsertKey(o, prop, t, v);
  else (o as unknown as Record<string, number>)[prop] = v;
}
export function setLightProp(l: Light, prop: string, v: number, t: number) {
  const tr = l.tracks.find((x) => x.prop === prop);
  if (tr && tr.keys.length) upsertKey(l, prop, t, v);
  else (l as unknown as Record<string, number>)[prop] = v;
}

export function keyAll(o: SceneObject, props: string[], t: number) {
  const ev = evalObj(o, t) as unknown as Record<string, number>;
  for (const p of props) upsertKey(o, p, t, ev[p]);
}

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};
