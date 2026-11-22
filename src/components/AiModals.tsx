import { Check, Cpu, Download, FolderOpen, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ai, type PullInfo } from "../lib/ai";
import { runDirector } from "../lib/director";
import { refreshStatus, useAiStatus } from "../lib/useAi";
import { setModal, useStore } from "../state/store";

/**
 * Milestone 2 — In-App Model Manager + Missing-Model Gate.
 * Exported under the same names as the Milestone-1 placeholders (GateModal / ModelsModal) so App.tsx only
 * needs its import line pointed at this file.
 */

const TIERS = [
  {
    id: "qwen2.5:1.5b",
    name: "Low-End / Ultra-Fast",
    hw: "4–8 GB RAM · CPU only",
    size: "~1.1 GB",
    note: "Fastest replies, best for simple moves, colours and timing.",
  },
  {
    id: "llama3.2:3b",
    name: "Balanced · Recommended",
    hw: "Ryzen 7 7735HS · 16 GB RAM · Radeon 680M",
    size: "~2.0 GB · Q4_K_M",
    note: "Best speed / accuracy trade-off for this laptop.",
    recommended: true,
  },
  {
    id: "qwen2.5-coder:7b",
    name: "High Precision",
    hw: "32 GB RAM · dedicated GPU",
    size: "~4.7 GB",
    note: "Most reliable for custom Bézier geometry and assemblies.",
  },
] as const;

function Shell({ title, onClose, width, children }: { title: string; onClose: () => void; width: number; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center anim-fade"
      style={{ background: "rgba(3,5,9,0.55)", backdropFilter: "blur(4px)" }}
      onPointerDown={onClose}
    >
      <div
        className="glass rounded-2xl max-w-[94vw] max-h-[90vh] flex flex-col overflow-hidden anim-in shadow-[0_30px_90px_rgba(0,0,0,0.7)]"
        style={{ width }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 h-12 px-4 border-b border-white/8 flex-none">
          <Cpu size={17} className="text-cyan" />
          <span className="text-[14px] font-semibold text-white flex-1">{title}</span>
          <button className="ibtn sm" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>
        <div className="overflow-auto p-4 flex flex-col gap-3" style={{ userSelect: "text" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

const mb = (n: number) => `${Math.round(n / 1048576)} MB`;

function ProgressBar({ info }: { info: PullInfo }) {
  const pct = info.total > 0 ? Math.min(100, (info.completed / info.total) * 100) : 0;
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full bg-blue transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mono text-[10.5px] text-[#9aa4b8] mt-1 flex justify-between">
        <span>{info.total > 0 ? `${mb(info.completed)} / ${mb(info.total)}` : info.status || "preparing…"}</span>
        <span>{info.total > 0 ? `${pct.toFixed(0)}%` : ""}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ AI Engine manager */

export function ModelsModal() {
  const status = useAiStatus();
  const [pull, setPull] = useState<PullInfo | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("auto");
  const [registering, setRegistering] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const wasActive = useRef(false);

  useEffect(() => {
    if (!status.native) return;
    let dead = false;
    const tick = async () => {
      try {
        const p = await ai.pullProgress();
        if (dead) return;
        setPull(p);
        if (wasActive.current && !p.active) {
          wasActive.current = false;
          if (p.error) setMsg({ ok: false, text: p.error });
          else if (p.done) setMsg({ ok: true, text: `${p.name} installed` });
          void refreshStatus();
        }
        if (p.active) wasActive.current = true;
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(tick, 600);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [status.native]);

  const downloading = !!pull?.active;
  const startPull = (id: string) => {
    setMsg(null);
    ai.pull(id).catch((e) => setMsg({ ok: false, text: String(e) }));
  };
  const selectModel = (m: string) => {
    ai.setModel(m)
      .then(() => refreshStatus())
      .catch((e) => setMsg({ ok: false, text: String(e) }));
  };
  const browse = async () => {
    try {
      const p = await ai.pickGguf();
      if (p) {
        setPath(p);
        if (!name) {
          const stem = p.split(/[\\/]/).pop()?.replace(/\.gguf$/i, "") ?? "model";
          setName(`kinetix-${stem}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 48));
        }
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };
  const register = async () => {
    if (!path) return;
    setRegistering(true);
    setMsg(null);
    try {
      const n = await ai.registerGguf(path, name, template);
      setMsg({ ok: true, text: `Registered “${n}” with Ollama and selected it` });
      void refreshStatus();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setRegistering(false);
    }
  };

  return (
    <Shell title="Settings · AI Engine" onClose={() => setModal(null)} width={760}>
      {/* engine status */}
      <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-black/25 px-3 py-2">
        <span className={`w-2 h-2 rounded-full ${status.running ? "bg-[#22c55e]" : "bg-amber"}`} />
        <span className="text-[12.5px] text-[#d5dcec] flex-1">
          {!status.native
            ? "Browser preview — run the native Kinetix Studio shell to manage local models."
            : status.running
              ? status.backend === "llamacpp"
                ? "llama.cpp server running on 127.0.0.1:8080"
                : `Ollama running on 127.0.0.1:11434 · ${status.models.length} model${status.models.length === 1 ? "" : "s"} installed`
              : "No local engine detected. Install & start Ollama (ollama.com), then download a model below."}
        </span>
        <span className="mono text-[10px] text-[#7b8497]">num_ctx 1024 · temp 0.0 · JSON-schema decoding</span>
      </div>

      {/* installed models */}
      {status.native && status.models.length > 0 && (
        <div>
          <div className="text-[10px] tracking-wider text-[#6c7588] mb-1.5">INSTALLED</div>
          <div className="flex flex-col gap-1.5">
            {status.models.map((m) => (
              <div key={m} className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-1.5">
                <span className="mono text-[12px] text-white flex-1 truncate">{m}</span>
                {status.model === m ? (
                  <span className="flex items-center gap-1 text-[11px] text-cyan">
                    <Check size={12} /> In use
                  </span>
                ) : (
                  <button className="h-6 px-2.5 rounded-md text-[11px] border border-white/10 hover:bg-white/10 text-[#c6cfdf]" onClick={() => selectModel(m)}>
                    Use this model
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* recommended tiers */}
      <div>
        <div className="text-[10px] tracking-wider text-[#6c7588] mb-1.5">RECOMMENDED BY HARDWARE TIER · ONE-CLICK DOWNLOAD (OLLAMA /api/pull)</div>
        <div className="grid grid-cols-3 gap-2">
          {TIERS.map((t) => {
            const installed = status.models.includes(t.id);
            const mine = pull?.active && pull.name === t.id;
            return (
              <div
                key={t.id}
                className={`rounded-xl border px-3 py-2.5 flex flex-col gap-1 ${"recommended" in t && t.recommended ? "border-blue/60 bg-blue/10" : "border-white/8 bg-white/[0.03]"}`}
              >
                <div className="text-[12px] font-semibold text-white">{t.name}</div>
                <div className="mono text-[11px] text-cyan">{t.id}</div>
                <div className="text-[10.5px] text-[#8a93a6] leading-snug">{t.hw}</div>
                <div className="text-[10.5px] text-[#8a93a6]">{t.size}</div>
                <div className="text-[10.5px] text-[#aab4c7] leading-snug flex-1">{t.note}</div>
                {mine && pull ? (
                  <>
                    <ProgressBar info={pull} />
                    <button className="mt-1 h-6 rounded-md text-[11px] border border-white/10 hover:bg-white/10 text-[#c6cfdf]" onClick={() => void ai.pullCancel()}>
                      Cancel
                    </button>
                  </>
                ) : installed ? (
                  <button
                    className="mt-1 h-7 rounded-md text-[11.5px] border border-white/10 hover:bg-white/10 text-white flex items-center justify-center gap-1"
                    onClick={() => selectModel(t.id)}
                    disabled={!status.native}
                  >
                    <Check size={13} /> {status.model === t.id ? "In use" : "Use"}
                  </button>
                ) : (
                  <button
                    className="mt-1 h-7 rounded-md text-[11.5px] bg-blue/90 hover:bg-blue text-white flex items-center justify-center gap-1 disabled:opacity-40"
                    onClick={() => startPull(t.id)}
                    disabled={!status.native || downloading}
                  >
                    <Download size={13} /> Download
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* bring your own gguf */}
      <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
        <div className="text-[12px] font-semibold text-white mb-0.5">Bring your own model (.gguf)</div>
        <div className="text-[10.5px] text-[#8a93a6] mb-2 leading-snug">
          Pick any .gguf on your drive. Kinetix writes a Modelfile (num_ctx 1024, temperature 0) and registers it with Ollama — no terminal needed.
        </div>
        <div className="flex items-center gap-2">
          <button
            className="h-7 px-2.5 rounded-md text-[11.5px] border border-white/10 hover:bg-white/10 text-white flex items-center gap-1 flex-none disabled:opacity-40"
            onClick={browse}
            disabled={!status.native}
          >
            <FolderOpen size={13} /> Browse .gguf
          </button>
          <div className="mono text-[11px] text-[#9aa4b8] truncate flex-1 min-w-0">{path || "No file selected"}</div>
        </div>
        {path && (
          <div className="flex items-center gap-2 mt-2">
            <input
              className="field mono flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="model name, e.g. kinetix-my-model"
            />
            <select className="field" style={{ width: 150 }} value={template} onChange={(e) => setTemplate(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
              <option value="auto">Template: auto</option>
              <option value="chatml">Template: ChatML</option>
              <option value="llama3">Template: Llama 3</option>
            </select>
            <button
              className="h-7 px-3 rounded-md text-[11.5px] bg-blue/90 hover:bg-blue text-white flex-none disabled:opacity-40"
              onClick={register}
              disabled={registering}
            >
              {registering ? "Registering…" : "Register"}
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div className={`rounded-lg px-3 py-2 text-[11.5px] whitespace-pre-wrap border ${msg.ok ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-amber/40 bg-amber/10 text-amber"}`}>
          {msg.text}
        </div>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ Missing-model gate */

export function GateModal() {
  const prompt = useStore((s) => s.prompt);
  const status = useAiStatus();
  const [checking, setChecking] = useState(true);

  // Opened by Send / Ctrl+K. If a model is actually ready, close and run the prompt right away.
  useEffect(() => {
    let dead = false;
    ai.status()
      .then((s) => {
        if (dead) return;
        if (s.native && s.running && s.model) {
          setModal(null);
          void runDirector();
        } else setChecking(false);
      })
      .catch(() => {
        if (!dead) setChecking(false);
      });
    return () => {
      dead = true;
    };
  }, []);

  const download = (id: string) => {
    ai.pull(id).catch(() => undefined);
    setModal("models");
  };

  return (
    <Shell title="No local AI model ready" onClose={() => setModal(null)} width={600}>
      {checking ? (
        <div className="text-[12.5px] text-[#9aa4b8] py-6 text-center">Checking for a local model…</div>
      ) : (
        <>
          <div className="text-[12.5px] text-[#c3cbdb] leading-relaxed">
            {status.native
              ? "The AI Director needs a local model. Everything stays on this machine — pick a tier to download (about a minute on broadband) or load your own .gguf."
              : "The local AI runs in the native Kinetix Studio shell (npx tauri dev, or the installed app). This browser preview cannot reach Ollama or llama.cpp."}
          </div>
          {prompt.trim() && (
            <div className="rounded-lg border border-white/8 bg-black/25 px-3 py-2 text-[12px] text-[#aab4c7]">
              <span className="text-[9.5px] tracking-wider text-[#6c7588] block mb-0.5">YOUR PROMPT (kept — press Send again once a model is ready)</span>
              {prompt}
            </div>
          )}
          {status.native && (
            <div className="flex flex-col gap-2">
              {TIERS.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${"recommended" in t && t.recommended ? "border-blue/60 bg-blue/10" : "border-white/8 bg-white/[0.03]"}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-white">{t.name}</div>
                    <div className="mono text-[11px] text-cyan">
                      {t.id} <span className="text-[#7b8497]">· {t.size}</span>
                    </div>
                    <div className="text-[10.5px] text-[#8a93a6]">{t.hw}</div>
                  </div>
                  <button className="h-7 px-3 rounded-md text-[11.5px] bg-blue/90 hover:bg-blue text-white flex items-center gap-1 flex-none" onClick={() => download(t.id)}>
                    <Download size={13} /> Download
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 justify-end">
            {status.native && (
              <button className="h-8 px-3 rounded-md text-[12px] border border-white/10 hover:bg-white/10 text-white flex items-center gap-1" onClick={() => setModal("models")}>
                <FolderOpen size={14} /> Browse .gguf / AI Engine settings
              </button>
            )}
            <button className="h-8 px-3 rounded-md text-[12px] border border-white/10 hover:bg-white/10 text-[#c6cfdf]" onClick={() => setModal(null)}>
              Close
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}
