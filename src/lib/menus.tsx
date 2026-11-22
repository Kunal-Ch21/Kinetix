import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Clipboard, Copy, Diamond, FolderTree, GitFork, ImagePlus, Layers, Lightbulb, Maximize, PenTool, Shapes, Trash2, Unlink } from "lucide-react";
import type { MenuItem } from "../components/ContextMenu";
import { makeNode, type Channel } from "../engine/types";
import {
  addKeyAt,
  addNode,
  convertToBezier,
  deleteKeys,
  deleteNodes,
  descendants,
  duplicateNode,
  copyKeys,
  getState,
  keyAllChannels,
  pasteKeys,
  reparent,
  saveAsShape,
  select,
  setState,
  zOrder,
} from "../state/store";

let importInput: HTMLInputElement | null = null;
export const registerImportInput = (el: HTMLInputElement | null) => {
  importInput = el;
};
export const triggerImport = () => importInput?.click();

const sz = 14;

export function nodeMenu(id: string): MenuItem[] {
  const s = getState();
  const n = s.project.nodes.find((x) => x.id === id);
  if (!n) return [];
  const bad = new Set([id, ...descendants(s.project, id)]);
  const targets = s.project.nodes.filter((x) => !bad.has(x.id) && x.kind !== "clouds" && x.kind !== "particles");
  return [
    { label: "Duplicate", icon: <Copy size={sz} />, shortcut: "Ctrl+D", onClick: () => duplicateNode(id) },
    { label: "Clone Variant", icon: <GitFork size={sz} />, onClick: () => duplicateNode(id, true) },
    {
      label: "Parent To",
      icon: <FolderTree size={sz} />,
      children: [
        { label: "None (unparent)", icon: <Unlink size={sz} />, disabled: !n.parent, onClick: () => reparent(id, null) },
        ...targets.map((t) => ({ label: t.label, onClick: () => reparent(id, t.id) })),
      ],
    },
    { sep: true },
    { label: "Add Keyframe", icon: <Diamond size={sz} />, shortcut: "K", onClick: () => keyAllChannels(id) },
    { label: "Convert to Bézier Path", icon: <PenTool size={sz} />, onClick: () => convertToBezier(id) },
    { label: "Save as Custom Shape", icon: <Shapes size={sz} />, disabled: n.kind !== "path", onClick: () => saveAsShape(id) },
    {
      label: "Z-Order",
      icon: <Layers size={sz} />,
      children: [
        { label: "Bring to Front", icon: <ChevronsUp size={sz} />, onClick: () => zOrder(id, "front") },
        { label: "Bring Forward", icon: <ArrowUp size={sz} />, onClick: () => zOrder(id, "up") },
        { label: "Send Backward", icon: <ArrowDown size={sz} />, onClick: () => zOrder(id, "down") },
        { label: "Send to Back", icon: <ChevronsDown size={sz} />, onClick: () => zOrder(id, "back") },
      ],
    },
    { sep: true },
    { label: "Delete", icon: <Trash2 size={sz} />, danger: true, shortcut: "Del", onClick: () => deleteNodes([id]) },
  ];
}

export function canvasMenu(gx: number, gy: number): MenuItem[] {
  const s = getState();
  return [
    { label: "Import Image…", icon: <ImagePlus size={sz} />, shortcut: "I", onClick: triggerImport },
    {
      label: "Add Point Light Here",
      icon: <Lightbulb size={sz} />,
      onClick: () =>
        addNode(
          makeNode({
            label: "Point Light",
            kind: "light",
            x: gx,
            y: gy,
            light: { kind: "point", color: "#F59E0B", intensity: 70, radius: 18, angle: 60, dir: 0 },
          }),
          "Add Light",
        ),
    },
    { sep: true },
    { label: "Select All", shortcut: "Ctrl+A", onClick: () => select(s.project.nodes.filter((n) => !n.parent).map((n) => n.id)) },
    { label: "Paste Keyframes", icon: <Clipboard size={sz} />, disabled: !s.clipboard.length, shortcut: "Ctrl+V", onClick: pasteKeys },
    { label: "Fit View", icon: <Maximize size={sz} />, shortcut: "F", onClick: () => setState((st) => ({ fitTick: st.fitTick + 1 })) },
    { label: s.showGrid ? "Hide Grid" : "Show Grid", onClick: () => setState((st) => ({ showGrid: !st.showGrid })) },
  ];
}

export function keyMenu(nodeId: string | null, ch: Channel | null, t: number): MenuItem[] {
  const s = getState();
  return [
    {
      label: "Add Keyframe",
      icon: <Diamond size={sz} />,
      disabled: !nodeId || !ch,
      onClick: () => nodeId && ch && addKeyAt(nodeId, ch, t),
    },
    { label: "Copy Keyframes", icon: <Copy size={sz} />, shortcut: "Ctrl+C", disabled: !s.selKeys.length, onClick: copyKeys },
    { label: "Paste Keyframes at Playhead", icon: <Clipboard size={sz} />, shortcut: "Ctrl+V", disabled: !s.clipboard.length, onClick: pasteKeys },
    { sep: true },
    { label: "Delete Keyframes", icon: <Trash2 size={sz} />, danger: true, shortcut: "Del", disabled: !s.selKeys.length, onClick: () => deleteKeys(s.selKeys) },
  ];
}
