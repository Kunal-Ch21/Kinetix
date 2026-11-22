import type { Emitter, Environment, Light, Scene, SceneObject } from "./types";
import { circlePath } from "./shapes";

export function newId(scene: Scene, prefix: string): string {
  scene.seq += 1;
  return `${prefix}_${String(scene.seq).padStart(2, "0")}`;
}

export function makeObject(p: Partial<SceneObject> & { id: string }): SceneObject {
  return {
    label: p.id,
    aliases: [],
    tags: [],
    kind: "shape",
    parent: null,
    visible: true,
    x: 50,
    y: 50,
    rotation: 0,
    scale: 1,
    pivotX: 0,
    pivotY: 0,
    opacity: 1,
    path: circlePath(8),
    morphTo: null,
    morph: 0,
    fill: "#3B82F6",
    fillTo: null,
    gradient: null,
    stroke: null,
    strokeWidth: 0.4,
    blend: "source-over",
    glow: 0,
    depth: 0,
    ao: 0,
    lit: false,
    rim: null,
    shadow: null,
    text: null,
    tracks: [],
    ...p,
  };
}

export function makeLight(p: Partial<Light> & { id: string }): Light {
  return {
    label: p.id,
    type: "point",
    visible: true,
    x: 50,
    y: 30,
    follow: null,
    color: "#FFD08A",
    intensity: 1,
    radius: 50,
    angle: 90,
    cone: 28,
    affects: [],
    volumetric: true,
    tracks: [],
    ...p,
  };
}

export function makeEmitter(p: Partial<Emitter> & { id: string }): Emitter {
  const base: Emitter = {
    label: p.id,
    kind: "embers",
    visible: true,
    x: 50,
    y: 100,
    follow: null,
    area: 100,
    rate: 20,
    life: 3,
    speed: 4,
    spread: 40,
    angle: -90,
    size: 0.8,
    color: "#FFB347",
    color2: null,
    gravity: 0,
    additive: true,
    start: 0,
    end: 0,
    layer: "front",
    seed: 1 + Math.floor(Math.random() * 9999),
    ...p,
  };
  return base;
}

export const ENV_PRESETS: Record<string, Environment> = {
  none: {
    sky: [
      { at: 0, color: "#07090E" },
      { at: 1, color: "#0E1424" },
    ],
    sun: null,
    stars: 0,
    clouds: null,
    mountains: [],
    haze: null,
    dof: { focus: 0.5, amount: 0 },
    bloom: 0.7,
    vignette: 0.35,
  },
  dusk: {
    sky: [
      { at: 0, color: "#0B1028" },
      { at: 0.35, color: "#2B1B4D" },
      { at: 0.62, color: "#8A3A5C" },
      { at: 0.82, color: "#F4793B" },
      { at: 1, color: "#FBBF4D" },
    ],
    sun: null,
    stars: 60,
    clouds: { count: 9, speed: 0.6, color: "#FFB27A", shade: "#4A2A58", opacity: 0.8, y0: 32, y1: 68 },
    mountains: [
      { color: "#3B2750", base: 78, height: 10, parallax: 0.2, seed: 3, haze: 0.55 },
      { color: "#241838", base: 86, height: 14, parallax: 0.5, seed: 7, haze: 0.3 },
      { color: "#120C20", base: 97, height: 12, parallax: 1, seed: 11, haze: 0.1 },
    ],
    haze: { color: "#FF9A5C", amount: 0.28, horizon: 76 },
    dof: { focus: 0.5, amount: 1.5 },
    bloom: 0.9,
    vignette: 0.45,
  },
  night: {
    sky: [
      { at: 0, color: "#02030A" },
      { at: 0.6, color: "#0B1230" },
      { at: 1, color: "#16224A" },
    ],
    sun: null,
    stars: 140,
    clouds: { count: 5, speed: 0.3, color: "#41507A", shade: "#0A0F24", opacity: 0.55, y0: 15, y1: 50 },
    mountains: [
      { color: "#101A38", base: 80, height: 12, parallax: 0.2, seed: 5, haze: 0.4 },
      { color: "#080E22", base: 92, height: 14, parallax: 0.6, seed: 9, haze: 0.2 },
    ],
    haze: { color: "#2A3F7A", amount: 0.22, horizon: 78 },
    dof: { focus: 0.5, amount: 1 },
    bloom: 1,
    vignette: 0.5,
  },
  dawn: {
    sky: [
      { at: 0, color: "#3A4D8F" },
      { at: 0.5, color: "#C98DB8" },
      { at: 0.8, color: "#FFB88A" },
      { at: 1, color: "#FFE3A3" },
    ],
    sun: null,
    stars: 0,
    clouds: { count: 8, speed: 0.4, color: "#FFE0C8", shade: "#8E6A9E", opacity: 0.8, y0: 25, y1: 65 },
    mountains: [
      { color: "#6C6FA8", base: 80, height: 10, parallax: 0.2, seed: 2, haze: 0.5 },
      { color: "#3F4580", base: 90, height: 14, parallax: 0.5, seed: 4, haze: 0.3 },
    ],
    haze: { color: "#FFD2A8", amount: 0.3, horizon: 78 },
    dof: { focus: 0.5, amount: 1 },
    bloom: 0.8,
    vignette: 0.3,
  },
  storm: {
    sky: [
      { at: 0, color: "#10141C" },
      { at: 0.6, color: "#2A3140" },
      { at: 1, color: "#4A5568" },
    ],
    sun: null,
    stars: 0,
    clouds: { count: 12, speed: 1.2, color: "#7A8499", shade: "#1B212C", opacity: 0.9, y0: 5, y1: 55 },
    mountains: [{ color: "#1A202B", base: 88, height: 12, parallax: 0.4, seed: 8, haze: 0.4 }],
    haze: { color: "#6B7589", amount: 0.3, horizon: 80 },
    dof: { focus: 0.5, amount: 1 },
    bloom: 0.5,
    vignette: 0.55,
  },
  day: {
    sky: [
      { at: 0, color: "#2E7BD6" },
      { at: 0.7, color: "#8EC5F5" },
      { at: 1, color: "#E8F4FF" },
    ],
    sun: null,
    stars: 0,
    clouds: { count: 8, speed: 0.5, color: "#FFFFFF", shade: "#A9C3E0", opacity: 0.9, y0: 10, y1: 55 },
    mountains: [
      { color: "#7FA3C8", base: 78, height: 10, parallax: 0.2, seed: 1, haze: 0.5 },
      { color: "#4D7A5A", base: 90, height: 12, parallax: 0.6, seed: 6, haze: 0.2 },
    ],
    haze: { color: "#DFF0FF", amount: 0.25, horizon: 76 },
    dof: { focus: 0.5, amount: 1 },
    bloom: 0.5,
    vignette: 0.2,
  },
};

export function cloneEnv(e: Environment): Environment {
  return JSON.parse(JSON.stringify(e)) as Environment;
}

export function emptyScene(name = "Untitled Project"): Scene {
  return {
    name,
    duration: 10,
    fps: 60,
    width: 1920,
    height: 1080,
    env: cloneEnv(ENV_PRESETS.none),
    objects: [],
    lights: [],
    emitters: [],
    events: [],
    seq: 0,
  };
}

/** Fuzzy alias-aware reference resolution (id → label → alias → substring). */
export function findObject(scene: Scene, ref: unknown): SceneObject | undefined {
  if (typeof ref !== "string" || !ref) return undefined;
  const q = ref.trim().toLowerCase();
  const o = scene.objects;
  return (
    o.find((x) => x.id.toLowerCase() === q) ??
    o.find((x) => x.label.toLowerCase() === q) ??
    o.find((x) => x.aliases.some((a) => a.toLowerCase() === q)) ??
    o.find((x) => x.label.toLowerCase().includes(q) || q.includes(x.label.toLowerCase())) ??
    o.find((x) => x.aliases.some((a) => a.toLowerCase().includes(q)))
  );
}

export function descendantsOf(scene: Scene, id: string): SceneObject[] {
  const out: SceneObject[] = [];
  const walk = (pid: string, depth: number) => {
    if (depth > 32) return;
    for (const o of scene.objects)
      if (o.parent === pid) {
        out.push(o);
        walk(o.id, depth + 1);
      }
  };
  walk(id, 0);
  return out;
}
