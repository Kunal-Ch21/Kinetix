import { Brush, Hand, ImagePlus, Lightbulb, LogOut, MousePointer2, Pause, PenTool, Play, Redo2, Search, Shapes, Type, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Tool } from "../engine/types";
import { runDirector } from "../lib/director";
import { keyLabel, tip, useKeybinds } from "../lib/keybinds";
import { triggerImport } from "../lib/menu";
import { useBusy } from "../lib/useAi";
import { live, onLive, redo, setModal, setState, setTime, setTool, toggleMode, togglePlay, undo, useStore } from "../state/store";
import { CHIPS } from "./Director";
import { TimeCode } from "./Timeline";
import { help } from "./ui";

const TOOLS: { tool: Tool; icon: React.ReactNode; label: string; action: string; help: string }[] = [
  { tool: "select", icon: <MousePointer2 size={16} />, label: "Select", action: "tool_select", help: "tool-select" },
  { tool: "brush", icon: <Brush size={16} />, label: "Brush", action: "tool_brush", help: "tool-brush" },
  { tool: "pen", icon: <PenTool size={16} />, label: "Pen", action: "tool_pen", help: "tool-pen" },
  { tool: "shape", icon: <Shapes size={16} />, label: "Shape", action: "tool_shape", help: "tool-shape" },
  { tool: "text", icon: <Type size={16} />, label: "Text", action: "tool_text", help: "tool-text" },
  { tool: "light", icon: <Lightbulb size={16} />, label: "Light", action: "tool_light", help: "tool-light" },
  { tool: "hand", icon: <Hand size={16} />, label: "Hand", action: "tool_hand", help: "tool-hand" },
];

const GLASS: React.CSSProperties = {
  background: "rgba(14,17,24,0.55)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
};

/** Draggable scrub bar. Position is written to the DOM from the live clock — no React renders while playing. */
function ScrubBar() {
  const dur = useStore((s) => s.scene.duration);
  const fill = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const place = (t: number) => {
      const p = `${Math.max(0, Math.min(1, t / dur)) * 100}%`;
      if (fill.current) fill.current.style.width = p;
      if (thumb.current) thumb.current.style.left = p;
    };
    place(live.t);
    return onLive(place);
  }, [dur]);
  const seek = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    setTime(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur);
  };
  return (
    <div
      ref={track}
      data-help="playhead"
      className="relative h-6 flex-1 cursor-pointer touch-none"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        seek(e.clientX);
        const move = (ev: PointerEvent) => seek(ev.clientX);
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    >
      <div className="absolute left-0 right-0 top-1/2 h-[5px] -translate-y-1/2 overflow-hidden rounded-full bg-white/15">
        <div ref={fill} className="h-full rounded-full bg-[#F59E0B]" />
      </div>
      <div ref={thumb} className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#F59E0B] bg-[#0E1118] shadow-[0_0_10px_rgba(245,158,11,.7)]" />
    </div>
  );
}

/**
 * Zen chrome — only floating glass overlays on top of the full-bleed canvas:
 *   top-left   project + tool pill          top-center  Dynamic Island helper (rendered by <IslandBot/>)
 *   top-right  "Exit Zen" pill              bottom      Spotlight AI command bar + mini timeline pill
 */
export function ZenOverlay() {
  useKeybinds();
  const tool = useStore((s) => s.tool);
  const name = useStore((s) => s.scene.name);
  const playing = useStore((s) => s.playing);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const prompt = useStore((s) => s.prompt);
  const busy = useBusy();
  const [idle, setIdle] = useState(false);
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 3500);
    };
    window.addEventListener("mousemove", wake);
    wake();
    return () => {
      window.removeEventListener("mousemove", wake);
      window.clearTimeout(timer);
    };
  }, []);

  const dim = idle && !focus && playing ? 0.45 : 1;
  return (
    <div className="pointer-events-none absolute inset-0 z-40 anim-fade">
      {/* top-left: project + tools */}
      <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-1 rounded-full p-1 pl-3 transition-opacity" style={{ ...GLASS, opacity: dim }}>
        <span className="mr-1 max-w-[140px] truncate text-[12px] font-medium text-white" title={name}>{name}</span>
        <span className="mx-1 h-5 w-px bg-white/15" />
        {TOOLS.map((t) => (
          <button key={t.tool} className="ibtn !rounded-full" data-active={tool === t.tool} title={tip(t.label, t.action)} {...help(t.help)} onClick={() => setTool(t.tool)}>
            {t.icon}
          </button>
        ))}
        <button className="ibtn !rounded-full" title={tip("Import image", "import_image")} {...help("tool-image")} onClick={triggerImport}>
          <ImagePlus size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button className="ibtn !rounded-full" disabled={!canUndo} title={tip("Undo", "undo")} {...help("undo")} onClick={() => void undo()}>
          <Undo2 size={15} />
        </button>
        <button className="ibtn !rounded-full" disabled={!canRedo} title={tip("Redo", "redo")} {...help("redo")} onClick={() => void redo()}>
          <Redo2 size={15} />
        </button>
      </div>

      {/* top-right: always-visible exit */}
      <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-2">
        <button className="tbtn primary !h-[30px] !rounded-full" style={{ backdropFilter: "blur(12px)" }} {...help("export")} onClick={() => setModal("export")}>
          Export
        </button>
        <button
          className="flex h-[34px] items-center gap-2 rounded-full pl-3 pr-2 text-[12.5px] font-semibold text-white hover:brightness-125"
          style={{ ...GLASS, border: "1px solid rgba(6,182,212,0.6)", boxShadow: "0 0 18px rgba(6,182,212,0.25), 0 8px 30px rgba(0,0,0,0.35)" }}
          title="Back to the 4-panel Studio"
          {...help("mode-toggle")}
          onClick={toggleMode}
        >
          <LogOut size={14} className="text-cyan" />
          Exit Zen
          <kbd className="mono rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] text-[#cfe8ff]">{keyLabel("toggle_zen") || "—"}</kbd>
        </button>
      </div>

      {/* bottom-center: Spotlight AI command bar + mini timeline pill */}
      <div className="absolute bottom-4 left-1/2 flex w-[min(640px,92vw)] -translate-x-1/2 flex-col items-stretch gap-2 transition-opacity" style={{ opacity: dim }}>
        <div className="pointer-events-auto rounded-2xl px-3 py-2" style={GLASS} {...help("director")}>
          <div className="flex items-center gap-2">
            <Search size={15} className="flex-none text-cyan" />
            <input
              data-zen-input
              data-help="director-input"
              value={prompt}
              onChange={(e) => setState({ prompt: e.target.value })}
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && prompt.trim()) void runDirector();
                if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
              placeholder={busy ? "Director is thinking…" : "Ask the AI Director… e.g. “Sweep a warm spotlight across the title”"}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-white outline-none placeholder:text-[#7d8aa0]"
              style={{ userSelect: "text" }}
            />
            <kbd className="mono flex-none rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-[#aab4c7]">{keyLabel("focus_ai") || "—"}</kbd>
          </div>
          {focus && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CHIPS.map((c) => (
                <button key={c.label} className="h-6 rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-[11px] text-[#aab4c7] hover:bg-white/10 hover:text-white" onPointerDown={(e) => e.preventDefault()} onClick={() => setState({ prompt: c.prompt })}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="pointer-events-auto flex h-11 items-center gap-3 self-center rounded-full pl-1.5 pr-4" style={{ ...GLASS, width: "min(520px,100%)" }} {...help("transport")}>
          <button className="ibtn !h-[32px] !w-[32px] !rounded-full" style={{ background: "rgba(245,158,11,0.2)", color: "#F59E0B" }} title={tip(playing ? "Pause" : "Play", "play_pause")} onClick={togglePlay}>
            {playing ? <Pause size={14} fill="#F59E0B" /> : <Play size={14} fill="#F59E0B" />}
          </button>
          <ScrubBar />
          <TimeCode />
        </div>
      </div>
    </div>
  );
}
