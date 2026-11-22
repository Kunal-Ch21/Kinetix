import type { Project, SceneNode } from "../engine/types";

export interface CastEntry {
  short: string;
  node: SceneNode;
}

/** Short stable ids for the AI cast roster: asset_01, img_01, light_01 ... (top-level, non-environment objects). */
export function topLevelCast(p: Project): CastEntry[] {
  const counters: Record<string, number> = {};
  const out: CastEntry[] = [];
  for (const n of p.nodes) {
    if (n.parent) continue;
    if (n.kind === "clouds") continue;
    if (n.tags === "environment") continue;
    const prefix = n.kind === "image" ? "img" : n.kind === "light" ? "light" : n.kind === "text" ? "txt" : n.kind === "particles" ? "fx" : "asset";
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    out.push({ short: `${prefix}_${String(counters[prefix]).padStart(2, "0")}`, node: n });
  }
  return out.slice(0, 14);
}
