import { evalObj } from "../engine/rig";
import type { Scene, SceneObject } from "../engine/types";

/**
 * Browser-side mirror of the Rust gatekeeper (src-tauri/src/ai/gatekeeper.rs) — used for the Token Inspector
 * when the app runs outside Tauri. Inside Tauri the authoritative payload comes from `ai_preview`.
 */
export interface MicroSection {
  key: string;
  label: string;
  text: string;
}
export interface MicroContext {
  sections: MicroSection[];
  tokens: number;
  budget: number;
}

export const SYSTEM_RULES =
  'RULES: JSON only, follow schema. Grid 0-100, (0,0)=top-left. Reuse CAST ids, never duplicate. Never compute math: give relative values {modifier:"add|multiply|set",value,speed_multiplier}.';

const est = (s: string) => Math.ceil(s.length / 3.6);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
const fmt = (v: number) => String(Math.round(v * 10) / 10);

function matches(o: SceneObject, ws: string[]) {
  const hay = `${o.label} ${o.aliases.join(" ")} ${o.tags.join(" ")}`.toLowerCase();
  return ws.some((w) => hay.includes(w));
}

export function buildMicroContext(scene: Scene, selection: string[], time: number, prompt: string): MicroContext {
  const roots = scene.objects.filter((o) => !o.parent).slice(0, 14);
  const prefix = (o: SceneObject) => (o.kind === "image" ? "img" : o.kind === "text" ? "txt" : "asset");
  const counters: Record<string, number> = {};
  const short = new Map<string, string>();
  for (const o of roots) {
    const p = prefix(o);
    counters[p] = (counters[p] ?? 0) + 1;
    short.set(o.id, `${p}_${String(counters[p]).padStart(2, "0")}`);
  }
  const ws = words(prompt);
  const castLine = roots.length ? `CAST: ${roots.map((o) => `[${short.get(o.id)}: "${o.label}"]`).join(" ")}` : "CAST: (empty scene)";
  const picked = new Set(selection);
  for (const o of roots) if (matches(o, ws)) picked.add(o.id);

  const sel: string[] = [];
  const kf: string[] = [];
  for (const o of scene.objects) {
    if (!picked.has(o.id)) continue;
    const e = evalObj(o, time);
    const parts = [`${selection.includes(o.id) ? "SEL" : "REF"}: ${short.get(o.id) ?? o.label}`, `pos:${fmt(e.x)},${fmt(e.y)}`];
    if (Math.abs(e.rotation) > 0.01) parts.push(`rot:${fmt(e.rotation)}`);
    if (Math.abs(e.scale - 1) > 0.001) parts.push(`sc:${Math.round(e.scale * 100) / 100}`);
    if (o.rim) parts.push(`rim:${o.rim.color}`);
    sel.push(parts.join(" | "));
    for (const tr of o.tracks) {
      const k = tr.keys.find((x) => Math.abs(x.t - time) < 1 / 120);
      if (k && kf.length < 8) kf.push(`KF: ${short.get(o.id) ?? o.label}.${tr.prop} | t:${fmt(k.t)} | v:${fmt(k.v)}`);
    }
  }
  const ev = scene.events
    .filter((e) => (time >= e.start && time <= e.end) || words(e.title).some((w) => ws.includes(w)))
    .map((e) => `${e.id} | ${e.start.toFixed(1)}s–${e.end.toFixed(1)}s | ${e.title}`);
  const user = prompt.trim().slice(0, 500);
  const sections: MicroSection[] = [
    { key: "sys", label: "SYSTEM RULES", text: SYSTEM_RULES },
    { key: "cast", label: "CAST ROSTER", text: castLine },
    { key: "sel", label: "SPATIAL SLICE", text: sel.length ? sel.join("\n") : "SEL: none" },
    { key: "ev", label: "STORY EVENTS", text: ev.length ? ev.join("\n") : "EV: none in range" },
    { key: "kf", label: `TEMPORAL SLICE @ ${time.toFixed(1)}s`, text: kf.length ? kf.join("\n") : "KF: none at playhead" },
    { key: "user", label: "USER PROMPT", text: user || "(empty)" },
  ];
  return { sections, tokens: sections.reduce((n, s) => n + est(s.text), 0), budget: 1024 };
}
