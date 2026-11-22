import { useEffect, useRef } from "react";
import { clamp, round3 } from "@/engine/math";
import type { Scene } from "@/engine/types";
import type { KeyRef } from "./helpers";
import { trackOwner } from "./helpers";
import type { MenuItem } from "./ui";
import { copyKey, deleteKey, pasteKey } from "@/state/store";
import { live, onLive } from "@/state/store";
import { keyLabel } from "@/lib/keybinds";
import { upsertKey } from "@/engine/anim";
import { evalObj } from "@/engine/rig";

const LABEL_W = 176;
const ROW_H = 20;

export function DopeSheet({
  scene,
  time,
  onSeek,
  commit,
  selKey,
  setSelKey,
  onMenu,
  onSelect,
}: {
  scene: Scene;
  time: number;
  onSeek: (t: number) => void;
  commit: (fn: (s: Scene) => void, coalesce?: string) => void;
  selKey: KeyRef | null;
  setSelKey: (k: KeyRef | null) => void;
  onMenu: (x: number, y: number, items: MenuItem[]) => void;
  onSelect: (id: string) => void;
}) {
  const lanes = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const headTxt = useRef<HTMLDivElement>(null);
  const D = scene.duration;
  // Playhead is driven straight from the 60 FPS clock via the DOM (≈15 Hz) — React never re-renders for it.
  useEffect(() => {
    const place = (t: number) => {
      if (headRef.current) headRef.current.style.left = `calc(${LABEL_W}px + (100% - ${LABEL_W + 6}px) * ${clamp(t / D, 0, 1)})`;
      if (headTxt.current) headTxt.current.textContent = t.toFixed(2);
    };
    place(live.t);
    return onLive(place);
  }, [D]);

  const rows: { owner: string; ownerLabel: string; prop: string; keys: { t: number; ease?: unknown }[]; first: boolean }[] = [];
  for (const o of [...scene.objects, ...scene.lights]) {
    let first = true;
    for (const tr of o.tracks) {
      if (!tr.keys.length) continue;
      rows.push({ owner: o.id, ownerLabel: o.label, prop: tr.prop, keys: tr.keys, first });
      first = false;
    }
  }

  const tFromX = (clientX: number) => {
    const r = lanes.current!.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * D, 0, D);
  };
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    onSeek(tFromX(e.clientX));
    const move = (ev: PointerEvent) => onSeek(tFromX(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const dragKey = (owner: string, prop: string, t0: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelKey({ owner, prop, t: t0 });
    onSelect(owner);
    let cur = t0;
    const move = (ev: PointerEvent) => {
      const nt = round3(Math.round(tFromX(ev.clientX) / 0.05) * 0.05);
      if (Math.abs(nt - cur) < 1e-4) return;
      const from = cur;
      let moved = false;
      commit((s) => {
        const tr = trackOwner(s, owner)?.tracks.find((x) => x.prop === prop);
        if (!tr) return;
        const k = tr.keys.find((x) => Math.abs(x.t - from) < 0.0005);
        if (!k || tr.keys.some((x) => x !== k && Math.abs(x.t - nt) < 0.0005)) return;
        k.t = nt;
        tr.keys.sort((a, b) => a.t - b.t);
        moved = true;
      }, `dragkey:${owner}:${prop}`);
      if (moved) {
        cur = nt;
        setSelKey({ owner, prop, t: nt });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const keyMenu = (owner: string, prop: string, t: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelKey({ owner, prop, t });
    const setEase = (ease: string | [number, number, number, number]) => () =>
      commit((s) => {
        const k = trackOwner(s, owner)?.tracks.find((x) => x.prop === prop)?.keys.find((x) => Math.abs(x.t - t) < 0.0005);
        if (k) k.ease = ease;
      });
    onMenu(e.clientX, e.clientY, [
      { label: "Go to keyframe", onClick: () => onSeek(t) },
      { label: "Add Keyframe at Playhead", shortcut: keyLabel("add_keyframe"), onClick: () => commit((s) => {
          const o = trackOwner(s, owner) && (s.objects.find((q) => q.id === owner) ?? null);
          if (o) upsertKey(o, prop, live.t, (evalObj(o, live.t) as unknown as Record<string, number>)[prop] ?? 0);
        }) },
      { label: "Copy Keyframe", shortcut: keyLabel("copy_keyframe"), onClick: () => copyKey({ owner, prop, t }) },
      { label: "Paste Keyframe at Playhead", shortcut: keyLabel("paste_keyframe"), onClick: () => pasteKey(owner) },
      { sep: true, label: "" },
      { label: "Ease: linear", onClick: setEase("linear") },
      { label: "Ease: in-out", onClick: setEase("ease_in_out") },
      { label: "Ease: spring", onClick: setEase("spring_bounce") },
      { label: "Ease: bounce", onClick: setEase("bounce") },
      { sep: true, label: "" },
      { label: "Delete keyframe", shortcut: keyLabel("delete_keyframe"), danger: true, onClick: () => deleteKey({ owner, prop, t }) },
    ]);
  };

  const ticks: number[] = [];
  const stepT = D > 30 ? 5 : D > 12 ? 2 : 1;
  for (let t = 0; t <= D + 1e-6; t += stepT) ticks.push(t);
  const pct = (t: number) => `${(t / D) * 100}%`;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* ruler + story flags */}
      <div className="flex shrink-0 border-b border-white/[0.07]" style={{ height: 40, paddingRight: 6 }}>
        <div style={{ width: LABEL_W }} className="shrink-0 border-r border-white/[0.07] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6F788D]">
          Story · Tracks
        </div>
        <div className="relative flex-1" ref={lanes}>
          <div className="absolute inset-x-0 top-0 h-[18px]">
            {scene.events.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onSeek(e.start)}
                title={`${e.id} | ${e.start.toFixed(1)}s–${e.end.toFixed(1)}s | ${e.title}`}
                className="absolute top-[2px] h-[14px] overflow-hidden whitespace-nowrap rounded-[4px] border border-[#06B6D4]/40 bg-[#06B6D4]/15 px-1.5 text-left text-[9.5px] leading-[12px] text-[#8DE3F2] hover:bg-[#06B6D4]/25"
                style={{ left: pct(e.start), width: `calc(${pct(e.end - e.start)} - 2px)` }}
              >
                {e.title}
              </button>
            ))}
          </div>
          <div data-help="dopesheet-ruler" className="absolute inset-x-0 bottom-0 h-[20px] cursor-col-resize" onPointerDown={scrub}>
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full border-l border-white/10 pl-1 font-mono text-[9.5px] text-[#6F788D]" style={{ left: pct(t) }}>
                {t}s
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* rows */}
      <div data-help="dopesheet-tracks" className="kx-scroll relative min-h-0 flex-1 overflow-x-hidden" style={{ overflowY: "scroll" }}>
        {rows.length === 0 ? <div className="p-4 text-xs text-[#6F788D]">No keyframes yet. Select an object and press “Key transform” in the inspector, or run an <span className="font-mono">animate</span> op.</div> : null}
        {rows.map((r) => (
          <div key={r.owner + r.prop} className="flex border-b border-white/[0.04]" style={{ height: ROW_H }}>
            <button
              type="button"
              onClick={() => onSelect(r.owner)}
              style={{ width: LABEL_W }}
              className="shrink-0 truncate border-r border-white/[0.07] px-3 text-left text-[11px] text-[#98A1B6] hover:text-white"
            >
              {r.first ? <span className="text-[#D5DBE8]">{r.ownerLabel}</span> : <span className="opacity-0">{r.ownerLabel}</span>}
              <span className="ml-1.5 font-mono text-[10px] text-[#6F788D]">{r.prop}</span>
            </button>
            <div className="relative flex-1" onPointerDown={scrub}>
              {r.keys.map((k) => {
                const sel = selKey && selKey.owner === r.owner && selKey.prop === r.prop && Math.abs(selKey.t - k.t) < 0.0005;
                return (
                  <button
                    key={k.t}
                    type="button"
                    aria-label={`${r.ownerLabel} ${r.prop} keyframe at ${k.t}s`}
                    data-help="keyframe"
                    onPointerDown={dragKey(r.owner, r.prop, k.t)}
                    onContextMenu={keyMenu(r.owner, r.prop, k.t)}
                    className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-grab rounded-[2px] border"
                    style={{
                      left: pct(k.t),
                      background: sel ? "#FFD27A" : "#F59E0B",
                      borderColor: sel ? "#fff" : "#7C4A00",
                      boxShadow: sel ? "0 0 10px rgba(245,158,11,.9)" : "none",
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {/* playhead */}
      <div ref={headRef} className="pointer-events-none absolute bottom-0 top-0" style={{ left: `calc(${LABEL_W}px + (100% - ${LABEL_W + 6}px) * ${clamp(time / D, 0, 1)})` }}>
        <div className="h-full w-px bg-[#3B82F6] shadow-[0_0_8px_rgba(59,130,246,.9)]" />
        <div ref={headTxt} className="absolute -top-0 -translate-x-1/2 rounded-b bg-[#3B82F6] px-1 font-mono text-[9px] text-white">{time.toFixed(2)}</div>
      </div>
    </div>
  );
}
