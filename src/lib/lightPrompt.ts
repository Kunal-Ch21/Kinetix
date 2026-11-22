// Offline natural-language light director. Understands prompts such as
//   "Cast a cool cyan rim light from top-left onto the logo"
//   "Sweep a warm spotlight beam across the title"
//   "Make the rim light brighter and narrower"
// and turns them into `add_light` / `set_light` ops (origin → target, intensity, cone). It runs locally and instantly,
// so lighting prompts work even when no language model is installed; everything else still goes to the AI pipeline.
import { findLight } from "../engine/ops";
import { evalObj } from "../engine/rig";
import { findObject } from "../engine/scene";
import type { Scene, SceneObject } from "../engine/types";

type Op = Record<string, unknown> & { op: string };
export interface LightPlan {
  ops: Op[];
  summary: string;
}

const COLORS: [RegExp, string][] = [
  [/\bcyan|aqua|turquoise\b/, "#06B6D4"],
  [/\bteal\b/, "#14B8A6"],
  [/\bcool\b|\bicy\b|\bice\b/, "#7DD3FC"],
  [/\bblue\b/, "#3B82F6"],
  [/\bpurple|violet\b/, "#8B5CF6"],
  [/\bmagenta|pink\b/, "#EC4899"],
  [/\bred\b/, "#EF4444"],
  [/\borange|amber|sunset\b/, "#F59E0B"],
  [/\bgold(en)?\b/, "#FFC15E"],
  [/\bwarm|yellow\b/, "#FFB347"],
  [/\bgreen|lime\b/, "#22C55E"],
  [/\bwhite|neutral\b/, "#FFFFFF"],
];

/** Named spots on the 0–100 stage grid. */
const PLACES: [RegExp, [number, number]][] = [
  [/top[\s-]*left|upper[\s-]*left|above[\s-]*left/, [8, 6]],
  [/top[\s-]*right|upper[\s-]*right|above[\s-]*right/, [92, 6]],
  [/bottom[\s-]*left|lower[\s-]*left/, [8, 94]],
  [/bottom[\s-]*right|lower[\s-]*right/, [92, 94]],
  [/\b(from|at)\s+(the\s+)?top\b|\babove\b|\boverhead\b/, [50, 4]],
  [/\b(from|at)\s+(the\s+)?bottom\b|\bbelow\b/, [50, 96]],
  [/\b(from|at)\s+(the\s+)?left\b|\bleft side\b/, [4, 45]],
  [/\b(from|at)\s+(the\s+)?right\b|\bright side\b/, [96, 45]],
  [/\bbehind\b|\bback[\s-]?light/, [50, 12]],
];

const round = (v: number) => Math.round(v * 10) / 10;

function pickObject(scene: Scene, prompt: string, selection: string[]): SceneObject | undefined {
  const m = /\b(?:onto|on to|on|across|over|at|toward|towards|to|through|behind)\s+(?:the\s+|my\s+|this\s+)?([a-z0-9' _-]{2,40}?)(?=$|[.,;!?]|\s+(?:over|for|with|from|in|using|then|and|so|at|during)\b)/gi;
  let hit: RegExpExecArray | null;
  const phrases: string[] = [];
  while ((hit = m.exec(prompt))) phrases.push(hit[1].trim());
  for (const ph of phrases.reverse()) {
    if (/^(top|bottom|left|right|center|centre|corner|side|screen|scene|canvas|stage|2|3|4|5|\d+)/.test(ph)) continue;
    const direct = findObject(scene, ph);
    if (direct) return direct;
    // "title" / "logo" style generic words → fuzzy match against labels, aliases and tags
    const word = ph.split(/\s+/).pop() ?? ph;
    const fuzzy = scene.objects.find((o) => !o.parent && (`${o.label} ${o.aliases.join(" ")} ${o.tags.join(" ")} ${o.text?.content ?? ""}`.toLowerCase().includes(word)));
    if (fuzzy) return fuzzy;
    if (word === "title" || word === "text" || word === "headline") {
      const t = scene.objects.find((o) => o.kind === "text");
      if (t) return t;
    }
    if (word === "logo" || word === "icon" || word === "subject" || word === "character" || word === "it" || word === "object") {
      return scene.objects.find((o) => o.id === selection[0]) ?? scene.objects.find((o) => !o.parent && o.kind !== "text") ?? scene.objects[0];
    }
  }
  if (/\b(selected|this|it)\b/.test(prompt)) return scene.objects.find((o) => o.id === selection[0]);
  return undefined;
}

export function parseLightPrompt(prompt: string, scene: Scene, selection: string[], time: number): LightPlan | null {
  const p = prompt.toLowerCase().trim();
  if (!/\b(light|lights|lighting|beam|spot|spotlight|rim|backlight|glow beam|illuminate)\b/.test(p)) return null;
  // Don't hijack pure object-rim edits like "add a rim to the falcon" — those need a light only if one is mentioned.
  const sweep = /\b(sweep|swipe|pan|scan|travel|glide|slide|animate|move)\b/.test(p);
  const edit = /\b(make|change|move|re-?aim|aim|point|turn|brighten|dim|narrow|widen|increase|decrease|raise|lower|set|adjust)\b/.test(p);
  const cast = /\b(cast|add|create|place|put|shine|throw|beam|give|apply|drop)\b/.test(p) || sweep;

  const color = COLORS.find(([re]) => re.test(p))?.[1];
  const type: "point" | "spot" | "sun" = /\b(rim|directional|back[\s-]?light|edge)\b/.test(p) ? "sun" : /\b(area|point|ambient|glow)\b/.test(p) ? "point" : "spot";
  const from = PLACES.find(([re]) => re.test(p))?.[1];
  const target = pickObject(scene, p, selection);
  const dur = Number(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/.exec(p)?.[1]) || (sweep ? 3 : 0);
  const intensity = /\b(very bright|intense|strong|dramatic)\b/.test(p) ? 1.6 : /\b(bright|brighter|increase|raise)\b/.test(p) ? 1.3 : /\b(subtle|soft|dim|dimmer|faint|gentle|decrease|lower)\b/.test(p) ? 0.55 : undefined;
  const cone = /\b(narrow|tight|focused)\b/.test(p) ? 12 : /\b(wide|broad|flood)\b/.test(p) ? 42 : undefined;
  const at = Math.round(time * 100) / 100;

  // ---- modify an existing light ----
  const existing = (edit && !/\b(cast|add|create|place)\b/.test(p) ? findLight(scene, /\brim\b/.test(p) ? "rim" : /\bspot|beam\b/.test(p) ? "spot" : /\bkey\b/.test(p) ? "key" : "light") : undefined) ?? undefined;
  if (existing && !/\b(a|an)\s+(new\s+)?(\w+\s+)?(light|spotlight|beam)\b/.test(p)) {
    const op: Op = { op: "set_light", id: existing.id, at, duration: dur };
    if (color) op.color = color;
    if (from) {
      op.origin_x = from[0];
      op.origin_y = from[1];
    }
    if (target) op.aim = target.id;
    if (intensity !== undefined) op.intensity = round(existing.intensity * (intensity < 1 ? 0.6 : 1.3));
    if (cone !== undefined) op.cone = cone;
    if (Object.keys(op).length <= 4) return null;
    return { ops: [op], summary: `Re-aimed “${existing.label}”${target ? ` at ${target.label}` : ""}` };
  }
  if (!cast && !edit) return null;

  // ---- create a new light ----
  const origin = from ?? (type === "sun" ? [8, 6] : type === "point" ? [50, 20] : [50, 4]);
  const id = `lt_${Date.now().toString(36)}`;
  const label = `${type === "sun" ? "Rim Light" : type === "point" ? "Area Light" : sweep ? "Sweep Beam" : "Spot Beam"}${target ? ` → ${target.label}` : ""}`.slice(0, 40);
  const base: Op = {
    op: "add_light",
    id,
    label,
    type,
    origin_x: origin[0],
    origin_y: origin[1],
    color: color ?? (type === "sun" ? "#06B6D4" : "#FFD08A"),
    intensity: intensity ?? (type === "sun" ? 1.1 : 1.2),
    falloff: type === "point" ? 55 : 120,
    cone: cone ?? 24,
    volumetric: type !== "sun",
  };
  const ops: Op[] = [];
  const cx = target ? targetCentre(scene, target, time) : [50, 50];
  if (sweep && target && type !== "point") {
    const span = 24;
    ops.push({ ...base, target_x: round(cx[0] - span), target_y: round(cx[1]) });
    ops.push({ op: "set_light", id, at, duration: dur || 3, target_x: round(cx[0] + span), target_y: round(cx[1]) });
  } else {
    ops.push({ ...base, ...(target ? { aim: target.id, exclusive: type === "sun" } : { target_x: 50, target_y: 50 }) });
    if (sweep && !target && type !== "point") ops.push({ op: "set_light", id, at, duration: dur || 3, target_x: 85, target_y: 50 });
  }
  if (target && type === "sun") ops.push({ op: "set_rim", id: target.id, light_color: true, intensity: 1, spread: 0.9 });
  return { ops, summary: `${sweep ? "Sweeping" : "Cast"} ${label}` };
}

function targetCentre(_scene: Scene, o: SceneObject, t: number): [number, number] {
  const e = evalObj(o, t);
  return [e.x, e.y];
}
