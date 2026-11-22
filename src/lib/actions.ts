// Every studio action in one place. The keyboard dispatcher (App.tsx), tooltips, context menus and the Settings
// "Keybinds" tab all refer to actions by id (see keybinds.ts), so rebinding a key changes it everywhere.
import { vp } from "../components/Viewport";
import type { Tool } from "../engine/types";
import {
  copyKey,
  deleteKey,
  deleteNodes,
  duplicateNode,
  getState,
  keyLight,
  keyTransform,
  live,
  newProject,
  parentTo,
  pasteKey,
  redo,
  reorder,
  saveProjectFile,
  select,
  setModal,
  setState,
  setTime,
  setTool,
  toast,
  toggleMode,
  togglePlay,
  undo,
} from "../state/store";
import { triggerImport, triggerOpen } from "./menu";

const TOOL_ACTIONS: Record<string, Tool> = {
  tool_select: "select",
  tool_brush: "brush",
  tool_pen: "pen",
  tool_shape: "shape",
  tool_text: "text",
  tool_light: "light",
  tool_eyedropper: "eyedropper",
  tool_hand: "hand",
};

/** Sorted, de-duplicated keyframe times of the selection (or of the whole scene when nothing is selected). */
function keyTimes(): number[] {
  const { scene, selection } = getState();
  const owners = selection.length ? [...scene.objects, ...scene.lights].filter((o) => selection.includes(o.id)) : [...scene.objects, ...scene.lights];
  const set = new Set<number>();
  for (const o of owners) for (const tr of o.tracks) for (const k of tr.keys) set.add(Math.round(k.t * 1000) / 1000);
  return [...set].sort((a, b) => a - b);
}

/** Runs an action. Returns true when the action existed (so the caller can preventDefault). */
export function runAction(id: string): boolean {
  const s = getState();
  const fps = s.scene.fps;
  const sel = s.selection;
  if (id in TOOL_ACTIONS) {
    setTool(TOOL_ACTIONS[id]);
    return true;
  }
  switch (id) {
    case "play_pause":
      togglePlay();
      return true;
    case "step_fwd":
      setTime(live.t + 1 / fps);
      return true;
    case "step_back":
      setTime(live.t - 1 / fps);
      return true;
    case "step_fwd_10":
      setTime(live.t + 10 / fps);
      return true;
    case "step_back_10":
      setTime(live.t - 10 / fps);
      return true;
    case "jump_start":
      setTime(0);
      return true;
    case "jump_end":
      setTime(s.scene.duration);
      return true;
    case "add_keyframe": {
      const light = s.scene.lights.find((l) => l.id === sel[0]);
      if (light) keyLight(light.id, ["intensity", "x", "y", "tx", "ty", "cone"]);
      else if (sel[0]) keyTransform(sel[0]);
      else toast("Select an object or light first, then add a keyframe");
      return true;
    }
    case "delete_keyframe":
      if (s.selKey) deleteKey(s.selKey);
      else if (sel.length) deleteNodes(sel);
      return true;
    case "next_keyframe": {
      const n = keyTimes().find((t) => t > live.t + 0.001);
      if (n === undefined) toast("No later keyframe");
      else setTime(n);
      return true;
    }
    case "prev_keyframe": {
      const p = keyTimes().reverse().find((t) => t < live.t - 0.001);
      if (p === undefined) toast("No earlier keyframe");
      else setTime(p);
      return true;
    }
    case "copy_keyframe":
      copyKey(s.selKey);
      return true;
    case "paste_keyframe":
      pasteKey(sel[0] ?? null);
      return true;
    case "loop_toggle":
      setState({ loop: !s.loop });
      return true;
    case "onion_toggle":
      setState({ onion: !s.onion });
      return true;
    case "import_image":
      triggerImport();
      return true;
    case "edit_nodes": {
      if (s.tool === "pen") {
        vp.finishPen();
        return true;
      }
      const o = s.scene.objects.find((x) => x.id === sel[0]);
      if (o?.kind === "shape") setState({ editNodes: !s.editNodes, tool: "select" });
      return true;
    }
    case "toggle_zen":
      toggleMode();
      return true;
    case "toggle_grid":
      setState({ showGrid: !s.showGrid });
      return true;
    case "toggle_snap":
      setState({ snap: !s.snap });
      toast(s.snap ? "Snapping off" : "Snapping on");
      return true;
    case "zoom_in":
      vp.zoomIn();
      return true;
    case "zoom_out":
      vp.zoomOut();
      return true;
    case "zoom_fit":
      vp.zoomFit();
      return true;
    case "zoom_reset":
      vp.zoomReset();
      return true;
    case "undo":
      if (s.canUndo) void undo();
      return true;
    case "redo":
      if (s.canRedo) void redo();
      return true;
    case "duplicate":
      if (sel[0]) duplicateNode(sel[0]);
      return true;
    case "clone_variant":
      if (sel[0]) duplicateNode(sel[0], true);
      return true;
    case "group": {
      if (sel.length < 2) toast("Select 2 or more objects (Shift+click) — the first one becomes the parent");
      else for (const child of sel.slice(1)) parentTo(child, sel[0]);
      return true;
    }
    case "ungroup":
      for (const id2 of sel) if (s.scene.objects.find((o) => o.id === id2)?.parent) parentTo(id2, null);
      return true;
    case "bring_forward":
      for (const id2 of sel) reorder(id2, "up");
      return true;
    case "send_backward":
      for (const id2 of sel) reorder(id2, "down");
      return true;
    case "delete_object":
      if (s.editNodes && vp.deleteAnchor()) return true;
      if (sel.length) deleteNodes(sel);
      return true;
    case "select_all":
      select(s.scene.objects.filter((o) => !o.parent).map((o) => o.id));
      return true;
    case "focus_ai": {
      const el = document.querySelector<HTMLElement>(s.mode === "zen" ? "[data-zen-input]" : "[data-director-input]");
      if (el) el.focus();
      else setModal(s.modal === "spotlight" ? null : "spotlight");
      return true;
    }
    case "inspect_mode":
      setState({ inspectMode: !s.inspectMode, islandOpen: true });
      return true;
    case "open_help":
      setModal(s.modal === "docs" ? null : "docs");
      return true;
    case "open_settings":
      setModal(s.modal === "settings" ? null : "settings");
      return true;
    case "new_project":
      newProject();
      return true;
    case "open_project":
      triggerOpen();
      return true;
    case "save":
      saveProjectFile();
      return true;
    case "export":
      setModal("export");
      return true;
  }
  return false;
}
