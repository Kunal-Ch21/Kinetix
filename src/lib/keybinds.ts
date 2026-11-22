// Customisable keyboard shortcut manager: 50+ studio actions, persistent overrides, conflict detection.
// Bindings persist to localStorage (inside the desktop app that is the WebView's app-data storage, so they survive
// restarts) and are read synchronously at startup so shortcuts work from the very first frame.
import { useSyncExternalStore } from "react";

export type Category = "Playback & Timeline" | "Tools" | "Canvas & View" | "Edit & Hierarchy" | "AI & App";
export const CATEGORIES: Category[] = ["Playback & Timeline", "Tools", "Canvas & View", "Edit & Hierarchy", "AI & App"];

export interface ActionDef {
  id: string;
  label: string;
  category: Category;
  combo: string; // default binding ("" = unbound)
  /** Fixed secondary bindings that are not user-editable (e.g. Ctrl+Shift+Z for redo). */
  alt?: string[];
  /** Plain-English one-liner shown under the name in Settings. */
  hint?: string;
}

const A = (id: string, label: string, category: Category, combo: string, hint?: string, alt?: string[]): ActionDef => ({ id, label, category, combo, hint, alt });
const P = "Playback & Timeline";
const T = "Tools";
const V = "Canvas & View";
const E = "Edit & Hierarchy";
const S = "AI & App";

export const ACTIONS: ActionDef[] = [
  A("play_pause", "Play / Pause", P, "Space", "Start or stop the animation preview."),
  A("step_fwd", "Step forward 1 frame", P, "Right", "Nudge the playhead one frame later."),
  A("step_back", "Step back 1 frame", P, "Left", "Nudge the playhead one frame earlier."),
  A("step_fwd_10", "Step forward 10 frames", P, "Shift+Right"),
  A("step_back_10", "Step back 10 frames", P, "Shift+Left"),
  A("jump_start", "Jump to start", P, "Home"),
  A("jump_end", "Jump to end", P, "End"),
  A("add_keyframe", "Add keyframe", P, "I", "Record the selected object's position, rotation, size and opacity at the playhead."),
  A("delete_keyframe", "Delete keyframe", P, "Delete", "Removes the selected keyframe (or the selected object if no keyframe is selected)."),
  A("next_keyframe", "Next keyframe", P, "K", "Jump the playhead to the next keyframe."),
  A("prev_keyframe", "Previous keyframe", P, "J", "Jump the playhead to the previous keyframe."),
  A("copy_keyframe", "Copy keyframe", P, "Ctrl+C"),
  A("paste_keyframe", "Paste keyframe", P, "Ctrl+V"),
  A("loop_toggle", "Loop on / off", P, "L", "Repeat the animation when it reaches the end."),
  A("onion_toggle", "Onion skin on / off", P, "O", "Show a faint ghost of the previous moment so you can judge motion."),

  A("tool_select", "Select / Move", T, "V", "Click and drag objects."),
  A("tool_brush", "Freehand brush", T, "B", "Draw smooth curves by hand."),
  A("tool_pen", "Bézier pen", T, "P", "Click to place points, drag to bend curves."),
  A("tool_shape", "Custom shape", T, "U", "Drag out a rectangle, ellipse, star, polygon or line."),
  A("tool_text", "Text", T, "T", "Click the canvas to add animated text."),
  A("import_image", "Import image", T, "Ctrl+I", "Bring in a PNG, JPG, WebP or SVG."),
  A("tool_light", "Add light", T, "Alt+L", "Place an invisible studio light (spot beam, directional rim or area light)."),
  A("tool_eyedropper", "Eyedropper", T, "E", "Click anywhere on the canvas to pick up a colour."),
  A("tool_hand", "Hand (pan)", T, "H", "Drag to move the view around."),
  A("edit_nodes", "Edit path nodes", T, "Enter", "Show the curve points of the selected shape (or finish a pen path)."),

  A("toggle_zen", "Toggle Studio / Zen mode", V, "Tab", "Hide every panel so the canvas fills the window."),
  A("toggle_grid", "Show / hide grid", V, "G"),
  A("toggle_snap", "Snapping on / off", V, "Shift+S", "Make moves land on whole grid numbers."),
  A("zoom_in", "Zoom in", V, "Ctrl+="),
  A("zoom_out", "Zoom out", V, "Ctrl+-"),
  A("zoom_fit", "Zoom to fit", V, "Shift+1", "Fit the whole canvas in the window.", ["F"]),
  A("zoom_reset", "Reset zoom to 100%", V, "Ctrl+0"),

  A("undo", "Undo", E, "Ctrl+Z", "Step back one edit."),
  A("redo", "Redo", E, "Ctrl+Y", "Re-apply the edit you just undid.", ["Ctrl+Shift+Z"]),
  A("duplicate", "Duplicate", E, "Ctrl+D"),
  A("clone_variant", "Clone as variant", E, "Ctrl+Shift+D", "Duplicate with a different colour — handy for A/B looks."),
  A("group", "Group / Parent", E, "Ctrl+G", "Select 2+ objects: the first one becomes the parent, the rest follow it."),
  A("ungroup", "Unparent", E, "Ctrl+Shift+G", "Detach the selected object from its parent."),
  A("bring_forward", "Bring forward", E, "Ctrl+]"),
  A("send_backward", "Send backward", E, "Ctrl+["),
  A("delete_object", "Delete object", E, "Backspace"),
  A("select_all", "Select all", E, "Ctrl+A"),

  A("focus_ai", "Focus AI Director", S, "Ctrl+K", "Jump to the AI command bar."),
  A("inspect_mode", "Dynamic Island Inspect Mode", S, "Shift+?", "Hover or click anything to get a plain-English explanation."),
  A("open_help", "Open Help & Glossary", S, "F1"),
  A("open_settings", "Open Settings", S, "Ctrl+,"),
  A("new_project", "New project", S, "Ctrl+N", "Start with a completely blank canvas."),
  A("open_project", "Open project…", S, "Ctrl+O"),
  A("save", "Save", S, "Ctrl+S"),
  A("export", "Export…", S, "Ctrl+E"),
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/* ---------------------------------------------------------------- combo helpers */

const KEY_ALIAS: Record<string, string> = {
  " ": "Space",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Esc: "Escape",
  Del: "Delete",
};
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS"]);
export const isModifierKey = (e: KeyboardEvent) => MODIFIER_KEYS.has(e.key);

/** Canonical combo for a keyboard event, e.g. "Ctrl+Shift+D". */
export function eventCombo(e: KeyboardEvent): string {
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else key = KEY_ALIAS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
/** Pretty label for UI (tooltips, menus, settings). */
export function formatCombo(combo: string): string {
  if (!combo) return "Unbound";
  return combo
    .split("+")
    .map((p) => (p === "Ctrl" && isMac ? "⌘" : p))
    .join("+")
    .replace("++", "+Plus");
}

/* ---------------------------------------------------------------- persistent store */

const LS_KEY = "kinetix.keybinds.v1";
let overrides: Record<string, string> = {};
try {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  if (raw) overrides = JSON.parse(raw) as Record<string, string>;
} catch {
  overrides = {};
}

let version = 0;
let comboToAction = new Map<string, string>();
const subs = new Set<() => void>();

export const comboOf = (id: string): string => (id in overrides ? overrides[id] : (ACTION_BY_ID.get(id)?.combo ?? ""));

function rebuild() {
  comboToAction = new Map();
  for (const a of ACTIONS) {
    const c = comboOf(a.id);
    if (c) comboToAction.set(c, a.id);
  }
  for (const a of ACTIONS) for (const alt of a.alt ?? []) if (!comboToAction.has(alt)) comboToAction.set(alt, a.id);
  version += 1;
  subs.forEach((f) => f());
}
function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(overrides));
  } catch {
    /* storage unavailable */
  }
}
rebuild();

/** Which action (if any) a keyboard event triggers. */
export const matchAction = (e: KeyboardEvent): string | null => comboToAction.get(eventCombo(e)) ?? null;
export const isCustomised = (id: string) => id in overrides && overrides[id] !== (ACTION_BY_ID.get(id)?.combo ?? "");
export const hasAnyCustom = () => ACTIONS.some((a) => isCustomised(a.id));

/** Another action already using `combo` (excluding `exceptId`). */
export function findConflict(combo: string, exceptId: string): ActionDef | null {
  if (!combo) return null;
  const id = comboToAction.get(combo);
  return id && id !== exceptId ? (ACTION_BY_ID.get(id) ?? null) : null;
}

export function setBinding(id: string, combo: string) {
  const def = ACTION_BY_ID.get(id);
  if (!def) return;
  if (combo === def.combo) delete overrides[id];
  else overrides[id] = combo;
  persist();
  rebuild();
}
/** Give `combo` to `id`; the previous owner either gets `id`'s old binding (swap) or becomes unbound (override). */
export function assignBinding(id: string, combo: string, mode: "swap" | "override") {
  const other = findConflict(combo, id);
  const mine = comboOf(id);
  if (other) {
    if (mode === "swap") overrides[other.id] = mine;
    else overrides[other.id] = "";
    if (overrides[other.id] === other.combo) delete overrides[other.id];
  }
  setBinding(id, combo);
}
export function resetBinding(id: string) {
  delete overrides[id];
  persist();
  rebuild();
}
export function resetAllBindings() {
  overrides = {};
  persist();
  rebuild();
}

/* ---------------------------------------------------------------- React hooks */

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
/** Re-renders the caller whenever any binding changes (so tooltips always show the active key). */
export function useKeybinds(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}
/** Label of the active binding for an action, e.g. "Ctrl+Z" ("" when unbound). */
export const keyLabel = (id: string): string => {
  const c = comboOf(id);
  return c ? formatCombo(c) : "";
};
/** "Undo (Ctrl+Z)" — tooltip text that always reflects the user's current binding. */
export const tip = (label: string, id: string): string => {
  const k = keyLabel(id);
  return k ? `${label} (${k})` : label;
};
