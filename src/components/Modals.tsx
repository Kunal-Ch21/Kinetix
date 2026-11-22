import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { runDirector } from "../lib/director";
import { useBusy } from "../lib/useAi";
import { setModal, setState, useStore } from "../state/store";
import { CHIPS } from "./Director";
import { HelpHub } from "./HelpHub";

export function Modal({ title, icon, onClose, children, width = 640 }: { title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center anim-fade" style={{ background: "rgba(3,5,9,0.62)", backdropFilter: "blur(5px)" }} onPointerDown={onClose}>
      <div className="glass rounded-2xl shadow-[0_30px_90px_rgba(0,0,0,0.7)] anim-in flex flex-col max-h-[88vh] max-w-[94vw]" style={{ width, background: "rgba(16,20,30,0.92)" }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 h-[52px] flex-none hairline-b">
          <span className="text-cyan flex">{icon}</span>
          <span className="text-[14px] font-semibold text-white">{title}</span>
          <button className="ibtn sm ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="overflow-auto flex-1 min-h-0">{children}</div>
      </div>
    </div>
  );
}

export function DocsModal() {
  return <HelpHub />;
}

/** Zen-mode Ctrl+K spotlight: same Director pipeline (gate → Rust gatekeeper → LLM → ripple → applyOps). */
export function SpotlightModal() {
  const prompt = useStore((s) => s.prompt);
  const busy = useBusy();
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[16vh] anim-fade" style={{ background: "rgba(3,5,9,0.5)", backdropFilter: "blur(4px)" }} onPointerDown={() => setModal(null)}>
      <div className="glass rounded-2xl w-[620px] max-w-[92vw] p-3 anim-in shadow-[0_30px_90px_rgba(0,0,0,0.7)]" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-2 h-[46px]">
          <Search size={18} className="text-cyan" />
          <input
            autoFocus
            value={prompt}
            onChange={(e) => setState({ prompt: e.target.value })}
            placeholder={busy ? "Director is thinking…" : "Tell the AI Director what to do…"}
            className="flex-1 bg-transparent outline-none text-[16px] text-white placeholder:text-[#566074]"
            style={{ userSelect: "text" }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && prompt.trim()) void runDirector();
              if (e.key === "Escape") setModal(null);
            }}
          />
          <span className="mono text-[10px] text-[#7b8497] border border-white/10 rounded px-1.5 py-0.5">Ctrl K</span>
        </div>
        <div className="flex gap-1.5 flex-wrap px-2 pb-1.5 pt-1">
          {CHIPS.map((c) => (
            <button key={c.label} className="h-6 px-2.5 rounded-full text-[11.5px] text-[#aab4c7] border border-white/10 hover:bg-white/10 hover:text-white" onClick={() => setState({ prompt: c.prompt })}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
