import { applyOps } from "../engine/ops";
import { commit, getState, select, setModal, setState, toast } from "../state/store";
import { ai } from "./ai";
import { parseLightPrompt } from "./lightPrompt";
import { invokeQuiet } from "./native";

/** Shared AI Director runner (Director bar, Ctrl+K spotlight, gate modal). */

let busy = false;
const subs = new Set<() => void>();

export const isBusy = () => busy;
export function subscribeBusy(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
function setBusy(b: boolean) {
  busy = b;
  subs.forEach((f) => f());
}

export async function runDirector(): Promise<void> {
  const s = getState();
  const prompt = s.prompt.trim();
  if (!prompt || busy) return;

  // Lighting prompts ("cast a cool cyan rim light from top-left onto the logo", "sweep a warm spotlight across the
  // title") are understood locally and instantly — no language model required.
  const plan = parseLightPrompt(prompt, s.scene, s.selection, s.time);
  if (plan) {
    commit((sc) => {
      applyOps(sc, plan.ops);
    }, undefined, `Light: ${prompt.slice(0, 40)}`);
    const added = plan.ops.find((o) => o.op === "add_light");
    if (added && typeof added.id === "string") select([added.id]);
    if (getState().modal === "spotlight") setModal(null);
    toast(`${plan.summary} (light director)`);
    setState({ prompt: "" });
    return;
  }

  // Missing-model gate: nothing installed / nothing running -> modal instead of a failed call.
  const st = await ai.status();
  if (!st.native || !st.running || !st.model) {
    setModal("gate");
    return;
  }
  if (getState().modal === "spotlight") setModal(null);

  setBusy(true);
  try {
    const res = await ai.run(s.scene, s.selection, s.time, prompt);
    // Rust already did the math + ripple + duplicate lock: apply EXACTLY the ops it returned.
    let log: string[] = [];
    commit((sc) => {
      log = applyOps(sc, res.ops);
    }, undefined, `AI: ${prompt.slice(0, 40)}`);
    const bad = log.filter((l) => l.startsWith("✗")).length;
    const made = res.ops.filter((o) => typeof o.id === "string" && o.op.startsWith("create"));
    if (made.length) select([String(made[made.length - 1].id)]);
    const blocked = res.blocked.length ? ` · reused ${res.blocked.map((b) => b.reuse).join(", ")} (duplicate lock)` : "";
    toast(`${res.model} · ${res.tokens} tok · ${res.ms} ms · ${res.ops.length - bad} ops${bad ? `, ${bad} failed` : ""}${blocked}`);
    if (res.notes.length) toast(res.notes[0]);
    invokeQuiet("ai_log", { projectId: getState().scene.id ?? "default", line: `AI "${prompt.slice(0, 60)}" -> ${res.ops.length} ops` });
    setState({ prompt: "" });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, "");
    if (msg.includes("NO_MODEL")) setModal("gate");
    else if (msg.includes("Cancelled")) toast("AI request cancelled");
    else toast(msg.slice(0, 160));
  } finally {
    setBusy(false);
  }
}

export function cancelDirector() {
  void ai.cancel();
}
