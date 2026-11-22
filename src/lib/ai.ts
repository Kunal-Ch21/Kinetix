import { open } from "@tauri-apps/plugin-dialog";
import type { Scene } from "../engine/types";
import { buildMicroContext, type MicroContext } from "./microcontext";
import { invoke, isTauri } from "./native";

/**
 * Milestone 2 bridge to the Rust AI pipeline (Ollama / llama.cpp client, Pre-LLM gatekeeper,
 * ripple engine, idle compactor). Inside the Tauri shell every call goes to Rust; in a plain
 * browser the status reports `native: false` and the inspector falls back to the TS preview.
 */

export interface AiStatus {
  native: boolean;
  running: boolean;
  backend: "ollama" | "llamacpp" | "none";
  models: string[];
  model: string | null;
}

export interface PullInfo {
  name: string;
  status: string;
  completed: number;
  total: number;
  active: boolean;
  done: boolean;
  error: string | null;
}

/** One op of the single vocabulary — exactly what `applyOps` (engine/ops.ts) consumes. */
export type AiOp = Record<string, unknown> & { op: string };

export interface AiResult {
  ops: AiOp[];
  blocked: { label: string; reuse: string; id: string; reason?: string }[];
  notes: string[];
  raw: unknown;
  tokens: number;
  ms: number;
  model: string;
}

export type LiveContext = MicroContext & { summary?: string | null };

const OFFLINE: AiStatus = { native: false, running: false, backend: "none", models: [], model: null };

/* ---------- project sync (the gatekeeper reads the normalised SQLite tables) ---------- */

let synced: Scene | null = null;
/** Make sure the SQLite tables the gatekeeper reads match the scene that is on screen. */
export async function sync(p: Scene) {
  if (synced === p) return;
  await invoke("save_project", { id: p.id ?? "default", name: p.name, json: JSON.stringify(p) });
  synced = p;
}

const versions = new WeakMap<Scene, number>();
let versionCounter = 0;
const versionOf = (p: Scene) => {
  let v = versions.get(p);
  if (v === undefined) {
    versionCounter += 1;
    v = versionCounter;
    versions.set(p, v);
  }
  return v;
};

let pvKey = "";
let pvPromise: Promise<LiveContext> | null = null;

export const ai = {
  /** Installed models + whether Ollama / llama.cpp is reachable. */
  async status(): Promise<AiStatus> {
    if (!isTauri()) return OFFLINE;
    try {
      return await invoke<AiStatus>("ai_status");
    } catch {
      return { ...OFFLINE, native: true };
    }
  },

  setModel(name: string) {
    return invoke<void>("ai_set_model", { name });
  },

  /** Live Micro-Context Token Inspector: the exact payload the Rust gatekeeper would send. */
  preview(p: Scene, selection: string[], time: number, prompt: string): Promise<LiveContext> {
    if (!isTauri()) return Promise.resolve(buildMicroContext(p, selection, time, prompt));
    const key = `${versionOf(p)}|${selection.join(",")}|${time}|${prompt}`;
    if (key === pvKey && pvPromise) return pvPromise;
    pvKey = key;
    const pr = (async () => {
      await sync(p);
      return invoke<LiveContext>("ai_preview", { projectId: p.id ?? "default", selection, time, prompt });
    })();
    pvPromise = pr;
    pr.catch(() => {
      if (pvKey === key) {
        pvKey = "";
        pvPromise = null;
      }
    });
    return pr;
  },

  /** Stateless single-turn run: prompt -> constrained JSON -> deterministic ops. */
  async run(p: Scene, selection: string[], time: number, prompt: string): Promise<AiResult> {
    await sync(p);
    return invoke<AiResult>("ai_run", { projectId: p.id ?? "default", selection, time, prompt });
  },

  cancel() {
    return invoke<void>("ai_cancel").catch(() => undefined);
  },

  pull(name: string) {
    return invoke<void>("ai_pull", { name });
  },
  pullProgress() {
    return invoke<PullInfo>("ai_pull_progress");
  },
  pullCancel() {
    return invoke<void>("ai_pull_cancel").catch(() => undefined);
  },

  /** Native file picker (tauri-plugin-dialog) filtered to .gguf files. */
  async pickGguf(): Promise<string | null> {
    const r = await open({ multiple: false, directory: false, filters: [{ name: "GGUF model", extensions: ["gguf"] }] });
    return typeof r === "string" ? r : null;
  },

  registerGguf(path: string, name: string, template: string) {
    return invoke<string>("ai_register_gguf", { path, name, template });
  },
};

/* ---------- user-activity heartbeat: resets the 20 s idle clock + pre-empts background compaction ---------- */

if (typeof window !== "undefined") {
  let last = 0;
  const beat = () => {
    const n = performance.now();
    if (n - last < 1000) return;
    last = n;
    if (isTauri()) invoke("ai_touch").catch(() => undefined);
  };
  (["keydown", "pointerdown", "wheel"] as const).forEach((ev) =>
    window.addEventListener(ev, beat, { passive: true, capture: true }),
  );
}
