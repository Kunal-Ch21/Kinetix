import type { Ease } from "./math";
export type { Ease };

export interface Key {
  t: number;
  v: number;
  ease?: Ease;
}
export interface Track {
  prop: string;
  keys: Key[];
}

export interface Gradient {
  from: string;
  to: string;
  angle: number;
}
export interface RimSpec {
  color: string;
  intensity: number;
  spread: number; // in stage units (1 = 1% of stage width)
  lightColor: boolean; // use each light's own colour for its rim
  angle: number; // fallback direction (deg, toward light) when the scene has no lights
}
export interface ShadowSpec {
  opacity: number;
  blur: number;
  dx: number;
  dy: number;
  auto: boolean; // direction derived from the key light; dx = distance
}
export interface TextSpec {
  content: string;
  size: number;
  weight: number;
  align: "left" | "center" | "right";
  unit: "char" | "word";
  effect: "rise" | "fade" | "pop" | "wave" | "typewriter" | "spin" | "drop";
  stagger: number;
  duration: number;
  start: number;
  font: "sans" | "mono";
}

export interface SceneObject {
  id: string;
  label: string;
  aliases: string[];
  tags: string[];
  kind: "shape" | "text" | "image";
  image?: string; // imported asset id (kind "image"): drawn clipped to `path`, lit/rimmed by its alpha
  parent: string | null;
  visible: boolean;
  // Root objects: x,y are normalised 0-100 grid. Child objects: x,y are local offsets (dx,dy) in parent geometry units.
  x: number;
  y: number;
  rotation: number;
  scale: number;
  pivotX: number;
  pivotY: number;
  opacity: number;
  path: string;
  morphTo: string | null;
  morph: number; // 0..1 base morph progress
  fill: string;
  fillTo: string | null;
  gradient: Gradient | null;
  stroke: string | null;
  strokeWidth: number;
  blend: GlobalCompositeOperation;
  glow: number;
  depth: number; // 0 near … 1 far (atmospheric haze + depth of field)
  ao: number;
  lit: boolean;
  rim: RimSpec | null;
  shadow: ShadowSpec | null;
  text: TextSpec | null;
  tracks: Track[];
}

export interface Light {
  id: string;
  label: string;
  /** point = Area / Point light, spot = Spot / Cone beam, sun = Directional rim light. All are invisible emitters. */
  type: "point" | "spot" | "sun";
  visible: boolean;
  x: number; // normalised grid (or offset when follow is set)
  y: number;
  follow: string | null;
  color: string;
  intensity: number;
  radius: number; // stage units
  angle: number; // legacy aim (deg): spot beam direction / sun direction-toward-light (0 = right, -90 = up). Superseded by tx/ty.
  cone: number; // spot half-angle (deg) = "beam angle / cone spread"
  /** Aim target (0-100 grid, same space as x/y). Spot & directional beams travel (x,y) -> (tx,ty); animatable tracks "tx"/"ty". */
  tx?: number;
  ty?: number;
  /** Object ids that receive this light (diffuse, rim highlight, cast shadow). Empty / undefined = every object. */
  affects?: string[];
  volumetric: boolean;
  tracks: Track[];
}

export type EmitterKind = "embers" | "sparks" | "mist" | "rain" | "snow" | "trail";
export interface Emitter {
  id: string;
  label: string;
  kind: EmitterKind;
  visible: boolean;
  x: number;
  y: number;
  follow: string | null;
  area: number; // horizontal spread in grid %
  rate: number; // particles / second
  life: number;
  speed: number;
  spread: number; // deg
  angle: number; // deg, 0 = right, -90 = up
  size: number;
  color: string;
  color2: string | null;
  gravity: number;
  additive: boolean;
  start: number;
  end: number; // 0 = never
  layer: "back" | "front";
  seed: number;
}

export interface Mountain {
  color: string;
  base: number;
  height: number;
  parallax: number;
  seed: number;
  haze: number;
}
export interface Environment {
  sky: { at: number; color: string }[];
  sun: { x: number; y: number; r: number; color: string } | null;
  stars: number;
  clouds: { count: number; speed: number; color: string; shade: string; opacity: number; y0: number; y1: number } | null;
  mountains: Mountain[];
  haze: { color: string; amount: number; horizon: number } | null;
  dof: { focus: number; amount: number };
  bloom: number;
  vignette: number;
}

export interface StoryEvent {
  id: string;
  start: number;
  end: number;
  title: string;
}

export interface Scene {
  id?: string; // project id (SQLite row key)
  name: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  env: Environment;
  objects: SceneObject[];
  lights: Light[];
  emitters: Emitter[];
  events: StoryEvent[];
  library?: { id: string; label: string; path: string }[]; // saved custom shapes (reusable)
  seq: number;
}

/* ---- vector authoring types (brush / pen / node editor) ---- */
export type Vec2 = [number, number];
export interface Anchor {
  x: number;
  y: number;
  ix: number; // incoming handle
  iy: number;
  ox: number; // outgoing handle
  oy: number;
}
export interface SubPath {
  closed: boolean;
  anchors: Anchor[];
}
export type BezierPath = SubPath[];
export type ShapeKind = "rect" | "ellipse" | "star" | "polygon" | "line";
export type Tool = "select" | "brush" | "pen" | "shape" | "text" | "light" | "hand" | "eyedropper";

/** An imported sprite/image. Pixels live in <app-data>/assets (SQLite-indexed); `src` is a loadable URL. */
export interface ImageAsset {
  id: string;
  label: string;
  tags: string;
  width: number;
  height: number;
  mime: string;
  src: string;
}
