// Bottom dock: transport bar + Story Event flag track + multi-track dope sheet.
import { Layers, Pause, Play, Repeat, SkipBack } from "lucide-react";
import { openMenu } from "../lib/menu";
import { useEffect, useRef } from "react";
import { commit, live, onLive, select, setState, setTime, togglePlay, useStore } from "../state/store";
import { tip, useKeybinds } from "../lib/keybinds";
import { fmtTime } from "./helpers";
import { DopeSheet } from "./DopeSheet";
import { help } from "./ui";

/** Timecode that updates its text node directly from the live clock (≈15 Hz) — zero React renders during playback. */
export function TimeCode() {
  const D = useStore((s) => s.scene.duration);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const set = (t: number) => {
      if (ref.current) ref.current.textContent = fmtTime(t);
    };
    set(live.t);
    return onLive(set);
  }, []);
  return (
    <span className="mono text-[12px] tabular-nums text-white">
      <span ref={ref}>{fmtTime(live.t)}</span> <span className="text-[#6F788D]">/ {fmtTime(D)}</span>
    </span>
  );
}

export function Timeline() {
  const scene = useStore((s) => s.scene);
  useKeybinds();
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loop);
  const onion = useStore((s) => s.onion);
  const snap = useStore((s) => s.snap);
  const selKey = useStore((s) => s.selKey);
  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-white/[0.07] bg-[#0E1118]" data-help="timeline">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/[0.07] px-2">
        <button className="ibtn" title={tip("Go to start", "jump_start")} onClick={() => setTime(0)}><SkipBack size={15} /></button>
        <button className="ibtn" data-active={playing} title={tip("Play / Pause", "play_pause")} {...help("transport")} onClick={togglePlay}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <button className="ibtn" data-help="loop" data-active={loop} title={tip("Loop", "loop_toggle")} onClick={() => setState({ loop: !loop })}><Repeat size={14} /></button>
        <button className="ibtn" data-active={onion} title={tip("Onion skin", "onion_toggle")} {...help("onion")} onClick={() => setState({ onion: !onion })}><Layers size={14} /></button>
        <button data-help="snap" className={`tbtn !h-[24px] !px-2 ${snap ? "primary" : ""}`} title={tip("Snap to grid", "toggle_snap")} onClick={() => setState({ snap: !snap })}>Snap</button>
        <div className="ml-3"><TimeCode /></div>
        <div className="mono ml-auto flex items-center gap-3 text-[10.5px] text-[#6F788D]">
          <button type="button" data-help="story-flag" className="tbtn !h-[24px] !px-2" onClick={() => commit((s) => void s.events.push({ id: `ev_${String(++s.seq).padStart(2, "0")}`, start: live.t, end: Math.min(s.duration, live.t + 1.5), title: "New Event" }), undefined, "Add story event")}>+ Story flag</button>
          <label className="flex items-center gap-1">dur
            <input data-help="duration" type="number" min={1} max={120} value={scene.duration} onChange={(e) => commit((s) => void (s.duration = Math.max(1, Math.min(120, parseFloat(e.target.value) || 10))), "dur", "Duration")} className="field !h-[22px] !w-12 text-right" />s
          </label>
          <span>{scene.fps} fps</span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <DopeSheet scene={scene} time={time} onSeek={setTime} commit={commit} selKey={selKey} setSelKey={(k) => setState({ selKey: k })} onMenu={openMenu} onSelect={(id) => select([id])} />
      </div>
    </section>
  );
}
