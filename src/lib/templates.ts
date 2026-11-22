// Universal asset-library presets: motion graphics, vector icons and character / creature rigs.
// Every template is plain `applyOps` vocabulary (the same ops the AI emits), inserted on demand — a New Project is and
// stays completely blank.
import { FALCON_PATH } from "../engine/sample";
import { runOps, select } from "../state/store";

export type TemplateCategory = "Motion Graphics" | "Vector Icons" | "Characters";
type Op = Record<string, unknown>;

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  blurb: string;
  /** small SVG preview: viewBox -12 -12 24 24 */
  preview: string;
  build: (p: string) => Op[];
}

const arcPath = (frac: number, r = 9, n = 48) => {
  // identical point count for every fraction so progress rings morph cleanly
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2 * frac;
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts[0]} ${pts.slice(1).map((q) => `L${q}`).join(" ")}`;
};
const barPath = (h: number, w = 2.6) => `M${-w},0 L${w},0 L${w},${-h} L${-w},${-h} Z`;
const kf = (id: string, prop: string, at: number, value: number, ease = "ease_in_out"): Op => ({ op: "keyframe", id, prop, at, value, ease });

const ICON = (name: string, d: string, fill = "#3B82F6", extra: Op = {}): Template => ({
  id: `icon-${name.toLowerCase().replace(/\W+/g, "-")}`,
  name,
  category: "Vector Icons",
  blurb: `${name} icon — a real Bézier path you can recolour, node-edit and animate.`,
  preview: d,
  build: (p) => [{ op: "create_shape", id: `${p}_icon`, label: name, shape: "svg_path", svg_path: d, x: 50, y: 50, scale: 2.4, fill, force_new: true, ...extra }],
});

export const TEMPLATES: Template[] = [
  /* ------------------------------------------------ motion graphics */
  {
    id: "lower-third",
    name: "Lower Third",
    category: "Motion Graphics",
    blurb: "Name bar that slides in with a title and subtitle.",
    preview: "M-10,2 L8,2 L8,8 L-10,8 Z M-10,-4 L2,-4 L2,0 L-10,0 Z",
    build: (p) => [
      { op: "create_shape", id: `${p}_bar`, label: "Lower Third Bar", shape: "rect", w: 34, h: 9, x: 24, y: 82, fill: "#3B82F6", force_new: true },
      { op: "add_text", id: `${p}_name`, label: "LT Name", content: "Your Name", size: 3.4, weight: 800, align: "left", x: 10, y: 80.5, effect: "rise", unit: "char", stagger: 0.04, start: 0.5 },
      { op: "add_text", id: `${p}_role`, label: "LT Title", content: "Job title · Company", size: 1.7, weight: 500, align: "left", x: 10, y: 85, fill: "#DCE8FF", effect: "fade", start: 0.9 },
      kf(`${p}_bar`, "x", 0, -30, "ease_out"),
      kf(`${p}_bar`, "x", 0.7, 24),
      kf(`${p}_bar`, "opacity", 0, 0, "linear"),
      kf(`${p}_bar`, "opacity", 0.3, 1),
    ],
  },
  {
    id: "kinetic-title",
    name: "Kinetic Title",
    category: "Motion Graphics",
    blurb: "Big word-by-word pop-in title with an underline sweep.",
    preview: "M-10,-3 L-3,-3 L-3,3 L-10,3 Z M0,-3 L10,-3 L10,3 L0,3 Z",
    build: (p) => [
      { op: "add_text", id: `${p}_t`, label: "Kinetic Title", content: "BIG IDEA", size: 10, weight: 900, align: "center", x: 50, y: 46, effect: "pop", unit: "word", stagger: 0.22, duration: 0.7, start: 0.2 },
      { op: "create_shape", id: `${p}_u`, label: "Title Underline", shape: "rect", w: 46, h: 0.9, x: 50, y: 56, fill: "#F59E0B", force_new: true },
      kf(`${p}_u`, "scale", 0.7, 0, "ease_out"),
      kf(`${p}_u`, "scale", 1.4, 1),
    ],
  },
  {
    id: "progress-ring",
    name: "Progress Ring",
    category: "Motion Graphics",
    blurb: "Circular progress that fills to 78% with a counter label.",
    preview: "M0,-9 C5,-9 9,-5 9,0 C9,5 5,9 0,9",
    build: (p) => [
      { op: "create_shape", id: `${p}_track`, label: "Ring Track", shape: "svg_path", svg_path: arcPath(1), x: 50, y: 50, scale: 2.2, fill: "none", stroke: "#2A3142", stroke_width: 1.1, force_new: true },
      { op: "create_shape", id: `${p}_arc`, label: "Ring Progress", shape: "svg_path", svg_path: arcPath(0.06), x: 50, y: 50, scale: 2.2, fill: "none", stroke: "#06B6D4", stroke_width: 1.3, glow: 0.6, force_new: true },
      { op: "morph_to", id: `${p}_arc`, svg_path: arcPath(0.78), at: 0.3, duration: 1.8, ease: "ease_in_out" },
      { op: "add_text", id: `${p}_pct`, label: "Ring Label", content: "78%", size: 5, weight: 800, x: 50, y: 51, effect: "fade", start: 1.2 },
    ],
  },
  {
    id: "bar-chart",
    name: "Bar Chart",
    category: "Motion Graphics",
    blurb: "Five bars that grow in one after another.",
    preview: "M-9,8 L-9,2 L-6,2 L-6,8 Z M-3,8 L-3,-4 L0,-4 L0,8 Z M3,8 L3,-8 L6,-8 L6,8 Z",
    build: (p) => {
      const heights = [14, 24, 18, 32, 26];
      const ops: Op[] = [];
      heights.forEach((h, i) => {
        const id = `${p}_b${i}`;
        ops.push({ op: "create_shape", id, label: `Bar ${i + 1}`, shape: "svg_path", svg_path: barPath(0.4), x: 30 + i * 10, y: 78, fill: ["#3B82F6", "#06B6D4", "#8B5CF6", "#F59E0B", "#22C55E"][i], force_new: true });
        ops.push({ op: "morph_to", id, svg_path: barPath(h), at: 0.2 + i * 0.18, duration: 0.8, ease: "spring_bounce" });
      });
      ops.push({ op: "create_shape", id: `${p}_base`, label: "Chart Baseline", shape: "line", w: 46, h: 0.1, x: 50, y: 78.5, stroke: "#4B5568", force_new: true });
      return ops;
    },
  },
  {
    id: "glass-card",
    name: "Glass Card",
    category: "Motion Graphics",
    blurb: "Frosted card that scales in with a rim highlight and text.",
    preview: "M-9,-6 L9,-6 L9,6 L-9,6 Z",
    build: (p) => [
      { op: "create_shape", id: `${p}_card`, label: "Glass Card", shape: "rect", w: 30, h: 18, x: 50, y: 50, fill: "rgba(255,255,255,0.13)", stroke: "rgba(255,255,255,0.35)", stroke_width: 0.25, force_new: true, rim: { color: "#7DD3FC", intensity: 0.8, spread: 0.6, light_color: false }, shadow: { opacity: 0.35, blur: 4, dx: 1, dy: 2 } },
      { op: "add_text", id: `${p}_h`, label: "Card Title", content: "Glass Card", size: 3, weight: 700, x: 50, y: 46, effect: "rise", start: 0.5 },
      { op: "add_text", id: `${p}_b`, label: "Card Body", content: "Frosted panel for UI call-outs", size: 1.5, weight: 500, x: 50, y: 52, fill: "#C9D3E6", effect: "fade", start: 0.9 },
      kf(`${p}_card`, "scale", 0, 0.8, "ease_out"),
      kf(`${p}_card`, "scale", 0.6, 1),
      kf(`${p}_card`, "opacity", 0, 0, "linear"),
      kf(`${p}_card`, "opacity", 0.4, 1),
    ],
  },
  {
    id: "cta-button",
    name: "Call-to-Action Button",
    category: "Motion Graphics",
    blurb: "Pill button with a bouncy press-in and label.",
    preview: "M-8,-4 L8,-4 L8,4 L-8,4 Z",
    build: (p) => [
      { op: "create_shape", id: `${p}_btn`, label: "CTA Button", shape: "rect", w: 22, h: 7, x: 50, y: 50, fill: "#EF4444", force_new: true, glow: 0.25 },
      { op: "add_text", id: `${p}_lbl`, label: "CTA Label", content: "Subscribe", size: 2.8, weight: 800, x: 50, y: 51.2, effect: "pop", unit: "word", start: 0.5 },
      kf(`${p}_btn`, "scale", 0, 0, "spring_bounce"),
      kf(`${p}_btn`, "scale", 0.8, 1),
    ],
  },

  /* ------------------------------------------------ vector icons & shapes */
  ICON("Play", "M-5,-7 L7,0 L-5,7 Z", "#22C55E"),
  ICON("Pause", "M-6,-7 L-2,-7 L-2,7 L-6,7 Z M2,-7 L6,-7 L6,7 L2,7 Z", "#F59E0B"),
  ICON("Check", "M-8,0 L-5,-3 L-2,0 L6,-8 L9,-5 L-2,6 Z", "#22C55E"),
  ICON("Arrow", "M-8,-2 L2,-2 L2,-6 L9,0 L2,6 L2,2 L-8,2 Z", "#3B82F6"),
  ICON("Heart", "M0,7 C-9,0 -9,-7 -4.5,-7 C-2,-7 0,-5 0,-3 C0,-5 2,-7 4.5,-7 C9,-7 9,0 0,7 Z", "#EC4899"),
  ICON("Speech Bubble", "M-8,-6 L8,-6 L8,3 L1,3 L-3,8 L-3,3 L-8,3 Z", "#06B6D4"),
  ICON("Location Pin", "M0,9 C-6,2 -7,-1 -7,-3 C-7,-8 7,-8 7,-3 C7,-1 6,2 0,9 Z", "#EF4444"),
  ICON("Bolt", "M2,-9 L-6,2 L-1,2 L-3,9 L6,-3 L1,-3 Z", "#FACC15"),
  ICON("Plus", "M-2,-8 L2,-8 L2,-2 L8,-2 L8,2 L2,2 L2,8 L-2,8 L-2,2 L-8,2 L-8,-2 L-2,-2 Z", "#8B5CF6"),
  {
    id: "icon-star-burst",
    name: "Star Burst",
    category: "Vector Icons",
    blurb: "Five-point star shape.",
    preview: "M0,-9 L2.6,-3 L9,-2.8 L4,1.4 L5.6,8 L0,4.4 L-5.6,8 L-4,1.4 L-9,-2.8 L-2.6,-3 Z",
    build: (p) => [{ op: "create_shape", id: `${p}_star`, label: "Star", shape: "star", points: 5, outer: 9, inner: 4, x: 50, y: 50, scale: 2, fill: "#F59E0B", force_new: true }],
  },
  {
    id: "icon-ring",
    name: "Ring",
    category: "Vector Icons",
    blurb: "Outline circle — great for pulses and ripples.",
    preview: "M0,-9 C5,-9 9,-5 9,0 C9,5 5,9 0,9 C-5,9 -9,5 -9,0 C-9,-5 -5,-9 0,-9 Z",
    build: (p) => [{ op: "create_shape", id: `${p}_ring`, label: "Ring", shape: "circle", r: 9, x: 50, y: 50, scale: 2, fill: "none", stroke: "#06B6D4", stroke_width: 0.8, force_new: true }],
  },
  {
    id: "icon-hexagon",
    name: "Hexagon",
    category: "Vector Icons",
    blurb: "Six-sided badge shape.",
    preview: "M9,0 L4.5,7.8 L-4.5,7.8 L-9,0 L-4.5,-7.8 L4.5,-7.8 Z",
    build: (p) => [{ op: "create_shape", id: `${p}_hex`, label: "Hexagon", shape: "polygon", sides: 6, r: 9, x: 50, y: 50, scale: 2, fill: "#8B5CF6", force_new: true }],
  },

  /* ------------------------------------------------ characters / creature rigs */
  {
    id: "blob-buddy",
    name: "Blob Buddy",
    category: "Characters",
    blurb: "Squishy character rig: body + eyes + cheeks, idle bounce.",
    preview: "M0,-8 C7,-8 9,-2 9,3 C9,8 4,9 0,9 C-4,9 -9,8 -9,3 C-9,-2 -7,-8 0,-8 Z",
    build: (p) => [
      { op: "create_assembly", id: `${p}_body`, label: "Blob Body", shape: "circle", r: 7, x: 50, y: 55, fill: "#8B5CF6", force_new: true, parts: [
        { label: "Blob Eye L", shape: "circle", r: 1.5, dx: -2.6, dy: -1.5, fill: "#FFFFFF" },
        { label: "Blob Eye R", shape: "circle", r: 1.5, dx: 2.6, dy: -1.5, fill: "#FFFFFF" },
        { label: "Blob Pupil L", shape: "circle", r: 0.7, dx: -2.3, dy: -1.4, fill: "#1B1030" },
        { label: "Blob Pupil R", shape: "circle", r: 0.7, dx: 2.9, dy: -1.4, fill: "#1B1030" },
        { label: "Blob Cheek", shape: "ellipse", w: 2.4, h: 1.2, dx: 0, dy: 2.6, fill: "#F9A8D4" },
      ] },
      { op: "animate", id: `${p}_body`, preset: "spring_bounce" },
    ],
  },
  {
    id: "robot-pal",
    name: "Robot Pal",
    category: "Characters",
    blurb: "Boxy robot with head, antenna and eyes, ready to rig.",
    preview: "M-6,-2 L6,-2 L6,8 L-6,8 Z M-4,-8 L4,-8 L4,-3 L-4,-3 Z",
    build: (p) => [
      { op: "create_assembly", id: `${p}_body`, label: "Robot Body", shape: "rect", w: 11, h: 11, x: 50, y: 58, fill: "#64748B", force_new: true, parts: [
        { label: "Robot Head", shape: "rect", w: 9, h: 7, dx: 0, dy: -9, fill: "#94A3B8" },
        { label: "Robot Eye L", shape: "circle", r: 1, dx: -2, dy: -9.2, fill: "#22D3EE" },
        { label: "Robot Eye R", shape: "circle", r: 1, dx: 2, dy: -9.2, fill: "#22D3EE" },
        { label: "Robot Antenna", shape: "circle", r: 0.8, dx: 0, dy: -14, fill: "#F59E0B" },
        { label: "Robot Arm L", shape: "rect", w: 2.2, h: 8, dx: -7.5, dy: 0, fill: "#475569" },
        { label: "Robot Arm R", shape: "rect", w: 2.2, h: 8, dx: 7.5, dy: 0, fill: "#475569" },
      ] },
      { op: "animate", id: `${p}_body`, preset: "pulse" },
    ],
  },
  {
    id: "stick-figure",
    name: "Stick Figure",
    category: "Characters",
    blurb: "Jointed figure (head, torso, limbs) with a walk cycle.",
    preview: "M0,-8 C1.5,-8 2,-6.5 2,-5.5 C2,-4 1,-3 0,-3 C-1,-3 -2,-4 -2,-5.5 C-2,-6.5 -1.5,-8 0,-8 Z M-0.4,-3 L0.4,-3 L0.4,4 L-0.4,4 Z",
    build: (p) => [
      { op: "create_assembly", id: `${p}_torso`, label: "Figure Torso", shape: "rect", w: 1.2, h: 8, x: 50, y: 52, fill: "#E5E7EB", force_new: true, parts: [
        { label: "Figure Head", shape: "circle", r: 2.2, dx: 0, dy: -6, fill: "#E5E7EB" },
        { label: "Figure Arm L", shape: "rect", w: 0.9, h: 6, dx: -2, dy: -1, rotation: 20, fill: "#CBD5E1" },
        { label: "Figure Arm R", shape: "rect", w: 0.9, h: 6, dx: 2, dy: -1, rotation: -20, fill: "#CBD5E1" },
        { label: "Figure Leg L", shape: "rect", w: 1, h: 7, dx: -1.2, dy: 7, rotation: 8, fill: "#CBD5E1" },
        { label: "Figure Leg R", shape: "rect", w: 1, h: 7, dx: 1.2, dy: 7, rotation: -8, fill: "#CBD5E1" },
      ] },
      { op: "animate", id: `${p}_torso`, preset: "walk_cycle" },
    ],
  },
  {
    id: "soaring-bird",
    name: "Soaring Bird",
    category: "Characters",
    blurb: "Winged creature silhouette with a gentle glide.",
    preview: FALCON_PATH,
    build: (p) => [
      { op: "create_shape", id: `${p}_bird`, label: "Soaring Bird", shape: "svg_path", svg_path: FALCON_PATH, x: 20, y: 40, scale: 0.7, fill: "#334155", force_new: true, rim: { color: "#06B6D4", intensity: 0.9, spread: 0.5, light_color: false } },
      kf(`${p}_bird`, "x", 0, 15),
      kf(`${p}_bird`, "x", 5, 82),
      kf(`${p}_bird`, "y", 0, 46),
      kf(`${p}_bird`, "y", 2.5, 38),
      kf(`${p}_bird`, "y", 5, 44),
    ],
  },
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["Motion Graphics", "Vector Icons", "Characters"];

/** Drops a template into the current scene (unique ids per insertion) and selects its first object. */
export function insertTemplate(t: Template) {
  const prefix = `tpl${Date.now().toString(36)}`;
  const ops = t.build(prefix);
  runOps(ops, t.name);
  const first = ops.find((o) => typeof o.id === "string" && String(o.op).startsWith("create")) ?? ops.find((o) => typeof o.id === "string");
  if (first) select([String(first.id)]);
}
