import {
  BookOpen,
  Brush,
  ChevronDown,
  Circle,
  FilePlus2,
  FolderOpen,
  Hand,
  Hexagon,
  Pipette,
  Settings,
  ImagePlus,
  Lightbulb,
  Minus,
  MousePointer2,
  PenTool,
  Redo2,
  Save,
  Sparkles,
  Square,
  Star,
  Type,
  Undo2,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { ShapeKind, Tool } from "../engine/types";
import { openMenu, triggerImport } from "../lib/menu";
import {
  newProject,
  openProjectFile,
  openSample,
  redo,
  revertProject,
  saveProjectFile,
  setModal,
  setProjectName,
  setState,
  setTool,
  toggleMode,
  undo,
  useStore,
} from "../state/store";
import { Logo, help, Kbd } from "./ui";
import { keyLabel, tip, useKeybinds } from "../lib/keybinds";

const SHAPES: { kind: ShapeKind; label: string; icon: ReactNode }[] = [
  { kind: "rect", label: "Rectangle", icon: <Square size={17} /> },
  { kind: "ellipse", label: "Ellipse", icon: <Circle size={17} /> },
  { kind: "star", label: "Star", icon: <Star size={17} /> },
  { kind: "polygon", label: "Polygon", icon: <Hexagon size={17} /> },
  { kind: "line", label: "Line", icon: <Minus size={17} /> },
];

const TOOL_ACTION: Record<string, string> = { select: "tool_select", brush: "tool_brush", pen: "tool_pen", text: "tool_text", light: "tool_light", hand: "tool_hand", eyedropper: "tool_eyedropper", shape: "tool_shape" };

function ToolBtn({ tool, label, helpKey, children }: { tool: Tool; label: string; k?: string; helpKey: string; children: ReactNode }) {
  const active = useStore((s) => s.tool === tool);
  useKeybinds();
  return (
    <button className="ibtn" data-active={active} title={tip(label, TOOL_ACTION[tool])} {...help(helpKey)} onClick={() => setTool(tool)}>
      {children}
    </button>
  );
}

export function Header() {
  useKeybinds();
  const name = useStore((s) => s.scene.name);
  const mode = useStore((s) => s.mode);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const shapeKind = useStore((s) => s.shapeKind);
  const tool = useStore((s) => s.tool);
  const [editing, setEditing] = useState(false);
  const openRef = useRef<HTMLInputElement>(null);
  const shapeIcon = SHAPES.find((s) => s.kind === shapeKind)!.icon;

  const projectMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(r.left, r.bottom + 6, [
      { label: "New Blank Project", icon: <FilePlus2 size={14} />, shortcut: keyLabel("new_project"), onClick: newProject },
      { label: "Open…", icon: <FolderOpen size={14} />, shortcut: keyLabel("open_project"), onClick: () => openRef.current?.click() },
      { label: "Save", icon: <Save size={14} />, shortcut: keyLabel("save"), onClick: saveProjectFile },
      { sep: true, label: "" },
      { label: "Open Sample Showcase", icon: <Sparkles size={14} />, onClick: openSample },
      { label: "Revert to Saved", onClick: revertProject },
      { sep: true, label: "" },
      { label: "Rename Project", onClick: () => setEditing(true) },
    ]);
  };

  const shapeMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(r.left, r.bottom + 6, [
      ...SHAPES.map((s) => ({
        label: s.label,
        icon: s.icon,
        onClick: () => setState({ shapeKind: s.kind, tool: "shape" as Tool }),
      })),
    ]);
  };

  return (
    <header className="h-[46px] flex-none flex items-center gap-1.5 px-3 relative z-50" style={{ background: "#07090e", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <input
        ref={openRef}
        type="file"
        accept=".json,.kinetix"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openProjectFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2 mr-1">
        <Logo />

      </div>

      <button className="tbtn !h-[28px] !px-2 max-w-[150px]" data-help="project-menu" onClick={projectMenu}>
        {editing ? (
          <input
            autoFocus
            defaultValue={name}
            className="bg-transparent outline-none w-[100px] text-white"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setProjectName(e.target.value.trim());
              setEditing(false);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <span className="truncate">{name}</span>
        )}
        <ChevronDown size={13} className="text-[#7b8497] flex-none" />
      </button>

      <div className="flex items-center ml-1">
        <button className="ibtn" disabled={!canUndo} title={canUndo ? tip("Undo", "undo") : "Nothing to undo yet"} {...help("undo")} onClick={() => void undo()}>
          <Undo2 size={16} />
        </button>
        <button className="ibtn" disabled={!canRedo} title={canRedo ? tip("Redo", "redo") : "Nothing to redo"} {...help("redo")} onClick={() => void redo()}>
          <Redo2 size={16} />
        </button>
      </div>

      <div className="w-px h-5 bg-white/10 mx-1" />

      <div className="flex items-center gap-0.5">
        <ToolBtn tool="select" label="Select" k="V" helpKey="tool-select">
          <MousePointer2 size={17} />
        </ToolBtn>
        <ToolBtn tool="brush" label="Freehand Brush" k="B" helpKey="tool-brush">
          <Brush size={17} />
        </ToolBtn>
        <ToolBtn tool="pen" label="Bézier Pen" k="P" helpKey="tool-pen">
          <PenTool size={17} />
        </ToolBtn>
        <div className="flex items-center" {...help("tool-shape")}>
          <button className="ibtn !w-[30px]" data-active={tool === "shape"} title={tip(`Custom Shape — ${shapeKind}`, "tool_shape")} onClick={() => setTool("shape")} onContextMenu={shapeMenu}>
            {shapeIcon}
          </button>
          <button className="ibtn sm !w-[14px] -ml-1" title="Choose shape" onClick={shapeMenu}>
            <ChevronDown size={11} />
          </button>
        </div>
        <ToolBtn tool="text" label="Text" k="T" helpKey="tool-text">
          <Type size={17} />
        </ToolBtn>
        <button className="ibtn" title={tip("Import Image", "import_image")} {...help("tool-image")} onClick={triggerImport}>
          <ImagePlus size={17} />
        </button>
        <ToolBtn tool="light" label="Add Light" helpKey="tool-light">
          <Lightbulb size={17} />
        </ToolBtn>
        <ToolBtn tool="eyedropper" label="Eyedropper" helpKey="tool-eyedropper">
          <Pipette size={17} />
        </ToolBtn>
        <ToolBtn tool="hand" label="Hand (pan)" helpKey="tool-hand">
          <Hand size={17} />
        </ToolBtn>
      </div>

      <div className="flex-1" />
      {/* Dynamic Island occupies the centre (absolutely positioned in App) */}
      <div className="w-[300px] flex-none" />
      <div className="flex-1" />

      <div className="flex items-center rounded-[9px] p-0.5 border border-white/10 bg-[#0e1118]" {...help("mode-toggle")}>
        {(["studio", "zen"] as const).map((m) => (
          <button
            key={m}
            onClick={() => mode !== m && toggleMode()}
            className={`h-[26px] px-3 rounded-[7px] text-[12px] font-medium capitalize transition-colors ${mode === m ? "bg-white/12 text-white" : "text-[#7b8497] hover:text-white"}`}
            title={tip("Toggle Studio / Zen", "toggle_zen")}
          >
            {m}
          </button>
        ))}
      </div>
      <button className="tbtn" {...help("model-settings")} onClick={() => setModal("models")}>
        Model Settings
      </button>
      <button className="tbtn !px-2" title={tip("Settings & keybinds", "open_settings")} data-help="settings" onClick={() => setModal("settings")}>
        <Settings size={14} />
      </button>
      <button className="tbtn" title={tip("Help & glossary", "open_help")} {...help("docs")} onClick={() => setModal("docs")}>
        <BookOpen size={14} /> Docs
      </button>
      <button className="tbtn primary" {...help("export")} onClick={() => setModal("export")}>
        Export
      </button>
      <span className="hidden xl:block">
        <Kbd>{keyLabel("toggle_zen")}</Kbd>
      </span>
    </header>
  );
}
