import { Keyboard, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ACTIONS, ACTION_BY_ID, CATEGORIES, assignBinding, comboOf, eventCombo, findConflict, formatCombo, hasAnyCustom, isCustomised, isModifierKey, resetAllBindings, resetBinding, setBinding, useKeybinds } from "../lib/keybinds";
import { setState, useStore } from "../state/store";
import { Modal } from "./Modals";

interface Pending {
  id: string;
  combo: string;
  other: string; // conflicting action id
}

function KeyRow({ id, recording, pending, onRecord, onResolve }: { id: string; recording: boolean; pending: Pending | null; onRecord: () => void; onResolve: (m: "swap" | "override" | "cancel") => void }) {
  const a = ACTION_BY_ID.get(id)!;
  const combo = comboOf(id);
  const custom = isCustomised(id);
  return (
    <div className={`rounded-lg border px-3 py-2 ${recording ? "border-cyan/60 bg-cyan/[0.06]" : "border-white/[0.06] bg-white/[0.02]"}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] text-white">
            {a.label}
            {custom && <span className="ml-2 rounded bg-amber/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber">custom</span>}
          </div>
          {a.hint && <div className="truncate text-[11px] text-[#7d8aa0]">{a.hint}</div>}
        </div>
        <button
          onClick={onRecord}
          title="Click, then press the new key combination"
          className={`mono min-w-[112px] rounded-md border px-2.5 py-1 text-[11.5px] ${recording ? "animate-pulse border-cyan bg-cyan/15 text-cyan" : combo ? "border-white/15 bg-black/30 text-[#DDE3F0] hover:border-cyan/50" : "border-dashed border-white/15 text-[#6F788D] hover:border-cyan/50"}`}
        >
          {recording ? "Press keys… (Esc cancels)" : formatCombo(combo)}
        </button>
        <button className="ibtn sm" title="Reset this shortcut" disabled={!custom} onClick={() => resetBinding(id)}>
          <RotateCcw size={13} />
        </button>
        <button className="ibtn sm" title="Unbind" disabled={!combo} onClick={() => setBinding(id, "")}>
          <X size={13} />
        </button>
      </div>
      {pending && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-[11.5px] text-[#ffd9a0]">
          <span className="flex-1">
            <b className="mono">{formatCombo(pending.combo)}</b> is already used by <b>{ACTION_BY_ID.get(pending.other)?.label}</b>.
          </span>
          <button className="tbtn !h-[24px] primary" onClick={() => onResolve("swap")} title="Give the other action this row's old shortcut">Swap</button>
          <button className="tbtn !h-[24px]" onClick={() => onResolve("override")} title="Take the shortcut; the other action becomes unbound">Override</button>
          <button className="tbtn !h-[24px]" onClick={() => onResolve("cancel")}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function Keybinds() {
  useKeybinds();
  const [q, setQ] = useState("");
  const [rec, setRec] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirm, setConfirm] = useState(false);

  // Click-to-record: capture the next combo before any app shortcut can see it.
  useEffect(() => {
    if (!rec) return;
    document.body.dataset.recording = "1";
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isModifierKey(e)) return;
      if (e.key === "Escape") return setRec(null);
      const combo = eventCombo(e);
      const other = findConflict(combo, rec);
      if (other) setPending({ id: rec, combo, other: other.id });
      else {
        setBinding(rec, combo);
        setPending(null);
      }
      setRec(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      delete document.body.dataset.recording;
    };
  }, [rec]);

  const needle = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        c,
        items: ACTIONS.filter((a) => a.category === c && (!needle || `${a.label} ${a.hint ?? ""} ${comboOf(a.id)} ${formatCombo(comboOf(a.id))}`.toLowerCase().includes(needle))),
      })).filter((g) => g.items.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needle, rec, pending, useKeybindsVersion()],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-white/[0.07] px-5 py-3">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3">
          <Search size={14} className="text-[#7d8aa0]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={`Search ${ACTIONS.length} actions or press a key name…`} className="flex-1 bg-transparent text-[12.5px] text-white outline-none placeholder:text-[#566074]" style={{ userSelect: "text" }} />
        </div>
        {confirm ? (
          <>
            <span className="text-[11.5px] text-amber">Reset all shortcuts?</span>
            <button className="tbtn !h-[28px] primary" onClick={() => (resetAllBindings(), setConfirm(false), setPending(null))}>Yes, reset</button>
            <button className="tbtn !h-[28px]" onClick={() => setConfirm(false)}>No</button>
          </>
        ) : (
          <button className="tbtn !h-[28px]" disabled={!hasAnyCustom()} onClick={() => setConfirm(true)} title="Restore every shortcut to its factory default">
            <RotateCcw size={13} /> Reset to Defaults
          </button>
        )}
      </div>
      <div className="kx-scroll min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <p className="mb-3 text-[12px] leading-relaxed text-[#8a93a6]">Click a shortcut, then press the keys you want. If another action already uses them you can <b>Swap</b> the two or <b>Override</b>. Changes save automatically and show up in every tooltip and menu.</p>
        {groups.map((g) => (
          <section key={g.c} className="mb-5">
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-cyan">{g.c} · {g.items.length}</h3>
            <div className="flex flex-col gap-1.5">
              {g.items.map((a) => (
                <KeyRow
                  key={a.id}
                  id={a.id}
                  recording={rec === a.id}
                  pending={pending && pending.id === a.id ? pending : null}
                  onRecord={() => {
                    setPending(null);
                    setRec(rec === a.id ? null : a.id);
                  }}
                  onResolve={(m) => {
                    if (pending && m !== "cancel") assignBinding(pending.id, pending.combo, m);
                    setPending(null);
                  }}
                />
              ))}
            </div>
          </section>
        ))}
        {!groups.length && <div className="py-10 text-center text-[12.5px] text-[#6F788D]">No action matches “{q}”.</div>}
      </div>
    </div>
  );
}

// tiny helper so the memo above refreshes when bindings change
function useKeybindsVersion() {
  return useKeybinds();
}

function General() {
  const loop = useStore((s) => s.loop);
  const snap = useStore((s) => s.snap);
  const grid = useStore((s) => s.showGrid);
  const row = (label: string, desc: string, on: boolean, key: "loop" | "snap" | "showGrid") => (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex-1">
        <div className="text-[13px] text-white">{label}</div>
        <div className="text-[11.5px] text-[#7d8aa0]">{desc}</div>
      </div>
      <input type="checkbox" checked={on} onChange={() => setState({ [key]: !on } as never)} className="h-4 w-4 accent-cyan" />
    </label>
  );
  return (
    <div className="flex flex-col gap-2 p-5">
      {row("Loop playback", "Restart automatically when the animation reaches the end.", loop, "loop")}
      {row("Snap to grid", "Make dragged objects land on whole grid numbers.", snap, "snap")}
      {row("Show grid", "Draw a faint 10 × 10 guide grid over the canvas while editing.", grid, "showGrid")}
      <p className="mt-2 text-[11.5px] leading-relaxed text-[#6F788D]">Performance: the viewport renders at up to 60 FPS with pixel density capped at 1.5× so high-DPI screens stay smooth. Static art (sky, mountains, clouds, glow sprites) is cached off-screen.</p>
    </div>
  );
}

export function SettingsModal() {
  const tab = useStore((s) => s.settingsTab);
  const close = () => setState({ modal: null });
  return (
    <Modal title="Settings" icon={<SlidersHorizontal size={16} />} onClose={close} width={760}>
      <div className="flex h-[min(640px,76vh)] min-h-0 flex-col">
        <div className="flex flex-none gap-1 border-b border-white/[0.07] px-4 pt-2">
          {([
            ["keybinds", "Keybinds", <Keyboard key="k" size={13} />],
            ["general", "General", <SlidersHorizontal key="g" size={13} />],
          ] as const).map(([id, label, icon]) => (
            <button key={id} onClick={() => setState({ settingsTab: id })} className={`flex items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-[12.5px] ${tab === id ? "bg-white/10 text-white" : "text-[#7d8aa0] hover:text-white"}`}>
              {icon} {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">{tab === "keybinds" ? <Keybinds /> : <General />}</div>
      </div>
    </Modal>
  );
}
