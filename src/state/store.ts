// Single source of UI + document state, built on the Milestone-3 Scene model.
// Persistence: SQLite through Rust (latest_project / save_project / undo_push / undo_pop / redo_pop / list_assets /
// save_asset / ai_log). localStorage is only the browser-preview fallback.
import { useSyncExternalStore } from "react";
import { upsertKey } from "../engine/anim";
import { forgetImages, registerImage } from "../engine/images";
import { applyOps, cloneObject } from "../engine/ops";
import { subsToD, parseCached } from "../engine/path";
import { evalObj, evalProp } from "../engine/rig";
import { buildApexMorph } from "../engine/sample";
import { descendantsOf, emptyScene, makeObject, newId } from "../engine/scene";
import { rectPath } from "../engine/shapes";
import type { Scene, SceneObject, ImageAsset, ShapeKind, Tool } from "../engine/types";
import { LS, fileUrl, invoke, invokeQuiet, isTauri } from "../lib/native";
import type { Ease } from "../engine/math";

export type Modal = null | "gate" | "models" | "docs" | "export" | "spotlight" | "settings";
export type SettingsTab = "keybinds" | "general";
export interface KeyRef {
  owner: string;
  prop: string;
  t: number;
}
export interface KeyClip {
  prop: string;
  v: number;
  ease?: Ease;
}

export interface State {
  scene: Scene;
  selection: string[];
  selKey: KeyRef | null;
  time: number;
  playing: boolean;
  loop: boolean;
  mode: "studio" | "zen";
  tool: Tool;
  shapeKind: ShapeKind;
  editNodes: boolean;
  brush: { smoothing: number; width: number; taper: number; color: string };
  onion: boolean;
  snap: boolean;
  showGrid: boolean;
  modal: Modal;
  toast: { msg: string; id: number } | null;
  inspectMode: boolean;
  islandOpen: boolean;
  prompt: string;
  fitTick: number;
  assets: ImageAsset[];
  clipboard: KeyClip | null;
  ready: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
  settingsTab: SettingsTab;
  helpTab: "start" | "glossary" | "guide" | "recipes" | "fix";
  helpQuery: string;
}

let state: State = {
  scene: emptyScene(),
  selection: [],
  selKey: null,
  time: 0,
  playing: false,
  loop: true,
  mode: "studio",
  tool: "select",
  shapeKind: "star",
  editNodes: false,
  brush: { smoothing: 0.5, width: 0.8, taper: 0.5, color: "#F4F6FB" },
  onion: false,
  snap: true,
  showGrid: true,
  modal: null,
  toast: null,
  inspectMode: false,
  islandOpen: false,
  prompt: "",
  fitTick: 0,
  assets: [],
  clipboard: null,
  ready: false,
  canUndo: false,
  canRedo: false,
  saved: true,
  settingsTab: "keybinds",
  helpTab: "start",
  helpQuery: "",
};
const subs = new Set<() => void>();

export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  subs.forEach((f) => f());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => sel(state),
    () => sel(state),
  );
}

/**
 * Playhead used by the 60 FPS loop. It is a plain mutable object: the render loop NEVER triggers a React render.
 *  - `onLive` listeners (timecode, scrub slider, dope-sheet playhead) are called at ~15 FPS and write straight to the DOM;
 *  - `state.time` only mirrors the playhead at ~4 FPS while playing (inspector values) and exactly when paused / scrubbing.
 */
export const live = { t: 0 };
const liveSubs = new Set<(t: number) => void>();
export function onLive(fn: (t: number) => void) {
  liveSubs.add(fn);
  return () => {
    liveSubs.delete(fn);
  };
}
export const emitLive = (t: number) => liveSubs.forEach((f) => f(t));

const uid = () => `p_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
export const pid = () => state.scene.id ?? "default";

/* ---------------------------------------------------------------- toast / ui */

let toastN = 0;
export function toast(msg: string) {
  toastN += 1;
  setState({ toast: { msg, id: toastN } });
}
export const setTool = (tool: Tool) => setState((s) => ({ tool, editNodes: tool === "pen" ? s.editNodes : false }));
export const setModal = (modal: Modal) => setState({ modal });
export const select = (ids: string[]) => setState({ selection: ids, selKey: null, editNodes: false });
export function toggleMode() {
  setState((s) => ({ mode: s.mode === "studio" ? "zen" : "studio", fitTick: s.fitTick + 1, inspectMode: false, islandOpen: false, modal: null }));
}
export function setTime(t: number) {
  const D = state.scene.duration;
  live.t = Math.max(0, Math.min(D, t));
  setState({ time: live.t });
  emitLive(live.t);
}
export function togglePlay() {
  const s = state;
  if (!s.playing && live.t >= s.scene.duration - 0.01) setTime(0);
  // sync the mirrored store time on pause so nothing snaps back
  setState({ playing: !s.playing, time: live.t });
  emitLive(live.t);
}

/* ---------------------------------------------------------------- persistence */

let saveTimer: number | undefined;
export function saveNow() {
  const sc = state.scene;
  const json = JSON.stringify(sc);
  if (isTauri()) {
    invoke("save_project", { id: sc.id ?? "default", name: sc.name, json }).catch((e) => console.warn("save_project", e));
  } else {
    try {
      localStorage.setItem(LS.scene, json);
    } catch {
      /* quota */
    }
  }
  setState({ saved: true });
}
function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 600);
}

const localUndo: string[] = [];
const localRedo: string[] = [];
let last = { key: "", t: 0 };
// Real history depth (works for both the SQLite stack and the browser fallback). The Undo / Redo buttons, menus and
// shortcuts are DISABLED whenever the matching depth is 0 — there is never a dead "nothing to undo" click.
let undoDepth = 0;
let redoDepth = 0;
const HISTORY_MAX = 150;
let historyBusy = false;
const syncHistory = () => setState({ canUndo: undoDepth > 0, canRedo: redoDepth > 0 });
const resetHistory = () => {
  undoDepth = 0;
  redoDepth = 0;
  localUndo.length = 0;
  localRedo.length = 0;
};

function history(prev: Scene, label: string) {
  const snap = JSON.stringify(prev);
  if (isTauri()) {
    invokeQuiet("undo_push", { projectId: prev.id ?? "default", label, snapshot: snap });
  } else {
    localUndo.push(snap);
    if (localUndo.length > HISTORY_MAX) localUndo.shift();
    localRedo.length = 0;
  }
  invokeQuiet("ai_log", { projectId: prev.id ?? "default", line: label });
  undoDepth = Math.min(undoDepth + 1, HISTORY_MAX);
  redoDepth = 0;
  syncHistory();
}

/** Every manual edit goes through here: snapshot-before (SQLite undo_stack) then mutate a clone. */
export function commit(fn: (s: Scene) => void, key?: string, label = "Edit") {
  const prev = state.scene;
  const now = performance.now();
  const same = !!key && last.key === key && now - last.t < 800;
  if (!same) history(prev, label);
  last = { key: key ?? "", t: now };
  const next = structuredClone(prev);
  fn(next);
  setState({ scene: next, saved: false });
  scheduleSave();
}

function adopt(snap: string) {
  const sc = JSON.parse(snap) as Scene;
  sc.id = sc.id ?? state.scene.id;
  const ids = new Set([...sc.objects.map((o) => o.id), ...sc.lights.map((l) => l.id), ...sc.emitters.map((e) => e.id)]);
  last = { key: "", t: 0 };
  setState((s) => ({ scene: sc, saved: false, selection: s.selection.filter((i) => ids.has(i)), selKey: null }));
  scheduleSave();
}

/** Undo applies the snapshot RETURNED by Rust `undo_pop` (the current state is parked for redo). */
export async function undo() {
  if (undoDepth <= 0 || historyBusy) return;
  historyBusy = true;
  try {
    const cur = JSON.stringify(state.scene);
    let snap: string | null;
    if (isTauri()) snap = await invoke<string | null>("undo_pop", { projectId: pid(), current: cur }).catch(() => null);
    else {
      snap = localUndo.pop() ?? null;
      if (snap) localRedo.push(cur);
    }
    if (!snap) {
      undoDepth = 0;
      return syncHistory();
    }
    adopt(snap);
    undoDepth -= 1;
    redoDepth += 1;
    syncHistory();
  } finally {
    historyBusy = false;
  }
}
export async function redo() {
  if (redoDepth <= 0 || historyBusy) return;
  historyBusy = true;
  try {
    const cur = JSON.stringify(state.scene);
    let snap: string | null;
    if (isTauri()) snap = await invoke<string | null>("redo_pop", { projectId: pid() }).catch(() => null);
    else {
      snap = localRedo.pop() ?? null;
      if (snap) localUndo.push(cur);
    }
    if (!snap) {
      redoDepth = 0;
      return syncHistory();
    }
    adopt(snap);
    redoDepth -= 1;
    undoDepth += 1;
    syncHistory();
  } finally {
    historyBusy = false;
  }
}

/* ---------------------------------------------------------------- project lifecycle */

function registerAssets(list: ImageAsset[]) {
  for (const a of list) registerImage(a.id, a.src);
}

function loadScene(sc: Scene, opts: { play?: boolean } = {}) {
  sc.id = sc.id ?? uid();
  resetHistory();
  last = { key: "", t: 0 };
  live.t = 0;
  setState({ scene: sc, selection: [], selKey: null, time: 0, playing: !!opts.play, canUndo: false, canRedo: false, saved: false, fitTick: state.fitTick + 1 });
  emitLive(0);
  saveNow();
}

const looksLikeScene = (v: unknown): v is Scene => !!v && typeof v === "object" && Array.isArray((v as Scene).objects) && !!(v as Scene).env;

/** Startup: SQLite first (latest_project / list_assets / is_first_launch); localStorage only in the browser. */
export async function boot() {
  // Called AFTER the first paint (see App.tsx): the window is already visible, so none of this blocks startup.
  let scene: Scene | null = null;
  let assets: ImageAsset[] = [];
  if (isTauri()) {
    // three independent reads -> one round trip instead of three sequential ones
    const [proj, rows, first] = await Promise.all([
      invoke<string | null>("latest_project").catch((e) => (console.warn("latest_project", e), null)),
      invoke<{ id: string; label: string; tags: string; width: number; height: number; mime: string; path: string }[]>("list_assets").catch((e) => (console.warn("list_assets", e), [])),
      invoke<boolean>("is_first_launch").catch(() => false),
    ]);
    try {
      if (proj) {
        const p = JSON.parse(proj);
        if (looksLikeScene(p)) scene = p;
      }
    } catch (e) {
      console.warn("latest_project parse", e);
    }
    assets = rows.map((r) => ({ id: r.id, label: r.label, tags: r.tags, width: r.width, height: r.height, mime: r.mime, src: fileUrl(r.path) }));
    if (!scene) scene = first ? buildApexMorph() : emptyScene();
    invokeQuiet("mark_launched");
  } else {
    try {
      const raw = localStorage.getItem(LS.scene);
      if (raw) {
        const p = JSON.parse(raw);
        if (looksLikeScene(p)) scene = p;
      }
      const a = localStorage.getItem(LS.assets);
      if (a) assets = JSON.parse(a) as ImageAsset[];
    } catch {
      /* corrupt fallback storage */
    }
    const first = !localStorage.getItem(LS.launched);
    if (!scene) scene = first ? buildApexMorph() : emptyScene();
    try {
      localStorage.setItem(LS.launched, "1");
    } catch {
      /* storage unavailable */
    }
  }
  scene.id = scene.id ?? uid();
  registerAssets(assets);
  resetHistory();
  setState({ scene, assets, ready: true, playing: true, canUndo: false, canRedo: false, fitTick: state.fitTick + 1 });
  invokeQuiet("ai_log", { projectId: scene.id, line: `project opened: ${scene.name}` });
}

export function newProject() {
  loadScene(emptyScene());
  toast("New blank project");
}
export function openSample() {
  loadScene(buildApexMorph(), { play: true });
  toast("Apex Morph sample loaded");
}
export async function revertProject() {
  if (!isTauri()) return toast("Revert needs the native app (SQLite)");
  const j = await invoke<string | null>("load_project", { id: pid() }).catch(() => null);
  if (!j) return toast("No saved copy found");
  const p = JSON.parse(j);
  if (looksLikeScene(p)) loadScene(p);
}

export function download(name: string, mime: string, data: BlobPart) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function saveProjectFile() {
  saveNow();
  if (!isTauri()) download(`${state.scene.name || "project"}.kinetix.json`, "application/json", JSON.stringify(state.scene, null, 1));
  toast(isTauri() ? "Saved to project database" : "Saved (browser storage + .kinetix.json download)");
}
export function openProjectFile(file: File) {
  file.text().then((txt) => {
    try {
      const p = JSON.parse(txt);
      if (!looksLikeScene(p)) throw new Error("not a Kinetix project");
      p.id = uid();
      loadScene(p, { play: true });
      toast(`Opened ${file.name}`);
    } catch (e) {
      toast(`Could not open file: ${(e as Error).message}`);
    }
  });
}
export const setProjectName = (name: string) => commit((s) => void (s.name = name), "pname", "Rename project");

/* ---------------------------------------------------------------- scene edits */

export function runOps(ops: unknown, label = "Ops") {
  let log: string[] = [];
  commit((s) => {
    log = applyOps(s, ops);
  }, undefined, label);
  const bad = log.filter((l) => l.startsWith("✗")).length;
  toast(`${label}: ${log.length - bad} applied${bad ? `, ${bad} failed (${log.find((l) => l.startsWith("✗"))})` : ""}`);
  return log;
}

export function addObject(partial: Partial<SceneObject>, label: string): string {
  let id = "";
  commit((s) => {
    const o = makeObject({ id: newId(s, partial.kind === "text" ? "txt" : "asset"), ...partial });
    id = o.id;
    s.objects.push(o);
  }, undefined, label);
  select([id]);
  return id;
}

const PALETTE = ["#EF4444", "#F59E0B", "#22C55E", "#06B6D4", "#8B5CF6", "#EC4899", "#3B82F6"];
export function duplicateNode(id: string, variant = false) {
  let nid: string | null = null;
  commit((s) => {
    const src = s.objects.find((o) => o.id === id);
    if (!src) return;
    nid = cloneObject(s, src, variant ? `${src.label} Variant` : `${src.label} Copy`, variant ? { fill: PALETTE[Math.floor(Math.random() * PALETTE.length)] } : {}).id;
  }, undefined, variant ? "Clone variant" : "Duplicate");
  if (nid) select([nid]);
}

export function deleteNodes(ids: string[]) {
  commit((s) => {
    for (const id of ids) {
      const o = s.objects.find((x) => x.id === id);
      if (o) {
        const kill = new Set([o.id, ...descendantsOf(s, o.id).map((d) => d.id)]);
        s.objects = s.objects.filter((x) => !kill.has(x.id));
        for (const l of s.lights) if (l.follow && kill.has(l.follow)) l.follow = null;
        for (const e of s.emitters) if (e.follow && kill.has(e.follow)) e.follow = null;
      }
      s.lights = s.lights.filter((x) => x.id !== id);
      s.emitters = s.emitters.filter((x) => x.id !== id);
    }
  }, undefined, "Delete");
  select([]);
}

export function reorder(id: string, to: "front" | "back" | "up" | "down") {
  commit((s) => {
    const i = s.objects.findIndex((o) => o.id === id);
    if (i < 0) return;
    const [o] = s.objects.splice(i, 1);
    const n = to === "front" ? s.objects.length : to === "back" ? 0 : to === "up" ? Math.min(s.objects.length, i + 1) : Math.max(0, i - 1);
    s.objects.splice(n, 0, o);
  }, undefined, "Z-order");
}

export const parentTo = (id: string, parent: string | null) =>
  runOps([parent ? { op: "attach_part", id, parent, dx: 0, dy: 0 } : { op: "detach_part", id }], parent ? "Parent" : "Unparent");

export const renameNode = (id: string, label: string) =>
  commit((s) => {
    const t = s.objects.find((o) => o.id === id) ?? s.lights.find((o) => o.id === id) ?? s.emitters.find((o) => o.id === id);
    if (t) t.label = label;
  }, `ren:${id}`, "Rename");

export const toggleVisible = (id: string) =>
  commit((s) => {
    const t = s.objects.find((o) => o.id === id) ?? s.lights.find((o) => o.id === id) ?? s.emitters.find((o) => o.id === id);
    if (t) t.visible = !t.visible;
  }, undefined, "Visibility");

export function convertToBezier(id: string) {
  commit((s) => {
    const o = s.objects.find((x) => x.id === id);
    if (o && o.kind === "shape") o.path = subsToD(parseCached(o.path));
  }, undefined, "Convert to Bézier");
}

export function saveAsShape(id: string) {
  const o = state.scene.objects.find((x) => x.id === id);
  if (!o || o.kind !== "shape") return toast("Select a shape or path first");
  commit((s) => {
    s.library = s.library ?? [];
    s.library.push({ id: `shp_${Date.now().toString(36)}`, label: o.label, path: o.path });
  }, undefined, "Save custom shape");
  toast(`Saved “${o.label}” to the shape library`);
}
export function insertShape(shapeId: string) {
  const sh = state.scene.library?.find((x) => x.id === shapeId);
  if (sh) addObject({ label: sh.label, path: sh.path, fill: "#3B82F6" }, `Insert ${sh.label}`);
}

/** Keyframe every transform channel of an object at the playhead. */
export function keyTransform(id: string) {
  commit((s) => {
    const o = s.objects.find((x) => x.id === id);
    if (!o) return;
    const ev = evalObj(o, live.t) as unknown as Record<string, number>;
    for (const p of ["x", "y", "rotation", "scale", "opacity"]) upsertKey(o, p, live.t, ev[p]);
  }, undefined, "Add keyframes");
}

/** Keyframe the given channels of a light at the playhead (origin, aim, intensity, cone …). */
export function keyLight(id: string, props: string[]) {
  commit((s) => {
    const l = s.lights.find((x) => x.id === id);
    if (!l) return;
    const rec = l as unknown as Record<string, number | undefined>;
    for (const p of props) {
      const base = rec[p] ?? (p === "tx" ? l.x : p === "ty" ? l.y : 0);
      upsertKey(l, p, live.t, evalProp(l.tracks, p, live.t, base));
    }
  }, undefined, "Add light keyframes");
}

export function copyKey(k: KeyRef | null) {
  if (!k) return toast("Select a keyframe first");
  const o = state.scene.objects.find((x) => x.id === k.owner) ?? state.scene.lights.find((x) => x.id === k.owner);
  const key = o?.tracks.find((t) => t.prop === k.prop)?.keys.find((q) => Math.abs(q.t - k.t) < 0.001);
  if (!key) return;
  setState({ clipboard: { prop: k.prop, v: key.v, ease: key.ease } });
  toast("Keyframe copied");
}
export function pasteKey(ownerId: string | null) {
  const c = state.clipboard;
  if (!c || !ownerId) return toast("Copy a keyframe, then select an object to paste onto");
  commit((s) => {
    const o = s.objects.find((x) => x.id === ownerId) ?? s.lights.find((x) => x.id === ownerId);
    if (o) upsertKey(o, c.prop, live.t, c.v, c.ease);
  }, undefined, "Paste keyframe");
}
export function deleteKey(k: KeyRef) {
  commit((s) => {
    const o = s.objects.find((x) => x.id === k.owner) ?? s.lights.find((x) => x.id === k.owner);
    const tr = o?.tracks.find((t) => t.prop === k.prop);
    if (!o || !tr) return;
    tr.keys = tr.keys.filter((q) => Math.abs(q.t - k.t) > 0.0005);
    if (!tr.keys.length) o.tracks = o.tracks.filter((t) => t !== tr);
  }, undefined, "Delete keyframe");
  setState({ selKey: null });
}

export function addStoryEvent(start: number, end: number, title: string) {
  commit((s) => void s.events.push({ id: newId(s, "ev"), start, end, title }), undefined, "Add story event");
}

/* ---------------------------------------------------------------- image import */

const persistAssets = (list: ImageAsset[]) => {
  if (isTauri()) return;
  try {
    localStorage.setItem(LS.assets, JSON.stringify(list));
  } catch {
    /* quota */
  }
};

export function insertAsset(assetId: string, at?: { x: number; y: number }) {
  const a = state.assets.find((x) => x.id === assetId);
  if (!a) return;
  registerImage(a.id, a.src);
  const w = 24;
  const h = (w * a.height) / a.width;
  addObject(
    { label: a.label, kind: "image", image: a.id, path: rectPath(w, h), fill: "none", x: at?.x ?? 50, y: at?.y ?? 50, tags: ["image", ...a.tags.split(",").filter(Boolean)], aliases: [a.label.toLowerCase()] },
    `Import ${a.label}`,
  );
}

/** PNG / JPG / WebP / SVG -> <app-data>/assets + SQLite `assets` row (label, tags, bbox) -> animatable object. */
export async function importImageFile(file: File, at?: { x: number; y: number }) {
  if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) return toast(`Unsupported file type: ${file.type || file.name}`);
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth || 256, h: im.naturalHeight || 256 });
    im.onerror = () => rej(new Error("could not decode image"));
    im.src = dataUrl;
  }).catch((e) => {
    toast(String(e.message));
    return null;
  });
  if (!dims) return;
  const id = `img_${Date.now().toString(36)}`;
  const label = file.name.replace(/\.[^.]+$/, "");
  let src = dataUrl;
  if (isTauri()) {
    try {
      const path = await invoke<string>("save_asset", { id, label, tags: "image", width: dims.w, height: dims.h, mime: file.type, fileName: file.name, dataUrl });
      src = fileUrl(path);
    } catch (e) {
      return toast(`Import failed: ${String(e)}`);
    }
  }
  const asset: ImageAsset = { id, label, tags: "image", width: dims.w, height: dims.h, mime: file.type, src };
  const assets = [asset, ...state.assets];
  setState({ assets });
  persistAssets(assets);
  registerImage(id, src);
  insertAsset(id, at);
}

export function resetImages() {
  forgetImages();
  registerAssets(state.assets);
}
