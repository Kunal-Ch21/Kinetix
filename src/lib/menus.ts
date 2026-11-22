import { descendantsOf } from "../engine/scene";
import { RECIPES } from "../components/DocsModal";
import type { MenuItem } from "../components/ui";
import {
  commit,
  convertToBezier,
  deleteNodes,
  duplicateNode,
  getState,
  keyTransform,
  live,
  pasteKey,
  reorder,
  runOps,
  saveAsShape,
  setState,
  setTime,
  toast,
} from "../state/store";
import { openMenu } from "./menu";
import { keyLabel } from "./keybinds";

/** Right-click menu shared by the Canvas and the Outliner. */
export function objectMenu(id: string, x: number, y: number): MenuItem[] {
  const s = getState().scene;
  const o = s.objects.find((q) => q.id === id);
  if (!o) {
    return [{ label: "Delete", danger: true, onClick: () => deleteNodes([id]) }];
  }
  return [
    { label: "Duplicate", shortcut: keyLabel("duplicate"), onClick: () => duplicateNode(id, false) },
    { label: "Clone Variant", onClick: () => duplicateNode(id, true) },
    { label: "Parent To…", onClick: () => setTimeout(() => parentMenu(id, x, y), 0) },
    { label: "Unparent", disabled: !o.parent, onClick: () => runOps([{ op: "detach_part", id }], "Unparent") },
    { sep: true, label: "" },
    { label: "Add Keyframe (transform)", shortcut: keyLabel("add_keyframe"), onClick: () => keyTransform(id) },
    { label: "Paste Keyframe at Playhead", disabled: !getState().clipboard, onClick: () => pasteKey(id) },
    { label: "Convert to Bézier Path", disabled: o.kind !== "shape", onClick: () => convertToBezier(id) },
    { label: "Save as Custom Shape", disabled: o.kind !== "shape", onClick: () => saveAsShape(id) },
    { sep: true, label: "" },
    { label: "Bring to Front", onClick: () => reorder(id, "front") },
    { label: "Bring Forward", onClick: () => reorder(id, "up") },
    { label: "Send Backward", onClick: () => reorder(id, "down") },
    { label: "Send to Back", onClick: () => reorder(id, "back") },
    { sep: true, label: "" },
    { label: "Delete", shortcut: keyLabel("delete_object"), danger: true, onClick: () => deleteNodes([id]) },
  ];
}

function parentMenu(id: string, x: number, y: number) {
  const s = getState().scene;
  const blocked = new Set([id, ...descendantsOf(s, id).map((d) => d.id)]);
  const items: MenuItem[] = s.objects
    .filter((o) => !blocked.has(o.id))
    .slice(0, 16)
    .map((o) => ({ label: `→ ${o.label}`, onClick: () => runOps([{ op: "attach_part", id, parent: o.id, dx: 0, dy: 0 }], "Parent") }));
  openMenu(x, y, items.length ? items : [{ label: "No valid parents", disabled: true }]);
}

export function lightMenu(id: string): MenuItem[] {
  return [{ label: "Delete", danger: true, onClick: () => deleteNodes([id]) }];
}

/** Dope-sheet empty-lane menu: add / paste keyframes at the playhead. */
export function laneMenu(owner: string, prop: string): MenuItem[] {
  return [
    {
      label: "Add Keyframe at Playhead",
      onClick: () =>
        commit((sc) => {
          const o = sc.objects.find((q) => q.id === owner) ?? sc.lights.find((q) => q.id === owner);
          if (o) keyTransform(owner);
          void prop;
        }, undefined, "Add keyframe"),
    },
    { label: "Paste Keyframe", disabled: !getState().clipboard, onClick: () => pasteKey(owner) },
  ];
}

/** `?try=<recipe>` and the docs' “Try in Canvas” buttons. */
export function runRecipe(id: string) {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) return toast(`Recipe “${id}” not found`);
  runOps(r.ops, r.title);
  setTime(0);
  live.t = 0;
  setState({ playing: true });
}
