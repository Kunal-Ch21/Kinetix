// "Apex Morph" first-launch showcase: rim-lit Peregrine Falcon → Shadow Beast through volumetric dusk clouds,
// lit by invisible studio lights (spot beam + directional rim + area flash).
import { upsertKey } from "./anim";
import { evalTrack } from "./rig";
import { cloneEnv, ENV_PRESETS, makeEmitter, makeLight, makeObject } from "./scene";
import { circlePath } from "./shapes";
import type { Scene, Track } from "./types";

export const FALCON_PATH =
  "M14,0 C12,-2 10,-3 8,-3 C6,-3.5 4,-5 2,-6 C0,-11 -5,-19 -13,-25 C-11,-18 -10,-13 -9,-9 C-8,-8 -8,-6.5 -8,-5 C-12,-4 -17,-3 -22,-2.5 L-25,-1.5 L-25,1.5 L-22,2.5 C-17,3 -12,4 -8,5 C-8,6.5 -8,8 -9,9 C-10,13 -11,18 -13,25 C-5,19 0,11 2,6 C4,5 6,3.5 8,3 C10,3 12,2 14,0 Z";
export const BEAST_PATH =
  "M18,0 C16,-1 15,-2 13,-2.5 L14,-7 L9,-3.5 C7,-4 5,-6 3,-8 L-2,-20 L-6,-14 L-10,-26 L-12,-16 L-17,-22 L-17,-10 L-15,-6 C-18,-5 -22,-4 -28,-3 L-30,0 L-28,3 C-22,4 -18,5 -15,6 L-17,10 L-17,22 L-12,16 L-10,26 L-6,14 L-2,20 L3,8 C5,6 7,4 9,3.5 L14,7 L13,2.5 C15,2 16,1 18,0 Z";

/** Bake a smooth keyframed path plus a gentle sway so the flight feels alive. */
function bake(base: { t: number; v: number; ease?: string }[], sway: (t: number) => number, dur: number): Track {
  const guide: Track = { prop: "g", keys: base.map((k) => ({ t: k.t, v: k.v, ease: k.ease ?? "ease_in_out" })) };
  const out: Track = { prop: "", keys: [] };
  for (let t = 0; t <= dur + 1e-6; t += 0.2) out.keys.push({ t: Math.round(t * 1000) / 1000, v: Math.round((evalTrack(guide, t) + sway(t)) * 1000) / 1000, ease: "ease_in_out" });
  return out;
}

export function buildApexMorph(): Scene {
  const D = 10;
  const s: Scene = {
    name: "Apex Morph",
    duration: D,
    fps: 60,
    width: 1920,
    height: 1080,
    env: { ...cloneEnv(ENV_PRESETS.dusk), dof: { focus: 0.2, amount: 1.5 } },
    objects: [],
    lights: [],
    emitters: [],
    events: [
      { id: "ev_01", start: 0, end: 3.5, title: "Falcon Soars" },
      { id: "ev_02", start: 3.5, end: 5.5, title: "Mid-Air Morph" },
      { id: "ev_03", start: 5.5, end: 10, title: "Shadow Beast Prowls" },
    ],
    seq: 20,
  };

  const falcon = makeObject({
    id: "asset_03",
    label: "Peregrine Falcon",
    aliases: ["falcon", "bird", "shadow beast", "beast"],
    tags: ["hero", "morph"],
    path: FALCON_PATH,
    morphTo: BEAST_PATH,
    x: 8,
    y: 40,
    fill: "#232B3D",
    fillTo: "#0A0710",
    lit: true,
    glow: 0,
    depth: 0.2,
    rim: { color: "#F59E0B", intensity: 1.1, spread: 0.4, lightColor: true, angle: -45 },
    shadow: { opacity: 0.3, blur: 3, dx: 4, dy: 4, auto: true },
  });
  const xs = bake([{ t: 0, v: 6 }, { t: 3.5, v: 40 }, { t: 5.5, v: 52 }, { t: 10, v: 92 }], () => 0, D);
  const ys = bake([{ t: 0, v: 52 }, { t: 1.6, v: 40 }, { t: 3.5, v: 44 }, { t: 5.5, v: 46 }, { t: 8, v: 40 }, { t: 10, v: 48 }], (t) => Math.sin(t * 2.4) * 0.9, D);
  const rots = bake([{ t: 0, v: 14 }, { t: 3.5, v: -8 }, { t: 5.5, v: 0 }, { t: 10, v: -6 }], (t) => Math.sin(t * 2.4 + 1) * 3.2, D);
  const scs = bake([{ t: 0, v: 0.32 }, { t: 3.5, v: 0.42 }, { t: 4.6, v: 0.58 }, { t: 5.5, v: 0.5 }, { t: 10, v: 0.52 }], () => 0, D);
  falcon.tracks.push({ ...xs, prop: "x" }, { ...ys, prop: "y" }, { ...rots, prop: "rotation" }, { ...scs, prop: "scale" });
  upsertKey(falcon, "morph", 0, 0, "linear");
  upsertKey(falcon, "morph", 3.5, 0, [0.65, 0, 0.35, 1]);
  upsertKey(falcon, "morph", 5.5, 1);
  upsertKey(falcon, "glow", 3.5, 0, "ease_in_out");
  upsertKey(falcon, "glow", 5.5, 0.55);
  s.objects.push(falcon);

  for (const [id, label, y] of [["asset_04", "Eye L", -2], ["asset_05", "Eye R", 2]] as const) {
    const eye = makeObject({
      id,
      label,
      parent: "asset_03",
      x: 10.2,
      y,
      path: circlePath(1.0),
      fill: "#FDE68A",
      fillTo: "#22D3EE",
      glow: 1.3,
    });
    upsertKey(eye, "morph", 0, 0, "linear");
    upsertKey(eye, "morph", 3.5, 0, [0.65, 0, 0.35, 1]);
    upsertKey(eye, "morph", 5.5, 1);
    s.objects.push(eye);
  }

  const title = makeObject({
    id: "txt_01",
    label: "Title",
    kind: "text",
    path: "",
    x: 50,
    y: 13,
    fill: "#F4F6FB",
    glow: 0.35,
    text: { content: "APEX MORPH", size: 7.5, weight: 800, align: "center", unit: "char", effect: "rise", stagger: 0.07, duration: 0.7, start: 0.3, font: "sans" },
  });
  upsertKey(title, "opacity", 0, 1, "linear");
  upsertKey(title, "opacity", 3, 1, "ease_in_out");
  upsertKey(title, "opacity", 4, 0);
  const sub = makeObject({
    id: "txt_02",
    label: "Subtitle",
    kind: "text",
    path: "",
    x: 50,
    y: 22,
    fill: "#F59E0B",
    text: { content: "PEREGRINE FALCON", size: 2.2, weight: 600, align: "center", unit: "char", effect: "typewriter", stagger: 0.05, duration: 0.2, start: 1.3, font: "mono" },
  });
  upsertKey(sub, "opacity", 0, 1, "linear");
  upsertKey(sub, "opacity", 3, 1, "ease_in_out");
  upsertKey(sub, "opacity", 4, 0);
  const beastTitle = makeObject({
    id: "txt_03",
    label: "Beast Title",
    kind: "text",
    path: "",
    x: 50,
    y: 14,
    fill: "#22D3EE",
    glow: 1,
    text: { content: "SHADOW BEAST", size: 6.5, weight: 800, align: "center", unit: "word", effect: "pop", stagger: 0.25, duration: 0.7, start: 5.8, font: "sans" },
  });
  upsertKey(beastTitle, "opacity", 0, 1, "linear");
  upsertKey(beastTitle, "opacity", 9, 1, "ease_in_out");
  upsertKey(beastTitle, "opacity", 9.8, 0);
  s.objects.push(title, sub, beastTitle);

  // Lights are invisible emitters: a warm spot beam that tracks the falcon (origin fixed top-right, aim sweeps with it)
  // and a cyan directional rim light raking in from the top-left. Nothing draws a sun disc.
  const key = makeLight({ id: "lt_01", label: "Warm Key Beam", type: "spot", x: 96, y: 6, tx: 10, ty: 52, color: "#FFB347", intensity: 1.15, radius: 120, cone: 22, volumetric: true });
  for (const [t, x, y] of [[0, 10, 52], [3.5, 40, 44], [5.5, 54, 46], [10, 90, 48]] as const) {
    upsertKey(key, "tx", t, x, "ease_in_out");
    upsertKey(key, "ty", t, y, "ease_in_out");
  }
  const moon = makeLight({ id: "lt_02", label: "Cyan Rim Light", type: "sun", x: 6, y: 4, tx: 50, ty: 50, color: "#06B6D4", intensity: 0.5, angle: -140, volumetric: false });
  upsertKey(moon, "intensity", 0, 0.12, "linear");
  upsertKey(moon, "intensity", 3.5, 0.2, "ease_in_out");
  upsertKey(moon, "intensity", 5.5, 1.1);
  const flash = makeLight({ id: "lt_03", label: "Morph Flash (Area)", type: "point", follow: "asset_03", x: 0, y: 0, color: "#FFFFFF", intensity: 0, radius: 22, volumetric: true });
  upsertKey(flash, "intensity", 0, 0, "linear");
  upsertKey(flash, "intensity", 3.6, 0, "ease_out");
  upsertKey(flash, "intensity", 4.5, 0.8, "ease_in");
  upsertKey(flash, "intensity", 5.5, 0);
  s.lights.push(key, moon, flash);

  s.emitters.push(
    makeEmitter({ id: "em_01", label: "Ember Trail", kind: "trail", follow: "asset_03", area: 0, rate: 70, life: 1.4, speed: 2.5, angle: 180, spread: 70, size: 0.5, color: "#F59E0B", color2: "#EF4444", start: 0, end: 5 }),
    makeEmitter({ id: "em_02", label: "Shadow Wisps", kind: "trail", follow: "asset_03", area: 0, rate: 80, life: 1.6, speed: 3, angle: 180, spread: 80, size: 0.6, color: "#06B6D4", color2: "#7C3AED", start: 4.4, end: 0 }),
    makeEmitter({ id: "em_03", label: "Dusk Embers", kind: "embers", x: 50, y: 100, area: 110, rate: 14, life: 6, speed: 3.5, angle: -90, spread: 50, size: 0.55, color: "#FFB347", gravity: -0.3, seed: 77 }),
    makeEmitter({ id: "em_04", label: "Valley Mist", kind: "mist", x: 50, y: 88, area: 110, rate: 3, life: 9, speed: 1.4, angle: 0, spread: 20, size: 13, color: "#FFC9A0", additive: false, layer: "back", seed: 31 }),
  );
  return s;
}
