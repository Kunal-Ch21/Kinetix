import { ReactNode, useEffect, useRef, useState } from "react";
import { toHex } from "@/engine/math";
import { fieldHelp, sliderHelp } from "@/lib/helpCards";

const ICONS: Record<string, string> = {
  play: "M6 4l14 8-14 8z",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  skipBack: "M19 20L9 12l10-8zM5 19V5",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3",
  save: "M5 3h11l4 4v13a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1zM8 3v6h8M8 21v-7h8v7",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  file: "M6 3h8l5 5v13H6zM14 3v5h5",
  sun: "M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  book: "M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 21.5zM4 19.5A2.5 2.5 0 016.5 17H20",
  type: "M4 7V4h16v3M9 20h6M12 4v16",
  spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  link: "M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z",
  eyeOff: "M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.9M6.6 7.6A17 17 0 002 12s4 7 10 7a9.7 9.7 0 004.2-1M9.9 9.9a3 3 0 004.2 4.2",
  x: "M18 6L6 18M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  cloud: "M7 18a4 4 0 010-8 5.5 5.5 0 0110.7 1.5A3.3 3.3 0 0117 18z",
  wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M12.2 6.2L11 5M3 21l9-9M12.2 11.8L11 13",
  zap: "M13 2L3 14h8l-1 8 10-12h-8z",
  chevron: "M9 6l6 6-6 6",
  terminal: "M4 17l6-6-6-6M12 19h8",
  cursor: "M5 3l14 7-6 2-2 6z",
  maximize: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
};
export function Icon({ name, size = 15, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name] ?? ICONS.zap} />
    </svg>
  );
}

export function IconBtn({ icon, label, onClick, active, disabled, size = 15 }: { icon: string; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; size?: number }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md border transition ${active ? "border-[#3B82F6]/60 bg-[#3B82F6]/20 text-[#9CC4FF]" : "border-transparent text-[#9AA3B8] hover:bg-white/5 hover:text-white"} disabled:opacity-30 disabled:hover:bg-transparent`}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Btn({ children, onClick, tone = "default", small, disabled, title }: { children: ReactNode; onClick?: () => void; tone?: "default" | "blue" | "amber" | "danger"; small?: boolean; disabled?: boolean; title?: string }) {
  const tones = {
    default: "border-white/10 bg-white/[0.04] text-[#C9D0E0] hover:bg-white/10",
    blue: "border-[#3B82F6]/60 bg-[#3B82F6] text-white hover:brightness-110 shadow-[0_0_18px_rgba(59,130,246,.3)]",
    amber: "border-[#F59E0B]/50 bg-[#F59E0B]/15 text-[#FBBF4D] hover:bg-[#F59E0B]/25",
    danger: "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
  };
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`rounded-md border font-medium transition disabled:opacity-40 ${small ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"} ${tones[tone]}`}>
      {children}
    </button>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-b border-white/[0.06] px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#7F889D]">{title}</h4>
        {right}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function Num({ label, value, onChange, min = -1000, max = 1000, step = 0.1, slider = true, suffix }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; slider?: boolean; suffix?: string }) {
  const v = Number.isFinite(value) ? value : 0;
  return (
    <label data-help={sliderHelp(label)} className="grid grid-cols-[72px_1fr_58px] items-center gap-2 text-[11.5px] text-[#9AA3B8]">
      <span className="truncate">{label}</span>
      {slider ? (
        <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, v))} onChange={(e) => onChange(parseFloat(e.target.value))} className="kx-range" />
      ) : (
        <span />
      )}
      <input
        type="number"
        step={step}
        value={Math.round(v * 1000) / 1000}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(n);
        }}
        className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-right font-mono text-[11px] text-[#DDE3F0] outline-none focus:border-[#3B82F6]/70"
      />
      {suffix ? <span className="sr-only">{suffix}</span> : null}
    </label>
  );
}

export function ColorField({ label, value, onChange, allowNone }: { label: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  const none = value === null || value === "none";
  return (
    <div className="grid grid-cols-[72px_1fr_auto] items-center gap-2 text-[11.5px] text-[#9AA3B8]">
      <span className="truncate">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={none ? "#000000" : toHex(value as string)} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-white/10 bg-transparent p-0" />
        <span className="font-mono text-[10.5px] text-[#7F889D]">{none ? "none" : toHex(value as string)}</span>
      </div>
      {allowNone ? (
        <button type="button" className="text-[10px] text-[#7F889D] hover:text-white" onClick={() => onChange(none ? "#ffffff" : null)}>
          {none ? "set" : "clear"}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button data-help={fieldHelp(label)} type="button" onClick={() => onChange(!value)} className="flex w-full items-center justify-between text-[11.5px] text-[#9AA3B8]">
      <span>{label}</span>
      <span className={`h-4 w-7 rounded-full p-0.5 transition ${value ? "bg-[#3B82F6]" : "bg-white/10"}`}>
        <span className={`block h-3 w-3 rounded-full bg-white transition ${value ? "translate-x-3" : ""}`} />
      </span>
    </button>
  );
}

export function Select({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label data-help={fieldHelp(label)} className="grid grid-cols-[72px_1fr] items-center gap-2 text-[11.5px] text-[#9AA3B8]">
      <span className="truncate">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded border border-white/10 bg-[#0B0E15] px-1.5 py-1 text-[11.5px] text-[#DDE3F0] outline-none focus:border-[#3B82F6]/70">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label data-help={fieldHelp(label)} className="grid grid-cols-[72px_1fr] items-center gap-2 text-[11.5px] text-[#9AA3B8]">
      <span className="truncate">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[11.5px] text-[#DDE3F0] outline-none focus:border-[#3B82F6]/70" />
    </label>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  danger?: boolean;
  sep?: boolean;
  disabled?: boolean;
}
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    }
    const close = () => onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("blur", close);
    };
  }, [x, y, onClose]);
  return (
    <div ref={ref} onPointerDown={(e) => e.stopPropagation()} style={{ left: pos.x, top: pos.y }} className="kx-glass fixed z-[100] min-w-[190px] rounded-xl border border-white/10 p-1 shadow-2xl">
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="my-1 h-px bg-white/10" />
        ) : (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            onClick={() => {
              it.onClick?.();
              onClose();
            }}
            className={`block w-full rounded-lg px-3 py-1.5 text-left text-xs disabled:opacity-30 ${it.danger ? "text-red-300 hover:bg-red-500/15" : "text-[#D5DBE8] hover:bg-white/10"}`}
          >
            <span className="flex items-center gap-2">
              {it.icon ? <span className="flex w-4 justify-center text-[#8B93A7]">{it.icon}</span> : null}
              <span className="flex-1">{it.label}</span>
              {it.shortcut ? <span className="mono text-[9.5px] text-[#6F788D]">{it.shortcut}</span> : null}
            </span>
          </button>
        ),
      )}
    </div>
  );
}

/* ---------- Inspect Mode hooks (IslandBot reads `data-help` ids from lib/knowledge.ts) ---------- */
export const help = (id: string) => ({ "data-help": id });

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mono rounded border border-white/10 bg-white/5 px-1 text-[9.5px] text-[#9aa4b8]">{children}</kbd>;
}

export function Logo() {
  return (
    <span className="mr-1 flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center rounded-lg bg-gradient-to-br from-[#3B82F6] to-[#06B6D4] shadow-[0_0_14px_rgba(6,182,212,.5)]">
        <Icon name="zap" size={13} className="text-white" />
      </span>
      <span className="text-[13px] font-semibold tracking-tight text-white">Kinetix</span>
    </span>
  );
}
