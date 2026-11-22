import { ChevronDown, Clapperboard, MoreHorizontal, SendHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { cancelDirector, runDirector } from "../lib/director";
import { refreshStatus, useAiStatus, useBusy, useMicroContext } from "../lib/useAi";
import { setState, useStore } from "../state/store";
import { help } from "./ui";

/** Universal, context-aware quick actions — useful for motion graphics, logos/UI, kinetic type, explainers and characters. */
export const CHIPS = [
  { label: "Smooth ease-in-out", prompt: "Animate the selected object with a smooth ease-in-out move from its current spot to the right." },
  { label: "Cast rim light", prompt: "Cast a cool cyan rim light from top-left onto the selected object." },
  { label: "2× faster", prompt: "Make the selected animation twice as fast." },
  { label: "Kinetic text pop", prompt: "Add the text 'Your Title' with a pop effect, one word at a time." },
  { label: "Camera zoom in", prompt: "Slowly zoom the selected object in: scale it from 1 to 1.4 over 2 seconds with ease in out." },
  { label: "Clean bounce", prompt: "Animate the selected object with a clean spring bounce." },
  { label: "Sweep spotlight", prompt: "Sweep a warm spotlight beam across the selected object over 3 seconds." },
];

export function MicroPill({ onClick, open }: { onClick: () => void; open: boolean }) {
  const mc = useMicroContext();
  const pct = Math.min(100, (mc.tokens / mc.budget) * 100);
  return (
    <button
      onClick={onClick}
      {...help("token")}
      className="mono flex items-center gap-2 h-[26px] pl-1.5 pr-2.5 rounded-full border border-white/10 bg-[#141a26] hover:bg-[#1a2232] text-[11px] text-[#c6cfdf]"
    >
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
        <circle cx="8" cy="8" r="6" fill="none" stroke="#06B6D4" strokeWidth="2.5" strokeDasharray={`${(pct / 100) * 37.7} 37.7`} strokeLinecap="round" transform="rotate(-90 8 8)" />
      </svg>
      Micro-Context: {mc.tokens}/{mc.budget} tokens
      <ChevronDown size={12} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
    </button>
  );
}

export function Director() {
  const prompt = useStore((s) => s.prompt);
  const modal = useStore((s) => s.modal);
  const [open, setOpen] = useState(false);
  const mc = useMicroContext();
  const st = useAiStatus();
  const busy = useBusy();

  // Re-check the model status whenever a modal (Model Manager / Gate) closes.
  useEffect(() => {
    if (modal === null) void refreshStatus();
  }, [modal]);

  const ready = st.native && st.running && !!st.model;

  const send = () => {
    if (!prompt.trim() || busy) return;
    void runDirector();
  };

  return (
    <div className="relative w-[450px] flex-none" {...help("director")}>
      <div className="panel h-full">
        <div className="panel-title">
          <Clapperboard size={14} className="text-[#8a93a6]" />
          <span className="flex-1">AI Director</span>
          {ready ? (
            <span className="mono text-[9.5px] px-1.5 py-0.5 rounded border border-cyan/40 text-cyan bg-cyan/10 max-w-[170px] truncate" title={`Running locally on ${st.backend}`}>
              {busy ? "THINKING…" : st.model}
            </span>
          ) : (
            <span className="mono text-[9.5px] px-1.5 py-0.5 rounded border border-amber/40 text-amber/90 bg-amber/10">{st.native ? "NO MODEL" : "BROWSER"}</span>
          )}
          <MoreHorizontal size={14} className="text-[#6c7588]" />
        </div>
        <div className="px-2.5 flex-1 min-h-0 flex flex-col gap-2">
          <div className="rounded-lg border border-white/8 bg-[#131822] px-3 py-2 flex-1 min-h-0 flex flex-col relative">
            <div className="text-[9.5px] tracking-wider text-[#6c7588] font-medium">INTERACTOR PROMPT:</div>
            <textarea
              data-director-input
              data-help="director-input"
              value={prompt}
              onChange={(e) => setState({ prompt: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Describe a change… e.g. “Make the falcon fly across the sky with an amber rim light”"
              className="flex-1 min-h-0 resize-none bg-transparent outline-none text-[13px] leading-snug text-[#e6eaf2] placeholder:text-[#4f596c] pr-8"
              style={{ userSelect: "text" }}
            />
            <button
              className={`ibtn sm absolute right-1.5 bottom-1.5 !bg-blue/90 !text-white hover:!bg-blue ${busy ? "animate-pulse" : ""}`}
              title={busy ? "Working…" : "Send to AI Director (Enter)"}
              onClick={send}
              disabled={busy}
            >
              <SendHorizontal size={13} />
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" {...help("chips")}>
            {CHIPS.map((c) => (
              <button
                key={c.label}
                className="flex-none h-[22px] px-2.5 rounded-full text-[11px] text-[#aab4c7] border border-white/10 bg-white/[0.03] hover:bg-white/10 hover:text-white"
                onClick={() => setState({ prompt: c.prompt })}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="pb-2.5 flex items-center gap-2">
            <MicroPill open={open} onClick={() => setOpen(!open)} />
            {busy && (
              <button className="h-[22px] px-2.5 rounded-full text-[11px] text-amber border border-amber/40 bg-amber/10 hover:bg-amber/20" onClick={cancelDirector}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="absolute left-2 right-2 bottom-[44px] z-40 glass rounded-xl p-3 shadow-2xl anim-in max-h-[340px] overflow-auto" style={{ userSelect: "text" }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] font-semibold text-white">Micro-Context Token Inspector</span>
            <span className="mono text-[10px] text-cyan ml-auto">
              {mc.tokens} / {mc.budget} · num_ctx 1024 · temp 0.0
            </span>
          </div>
          <p className="text-[10.5px] text-[#7b8497] mb-2 leading-snug">
            Exactly what a stateless single-turn call contains: compact rules + filtered slice + your prompt. No history, ever.
            {mc.live ? (
              <span className="text-cyan/90"> Live from the Rust gatekeeper (SQLite).</span>
            ) : (
              <span className="text-amber/80"> Browser preview — the native shell runs the Rust gatekeeper.</span>
            )}
          </p>
          <div className="flex flex-col gap-1.5">
            {mc.sections.map((s) => (
              <div key={s.key} className="rounded-md border border-white/8 bg-black/30 px-2 py-1.5">
                <div className="text-[9px] tracking-wider text-[#6c7588] mb-0.5">{s.label}</div>
                <pre className="mono text-[10.5px] text-[#d4dbea] whitespace-pre-wrap break-words m-0 leading-snug">{s.text}</pre>
              </div>
            ))}
            {mc.summary && (
              <div className="rounded-md border border-white/8 bg-black/20 px-2 py-1.5">
                <div className="text-[9px] tracking-wider text-[#6c7588] mb-0.5">ACTIVITY SUMMARY · idle compactor (not sent to the model)</div>
                <pre className="mono text-[10.5px] text-[#9aa4b8] whitespace-pre-wrap break-words m-0 leading-snug">{mc.summary}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
