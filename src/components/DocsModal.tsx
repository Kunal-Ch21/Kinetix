import { Fragment, ReactNode, useState } from "react";
import chaptersJson from "@/docs/chapters.json";
import { Icon } from "./ui";

export interface Block {
  type: "p" | "h" | "ul" | "code" | "tip" | "recipe";
  text?: string;
  items?: string[];
  id?: string;
  title?: string;
  prompt?: string;
  ops?: unknown[];
}
export interface Chapter {
  id: string;
  title: string;
  badge?: string;
  blocks: Block[];
}
export const CHAPTERS = chaptersJson as unknown as Chapter[];
export const RECIPES = CHAPTERS.flatMap((c) => c.blocks.filter((b) => b.type === "recipe")) as (Block & { id: string; ops: unknown[] })[];

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<code key={k++} className="rounded border border-white/10 bg-[#161B26] px-1.5 py-px font-mono text-[12px] text-[#CFE8FF]">{m[1]}</code>);
    else if (m[2]) out.push(<strong key={k++} className="font-semibold text-white">{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k++}>{m[3]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((n, i) => <Fragment key={i}>{n}</Fragment>);
}

export function DocsModal({ onClose, onTry, embedded = false }: { onClose: () => void; onTry: (id: string) => void; embedded?: boolean }) {
  const [active, setActive] = useState(CHAPTERS[0].id);
  const ch = CHAPTERS.find((c) => c.id === active) ?? CHAPTERS[0];
  return (
    <div className={embedded ? "h-full" : "fixed inset-0 z-[90] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"} onPointerDown={embedded ? undefined : onClose}>
      <div onPointerDown={(e) => e.stopPropagation()} className={embedded ? "flex h-full w-full overflow-hidden" : "kx-glass flex h-[min(760px,92vh)] w-[min(1060px,96vw)] overflow-hidden rounded-2xl border border-white/10 shadow-2xl"}>
        <aside className="w-64 shrink-0 overflow-auto border-r border-white/[0.07] bg-[#0E1118] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Icon name="book" /> User Guide
          </div>
          {CHAPTERS.map((c) => (
            <button key={c.id} onClick={() => setActive(c.id)} className={`mb-0.5 block w-full rounded-lg px-3 py-2 text-left text-[12.5px] ${active === c.id ? "bg-[#3B82F6]/20 text-white" : "text-[#8B93A7] hover:bg-white/5 hover:text-white"}`}>
              {c.title}
            </button>
          ))}
          <a href="/docs/guide.html" target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[12px] text-[#9AA3B8] hover:bg-white/5 hover:text-white">
            <Icon name="link" size={13} /> Open standalone web guide
          </a>
        </aside>
        <article className="min-w-0 flex-1 overflow-auto p-8">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight text-white">{ch.title}</h2>
            <button onClick={onClose} aria-label="Close docs" className="rounded-md p-1 text-[#8B93A7] hover:bg-white/10 hover:text-white">
              <Icon name="x" />
            </button>
          </div>
          {ch.badge ? <div className="mt-2 inline-block rounded-full border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-2.5 py-1 font-mono text-[10.5px] text-[#F59E0B]">{ch.badge}</div> : null}
          <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-[#C3CADA]">
            {ch.blocks.map((b, i) => {
              switch (b.type) {
                case "p":
                  return <p key={i}>{inline(b.text ?? "")}</p>;
                case "h":
                  return <h3 key={i} className="pt-3 text-[15px] font-semibold text-[#06B6D4]">{inline(b.text ?? "")}</h3>;
                case "ul":
                  return (
                    <ul key={i} className="list-disc space-y-1 pl-5">
                      {(b.items ?? []).map((it, j) => (
                        <li key={j}>{inline(it)}</li>
                      ))}
                    </ul>
                  );
                case "code":
                  return <pre key={i} className="overflow-auto rounded-xl border border-white/10 bg-[#0A0D14] p-4 font-mono text-[12px] text-[#CFE8FF]">{b.text}</pre>;
                case "tip":
                  return (
                    <div key={i} className="rounded-r-xl border-l-2 border-[#3B82F6] bg-[#3B82F6]/[0.07] px-4 py-3">
                      <div className="mb-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">Tip</div>
                      {inline(b.text ?? "")}
                    </div>
                  );
                case "recipe":
                  return (
                    <div key={i} className="rounded-2xl border border-white/10 bg-[#161B26] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-[15px] font-semibold text-white">{b.title}</h4>
                        <button onClick={() => onTry(b.id!)} className="flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,.35)] hover:brightness-110">
                          <Icon name="wand" size={13} /> Try in Canvas
                        </button>
                      </div>
                      <p className="mt-2 text-[13px]"><span className="mr-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#F59E0B]">Prompt</span>{b.prompt}</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-[#8B93A7]">Show the {b.ops?.length} ops the model emits</summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-white/10 bg-[#0A0D14] p-3 font-mono text-[11px] text-[#CFE8FF]">{JSON.stringify(b.ops, null, 2)}</pre>
                      </details>
                    </div>
                  );
              }
            })}
          </div>
        </article>
      </div>
    </div>
  );
}
