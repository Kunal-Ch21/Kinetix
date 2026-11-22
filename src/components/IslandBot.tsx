import { HelpCircle, MoreHorizontal, Search, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { kbAnswer } from "../lib/knowledge";
import { getHelpCard, type HelpCard } from "../lib/helpCards";
import { keyLabel, useKeybinds } from "../lib/keybinds";
import { setState, useStore } from "../state/store";
import { Robot, type BotMode } from "./Robot";

interface Msg {
  role: "bot" | "user";
  title?: string;
  text: string;
  tag?: string;
}

const GREETING: Msg = {
  role: "bot",
  title: "HI, I'M KINETIX BOT",
  text: "Turn on Inspect Mode (?) and hover or click any control and I'll explain it. Or ask me a question below — I answer from my built-in knowledge base, fully offline.",
};

export function IslandBot() {
  const open = useStore((s) => s.islandOpen);
  const inspect = useStore((s) => s.inspectMode);
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [mode, setMode] = useState<BotMode>("idle");
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState("");
  const [card, setCard] = useState<HelpCard | null>(null);
  useKeybinds();
  const [thinking, setThinking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  const lastEl = useRef<Element | null>(null);

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking]);

  // ----- inspect mode -----
  useEffect(() => {
    if (!inspect) {
      document.body.classList.remove("inspecting");
      lastEl.current?.classList.remove("inspect-outline");
      lastEl.current = null;
      setMode("idle");
      setLook({ x: 0, y: 0 });
      setCard(null);
      return;
    }
    document.body.classList.add("inspecting");

    const explain = (el: Element) => {
      const key = el.getAttribute("data-help")!;
      const entry = getHelpCard(key);
      if (!entry) return;
      if (lastEl.current !== el) {
        lastEl.current?.classList.remove("inspect-outline");
        el.classList.add("inspect-outline");
        lastEl.current = el;
        const r = el.getBoundingClientRect();
        const ir = rootRef.current?.getBoundingClientRect();
        if (ir) {
          const dx = r.left + r.width / 2 - (ir.left + ir.width / 2);
          const dy = r.top + r.height / 2 - ir.top;
          const l = Math.hypot(dx, dy) || 1;
          setLook({ x: Math.max(-1, Math.min(1, dx / 420)), y: Math.max(-1, Math.min(1, dy / l)) });
        }
        setMode("scan");
        later(() => setMode("point"), 650);
        later(() => setMode("idle"), 4200);
        setCard(entry);
      }
    };

    const over = (e: MouseEvent) => {
      const t = e.target as Element;
      if (rootRef.current?.contains(t)) return;
      const el = t.closest?.("[data-help]");
      if (el) explain(el);
    };
    const block = (e: Event) => {
      const t = e.target as Element;
      if (rootRef.current?.contains(t)) return;
      if (t.closest?.("[data-help]") || t.closest?.("canvas")) {
        e.preventDefault();
        e.stopPropagation();
        const el = t.closest("[data-help]");
        if (el && e.type === "click") explain(el);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState({ inspectMode: false });
    };
    document.addEventListener("mouseover", over, true);
    for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) document.addEventListener(ev, block, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mouseover", over, true);
      for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) document.removeEventListener(ev, block, true);
      window.removeEventListener("keydown", key);
    };
  }, [inspect]);

  // collapse on outside click (unless inspecting)
  useEffect(() => {
    if (!open || inspect) return;
    const h = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setState({ islandOpen: false });
    };
    window.addEventListener("pointerdown", h);
    return () => window.removeEventListener("pointerdown", h);
  }, [open, inspect]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const send = () => {
    const q = draft.trim();
    if (!q) return;
    setDraft("");
    setCard(null);
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setThinking(true);
    setMode("think");
    later(() => {
      const a = kbAnswer(q);
      setThinking(false);
      setMsgs((m) => [...m, { role: "bot", title: `${a.title}:`, text: a.text, tag: a.confident ? "offline KB" : undefined }]);
      setMode("talk");
      later(() => setMode("idle"), 1600);
    }, 550);
  };


  return (
    <div
      ref={rootRef}
      data-help="island"
      className="island absolute z-[70] left-1/2 -translate-x-1/2 top-[5px] overflow-hidden text-left"
      style={{
        width: open ? (card ? 400 : 340) : 270,
        height: open ? (card ? 420 : 286) : 36,
        borderRadius: open ? 26 : 18,
        background: "linear-gradient(180deg,#05080d,#070b12)",
        boxShadow: open
          ? "0 0 0 1.5px rgba(6,182,212,0.55), 0 0 26px rgba(6,182,212,0.28), 0 24px 60px rgba(0,0,0,0.65)"
          : "0 0 0 1px rgba(255,255,255,0.1), 0 0 14px rgba(6,182,212,0.12)",
      }}
    >
      {!open ? (
        <button className="w-full h-full flex items-center gap-2 pl-2 pr-3 cursor-pointer" onClick={() => setState({ islandOpen: true })}>
          <div className="w-[28px] h-[28px] flex items-center justify-center">
            <Robot size={26} mode="idle" />
          </div>
          <span className="flex-1 text-left text-[11.5px] text-[#aab4c7] truncate">Ask Kinetix · hover ? to explain any control</span>
          <Search size={13} className="text-[#7d8aa0]" />
          <HelpCircle size={14} className="text-[#7d8aa0]" />
        </button>
      ) : (
        <div className="w-full h-full flex flex-col anim-fade">
          <div className="relative h-[84px] flex-none">
            <div className="absolute left-4 top-3.5 flex gap-1.5 items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan" />
              <span className="w-2.5 h-2.5 rounded-full bg-cyan" />
              <span className="w-2.5 h-2.5 rounded-full bg-cyan" />
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 top-[10px] w-[112px] h-[68px] rounded-[22px] flex items-center justify-center" style={{ background: "#0a111b", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}>
              <Robot size={64} mode={mode} look={look} />
            </div>
            <div className="absolute right-3 top-2.5 flex items-center gap-1">
              <button className="ibtn sm" title="Search help" onClick={() => inputRef.current?.focus()}>
                <Search size={15} />
              </button>
              <button
                className="ibtn sm"
                data-help="inspect"
                data-active={inspect}
                title="Inspect Mode — explain any control"
                onClick={() => setState({ inspectMode: !inspect, islandOpen: true })}
              >
                <HelpCircle size={15} />
              </button>
              <button className="ibtn sm" title="Collapse" onClick={() => setState({ islandOpen: false, inspectMode: false })}>
                {inspect ? <X size={14} /> : <MoreHorizontal size={15} />}
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 flex flex-col gap-2.5" style={{ userSelect: "text" }}>
            {card && <CardView card={card} />}
            {!card && msgs.slice(-6).map((m, i, arr) =>
              m.role === "user" ? (
                <div key={i} className="self-end max-w-[85%] rounded-xl rounded-br-sm bg-blue/25 border border-blue/40 px-2.5 py-1.5 text-[12px] text-white">
                  {m.text}
                </div>
              ) : (
                <div key={i} className={`text-[12.5px] leading-[1.45] ${i === arr.length - 1 ? "text-[#e9eef7]" : "text-[#9aa6bb]"}`}>
                  {m.title && <span className="font-bold tracking-wide text-white">{m.title} </span>}
                  {m.text}
                  {m.tag && <span className="ml-1.5 mono text-[9px] text-cyan/80 border border-cyan/30 rounded px-1 py-px align-middle">{m.tag}</span>}
                </div>
              ),
            )}
            {thinking && (
              <div className="flex gap-1 py-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-cyan bot-dot" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            )}
            {inspect && !card && !thinking && (
              <div className="text-[11px] text-cyan/80">Inspect Mode on — hover any control. Esc to exit.</div>
            )}
          </div>

          <div className="px-3 pb-3 pt-1 flex-none">
            <div className="flex items-center gap-1 h-[34px] rounded-[10px] border border-cyan/45 bg-[#0a121c] pl-3 pr-1 shadow-[0_0_14px_rgba(6,182,212,0.15)]">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") send();
                }}
                placeholder="Contextual help or chat command..."
                className="flex-1 bg-transparent outline-none text-[12px] text-white placeholder:text-[#5c6a80] min-w-0"
                style={{ userSelect: "text" }}
              />
              <button className="ibtn sm" onClick={send} title="Send">
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Plain-English 3-part explainer: what it is · why / when to use it · pro tip + the user's active shortcut. */
function CardView({ card }: { card: HelpCard }) {
  const key = card.action ? keyLabel(card.action) : "";
  const Part = ({ n, color, title, children }: { n: number; color: string; title: string; children: string }) => (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-full text-[10px] font-bold text-[#05080d]" style={{ background: color }}>{n}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color }}>{title}</div>
        <div className="text-[12.5px] leading-[1.45] text-[#e9eef7]">{children}</div>
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-2.5 pb-1 anim-fade" style={{ userSelect: "text" }}>
      <div className="text-[13.5px] font-bold text-white">{card.title}</div>
      <Part n={1} color="#67e8f9" title="What it is">{card.what}</Part>
      <Part n={2} color="#F59E0B" title="Why & when to use it">{card.why}</Part>
      <Part n={3} color="#8FB8FF" title="Pro tip">{card.tip}</Part>
      {card.action && (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-[#aab4c7]">
          Your shortcut
          <kbd className="mono ml-auto rounded border border-white/20 bg-black/40 px-2 py-0.5 text-[11px] text-white">{key || "not set — Settings → Keybinds"}</kbd>
        </div>
      )}
    </div>
  );
}
