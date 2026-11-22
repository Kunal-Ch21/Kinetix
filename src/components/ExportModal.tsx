import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { CircleAlert, CircleCheck, Download, FileCode2, FileJson, FileVideo, Film, FolderOpen, ImageIcon, Images, Info, Loader } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { sceneToSvg } from "../export/svg";
import {
  ExportCancelled,
  ExportProgress,
  ExportResult,
  FfmpegInfo,
  NativeExportError,
  asExportError,
  probeFfmpeg,
  renderStill,
  runExport,
} from "../export/exporter";
import { ExportFormat, FPS_CHOICES, ResolutionPreset, aspectDiffers, formatBytes, formatClock, frameBytes, planFrames, resolutionFor, safeName } from "../export/plan";
import { invoke, isTauri } from "../lib/native";
import { download, getState, live, setModal, setState, toast, useStore } from "../state/store";
import { Modal } from "./Modals";

type Fmt = ExportFormat | "still";

const FORMATS: { id: Fmt; title: string; sub: string; icon: ReactNode; native: boolean }[] = [
  { id: "mp4", title: "MP4", sub: "H.264 · yuv420p · faststart", icon: <FileVideo size={18} />, native: true },
  { id: "gif", title: "GIF", sub: "Palette-optimised, looping", icon: <Film size={18} />, native: true },
  { id: "png", title: "PNG sequence", sub: "frame_0000.png … into a folder", icon: <Images size={18} />, native: true },
  { id: "svg", title: "SVG", sub: "Vector snapshot at the playhead", icon: <FileCode2 size={18} />, native: false },
  { id: "json", title: "Scene JSON", sub: "Whole project (.kinetix.json)", icon: <FileJson size={18} />, native: false },
  { id: "still", title: "PNG still", sub: "One frame at the playhead", icon: <ImageIcon size={18} />, native: false },
];

const EXT: Record<string, { ext: string; name: string }> = {
  mp4: { ext: "mp4", name: "MP4 video" },
  gif: { ext: "gif", name: "GIF animation" },
  svg: { ext: "svg", name: "SVG image" },
  json: { ext: "json", name: "Kinetix scene" },
  still: { ext: "png", name: "PNG image" },
};

interface Prefs {
  format: Fmt;
  preset: ResolutionPreset;
  cw: number;
  ch: number;
  fps: number;
  crf: number;
  speed: string;
  loop: boolean;
}
const PREFS_KEY = "kinetix.export.v1";
const loadPrefs = (sceneFps: number): Prefs => {
  const d: Prefs = { format: "mp4", preset: "1080p", cw: 1920, ch: 1080, fps: (FPS_CHOICES as readonly number[]).includes(sceneFps) ? sceneFps : 60, crf: 18, speed: "veryfast", loop: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...d, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* ignore */
  }
  return d;
};

function Seg<T extends string | number>({ value, options, onChange, help }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; help?: string }) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-black/25 p-0.5" data-help={help}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" onClick={() => onChange(o.value)} className={`h-7 px-3 rounded-md text-[12px] font-medium transition ${o.value === value ? "bg-[#3B82F6] text-white shadow-[0_0_14px_rgba(59,130,246,.35)]" : "text-[#9AA3B8] hover:text-white"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-3 min-h-[32px]" data-help={help}>
      <span className="text-[11.5px] text-[#8B93A7]">{label}</span>
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}

const numCls = "field mono !w-[78px] !h-7 text-[12px]";

async function imageSrc(id: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string>("read_asset_data_url", { id });
    } catch {
      /* fall back to the asset's own URL */
    }
  }
  return getState().assets.find((a) => a.id === id)?.src ?? null;
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function ExportModal() {
  const scene = useStore((s) => s.scene);
  const [p, setP] = useState<Prefs>(() => loadPrefs(getState().scene.fps));
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(scene.duration);
  const [prefix, setPrefix] = useState("frame");
  const [outPath, setOutPath] = useState("");
  const [ff, setFf] = useState<FfmpegInfo | null>(null);
  const [run, setRun] = useState<{ status: "idle" | "running" | "done" | "error"; progress?: ExportProgress; result?: ExportResult; error?: NativeExportError; cancelling?: boolean; what?: string }>({ status: "idle" });
  const ctl = useRef({ cancelled: false });
  const native = isTauri();
  const running = run.status === "running";
  const wasPlaying = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }, [p]);
  useEffect(() => {
    if (native) probeFfmpeg().then(setFf).catch(() => setFf({ found: false, path: null, version: null, source: null, h264: false, message: "Could not query FFmpeg." }));
  }, [native]);
  useEffect(() => {
    setOutPath("");
  }, [p.format]);

  const fmt = FORMATS.find((f) => f.id === p.format)!;
  const isRender = p.format === "mp4" || p.format === "gif" || p.format === "png";
  const res = resolutionFor(p.preset, scene, { width: p.cw, height: p.ch });
  const plan = planFrames(start, end, p.fps, scene.duration);
  const needsFfmpeg = p.format === "mp4" || p.format === "gif";
  const ffBlocked = native && needsFfmpeg && ff && (!ff.found || (p.format === "mp4" && !ff.h264));
  const nativeOnly = !native && fmt.native;
  const stillRes = res;

  const set = (patch: Partial<Prefs>) => setP((q) => ({ ...q, ...patch }));

  const pickPath = async (): Promise<string | null> => {
    const base = safeName(scene.name);
    try {
      if (p.format === "png") {
        const dir = await openDialog({ directory: true, multiple: false, title: "Choose a folder for the PNG sequence" });
        return typeof dir === "string" ? dir : null;
      }
      const e = EXT[p.format];
      const f = await saveDialog({ title: `Export ${e.name}`, defaultPath: `${base}.${e.ext}`, filters: [{ name: e.name, extensions: [e.ext] }] });
      return f ?? null;
    } catch (err) {
      setRun({ status: "error", error: asExportError(err) });
      return null;
    }
  };

  const browse = async () => {
    const f = await pickPath();
    if (f) setOutPath(f);
  };

  const fail = (e: unknown) => setRun({ status: "error", error: asExportError(e) });

  const startRender = async () => {
    if (!plan) return setRun({ status: "error", error: { code: "invalid", message: "The export range is empty — the end must be later than the start." } });
    let target = outPath;
    if (!target) {
      const f = await pickPath();
      if (!f) return;
      setOutPath(f);
      target = f;
    }
    ctl.current = { cancelled: false };
    wasPlaying.current = getState().playing;
    setState({ playing: false });
    setRun({ status: "running", progress: { phase: "preparing", stage: "Preparing assets", framesDone: 0, total: plan.count, bytesWritten: 0, elapsedMs: 0, etaMs: null } });
    try {
      const result = await runExport(
        getState().scene,
        { format: p.format as "mp4" | "gif" | "png", width: res.width, height: res.height, fps: p.fps, start, end, outPath: target, crf: p.crf, preset: p.speed, loopGif: p.loop, prefix },
        imageSrc,
        (progress) => setRun((r) => (r.status === "running" ? { ...r, progress } : r)),
        ctl.current,
      );
      setRun({ status: "done", result });
      toast(`Exported ${result.frames} frames · ${formatBytes(result.bytes)}`);
    } catch (e) {
      if (e instanceof ExportCancelled) {
        setRun({ status: "idle" });
        toast("Export cancelled — temporary files removed");
      } else fail(e);
    } finally {
      if (wasPlaying.current) setState({ playing: true });
    }
  };

  const cancel = () => {
    ctl.current.cancelled = true;
    setRun((r) => ({ ...r, cancelling: true }));
  };

  const quick = async () => {
    const sc = getState().scene;
    const t = live.t;
    const base = safeName(sc.name);
    setRun({ status: "running", what: "Rendering…" });
    try {
      if (p.format === "json") {
        const json = JSON.stringify(sc, null, 1);
        if (native) {
          const f = await saveDialog({ title: "Export scene JSON", defaultPath: `${base}.kinetix.json`, filters: [{ name: "Kinetix scene", extensions: ["json"] }] });
          if (!f) return setRun({ status: "idle" });
          const bytes = await invoke<number>("export_write_text", { path: f, content: json });
          setRun({ status: "done", result: { path: f, bytes, frames: 1, elapsedMs: 0 } });
        } else {
          download(`${base}.kinetix.json`, "application/json", json);
          setRun({ status: "done", result: { path: `${base}.kinetix.json (downloaded)`, bytes: json.length, frames: 1, elapsedMs: 0 } });
        }
      } else if (p.format === "svg") {
        const sources = new Map<string, string>();
        for (const o of sc.objects) if (o.image && !sources.has(o.image)) sources.set(o.image, (await imageSrc(o.image)) ?? "");
        const svg = sceneToSvg(sc, t, (id) => sources.get(id) || null);
        if (native) {
          const f = await saveDialog({ title: "Export SVG", defaultPath: `${base}.svg`, filters: [{ name: "SVG image", extensions: ["svg"] }] });
          if (!f) return setRun({ status: "idle" });
          const bytes = await invoke<number>("export_write_text", { path: f, content: svg });
          setRun({ status: "done", result: { path: f, bytes, frames: 1, elapsedMs: 0 } });
        } else {
          download(`${base}.svg`, "image/svg+xml", svg);
          setRun({ status: "done", result: { path: `${base}.svg (downloaded)`, bytes: svg.length, frames: 1, elapsedMs: 0 } });
        }
      } else {
        const bytes = await renderStill(sc, t, stillRes.width, stillRes.height, imageSrc);
        if (native) {
          const f = await saveDialog({ title: "Export PNG", defaultPath: `${base}_${t.toFixed(2)}s.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
          if (!f) return setRun({ status: "idle" });
          const n = await invoke<number>("export_write_base64", { path: f, data: b64(bytes) });
          setRun({ status: "done", result: { path: f, bytes: n, frames: 1, elapsedMs: 0 } });
        } else {
          download(`${base}_${t.toFixed(2)}s.png`, "image/png", bytes as BlobPart);
          setRun({ status: "done", result: { path: `${base}.png (downloaded)`, bytes: bytes.length, frames: 1, elapsedMs: 0 } });
        }
      }
    } catch (e) {
      fail(e);
    }
  };

  const pr = run.progress;
  const pct = pr && pr.total ? Math.min(100, Math.round((pr.framesDone / pr.total) * 100)) : 0;
  const err = run.error;

  return (
    <Modal title="Export" icon={<Download size={17} />} onClose={() => (running ? toast("Cancel the export first") : setModal(null))} width={640}>
      <div className="p-4 flex flex-col gap-3.5" data-help="export-dialog">
        {/* ---------- format cards ---------- */}
        <div className="grid grid-cols-3 gap-2" data-help="export-format">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={running}
              onClick={() => {
                set({ format: f.id });
                setRun({ status: "idle" });
              }}
              className={`flex items-center gap-2.5 text-left rounded-xl border px-3 py-2.5 transition disabled:opacity-50 ${p.format === f.id ? "border-[#3B82F6]/70 bg-[#3B82F6]/12 shadow-[0_0_20px_rgba(59,130,246,.18)]" : "border-white/10 hover:border-white/25 hover:bg-white/[0.04]"}`}
            >
              <span className={p.format === f.id ? "text-cyan" : "text-[#7b8497]"}>{f.icon}</span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-white">{f.title}</span>
                <span className="block text-[10.5px] text-[#7b8497] truncate">{f.sub}</span>
              </span>
            </button>
          ))}
        </div>

        {nativeOnly && (
          <Notice tone="info">
            {fmt.title} export runs in the desktop app (it needs the native FFmpeg pipeline and a real folder). In this browser preview you can export <b>SVG</b>, <b>Scene JSON</b> and a <b>PNG still</b>.
          </Notice>
        )}

        {/* ---------- FFmpeg status ---------- */}
        {native && needsFfmpeg && ff && (
          <div data-help="export-ffmpeg">
            {ff.found && (p.format === "gif" || ff.h264) ? (
              <div className="flex items-center gap-2 text-[11px] text-[#7b8497]">
                <CircleCheck size={13} className="text-emerald-400" />
                <span className="mono truncate">
                  {ff.version?.replace(/^ffmpeg version /i, "FFmpeg ").split(" Copyright")[0]} · {ff.source}
                </span>
              </div>
            ) : (
              <FfmpegMissing info={ff} />
            )}
          </div>
        )}

        {/* ---------- render settings ---------- */}
        {isRender && !nativeOnly && (
          <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-black/20 p-3.5">
            <Row label="Resolution" help="export-res">
              <Seg value={p.preset} onChange={(v) => set({ preset: v })} options={[{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }, { value: "custom", label: "Custom" }]} />
              {p.preset === "custom" ? (
                <>
                  <input className={numCls} type="number" min={16} max={7680} step={2} value={p.cw} onChange={(e) => set({ cw: Number(e.target.value) })} />
                  <span className="text-[#566074]">×</span>
                  <input className={numCls} type="number" min={16} max={4320} step={2} value={p.ch} onChange={(e) => set({ ch: Number(e.target.value) })} />
                </>
              ) : (
                <span className="mono text-[11.5px] text-[#7b8497]">
                  {res.width} × {res.height}
                </span>
              )}
            </Row>
            {p.preset === "custom" && aspectDiffers(res, scene) && <Notice tone="warn">This differs from the scene's {scene.width}:{scene.height} aspect — the stage is scaled to the width, so the extra height shows more (or less) of the world.</Notice>}
            <Row label="Frame rate" help="export-fps">
              <Seg value={p.fps} onChange={(v) => set({ fps: v })} options={FPS_CHOICES.map((f) => ({ value: f as number, label: `${f} fps` }))} />
              {p.format === "gif" && p.fps > 50 && <span className="text-[10.5px] text-amber">GIF delays are 1/100 s — 60 fps plays at ~50.</span>}
            </Row>
            <Row label="Range (s)" help="export-range">
              <input className={numCls} type="number" min={0} max={scene.duration} step={0.1} value={start} onChange={(e) => setStart(Number(e.target.value))} />
              <span className="text-[#566074]">→</span>
              <input className={numCls} type="number" min={0} max={scene.duration} step={0.1} value={end} onChange={(e) => setEnd(Number(e.target.value))} />
              <button type="button" className="text-[11px] text-cyan hover:underline" onClick={() => (setStart(0), setEnd(scene.duration))}>
                Full ({scene.duration}s)
              </button>
              <button type="button" className="text-[11px] text-cyan hover:underline" onClick={() => (setStart(Math.min(live.t, scene.duration - 0.1)), setEnd(scene.duration))}>
                From playhead
              </button>
            </Row>
            {p.format === "mp4" && (
              <Row label="Quality" help="export-quality">
                <input type="range" min={12} max={30} step={1} value={p.crf} onChange={(e) => set({ crf: Number(e.target.value) })} className="w-[150px] accent-[#3B82F6]" />
                <span className="mono text-[11.5px] text-white w-[56px]">CRF {p.crf}</span>
                <span className="text-[10.5px] text-[#7b8497]">{p.crf <= 16 ? "near-lossless" : p.crf <= 21 ? "high" : p.crf <= 25 ? "balanced" : "small file"}</span>
                <select className="field !h-7 !w-auto text-[11.5px] ml-auto" value={p.speed} onChange={(e) => set({ speed: e.target.value })} title="x264 preset — slower = smaller file">
                  {["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            {p.format === "gif" && (
              <Row label="Loop">
                <label className="flex items-center gap-2 text-[11.5px] text-[#C9D0E0]">
                  <input type="checkbox" checked={p.loop} onChange={(e) => set({ loop: e.target.checked })} className="accent-[#3B82F6]" /> Loop forever
                </label>
              </Row>
            )}
            {p.format === "png" && (
              <Row label="File prefix">
                <input className="field mono !h-7 !w-[150px] text-[12px]" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
                <span className="mono text-[11px] text-[#7b8497]">{plan ? `${prefix || "frame"}_${String(plan.first).padStart(plan.pad, "0")}.png …` : ""}</span>
              </Row>
            )}
            <Row label="Output" help="export-output">
              <input readOnly value={outPath} placeholder={p.format === "png" ? "Choose a folder…" : "Choose a file…"} className="field mono !h-7 flex-1 min-w-[180px] text-[11.5px]" />
              <button type="button" className="tbtn !h-7 !px-2.5" onClick={() => void browse()} disabled={running}>
                <FolderOpen size={13} /> Browse…
              </button>
            </Row>
            <div className="mono text-[11px] text-[#7b8497] border-t border-white/8 pt-2 mt-0.5">
              {plan ? (
                <>
                  {plan.count} frames · {res.width}×{res.height} · {p.fps} fps · {(plan.count / p.fps).toFixed(2)} s
                  {p.format === "png" && <> · ~{formatBytes(plan.count * frameBytes(res.width, res.height) * 0.12)} on disk</>}
                  {p.format === "mp4" && <> · streams {formatBytes(frameBytes(res.width, res.height))}/frame to FFmpeg, nothing is held in RAM</>}
                </>
              ) : (
                <span className="text-amber">Range is empty — the end must be later than the start.</span>
              )}
            </div>
          </div>
        )}

        {!isRender && (
          <div className="rounded-xl border border-white/8 bg-black/20 p-3.5 flex flex-col gap-2">
            {p.format === "still" && (
              <Row label="Resolution">
                <Seg value={p.preset} onChange={(v) => set({ preset: v })} options={[{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }, { value: "custom", label: "Custom" }]} />
                {p.preset === "custom" ? (
                  <>
                    <input className={numCls} type="number" min={16} step={2} value={p.cw} onChange={(e) => set({ cw: Number(e.target.value) })} />
                    <span className="text-[#566074]">×</span>
                    <input className={numCls} type="number" min={16} step={2} value={p.ch} onChange={(e) => set({ ch: Number(e.target.value) })} />
                  </>
                ) : (
                  <span className="mono text-[11.5px] text-[#7b8497]">
                    {res.width} × {res.height}
                  </span>
                )}
              </Row>
            )}
            <div className="text-[11.5px] text-[#9AA3B8] leading-relaxed">
              {p.format === "svg" && "A resolution-independent vector snapshot at the playhead: parent-child transforms, keyframes, morphs, gradients, shadows and sprites are preserved. Raster-only effects (bloom, volumetrics, particles) are left out."}
              {p.format === "json" && "The complete scene — objects, rig, keyframes, lights, emitters and story events — as a re-importable .kinetix.json file."}
              {p.format === "still" && "Renders the current playhead frame with the same renderer used for video, at the chosen resolution."}
            </div>
            <div className="mono text-[11px] text-[#7b8497]">Playhead: {live.t.toFixed(2)} s</div>
          </div>
        )}

        {/* ---------- run state ---------- */}
        {running && pr && (
          <div className="rounded-xl border border-[#3B82F6]/30 bg-[#3B82F6]/[0.07] p-3.5 flex flex-col gap-2" data-help="export-progress">
            <div className="flex items-center gap-2 text-[12.5px] text-white">
              <Loader size={14} className="animate-spin text-cyan" /> {run.cancelling ? "Cancelling…" : pr.stage}
              <span className="mono ml-auto text-[#9AA3B8]">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-black/40 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[#3B82F6] to-[#06B6D4] transition-[width] duration-150" style={{ width: `${pr.phase === "encoding" ? 100 : pct}%`, opacity: pr.phase === "encoding" ? 0.55 : 1 }} />
            </div>
            <div className="mono grid grid-cols-4 gap-2 text-[11px] text-[#9AA3B8]">
              <span>
                frame <b className="text-white">{pr.framesDone}</b> / {pr.total}
              </span>
              <span>
                ETA <b className="text-white">{formatClock(pr.etaMs)}</b>
              </span>
              <span>
                elapsed <b className="text-white">{formatClock(pr.elapsedMs)}</b>
              </span>
              <span>
                written <b className="text-white">{formatBytes(pr.bytesWritten)}</b>
              </span>
            </div>
          </div>
        )}
        {running && !pr && <div className="flex items-center gap-2 text-[12px] text-[#9AA3B8]"><Loader size={14} className="animate-spin text-cyan" /> {run.what ?? "Working…"}</div>}

        {run.status === "done" && run.result && (
          <Notice tone="ok">
            Saved <b>{formatBytes(run.result.bytes)}</b>
            {run.result.frames > 1 && <> · {run.result.frames} frames in {formatClock(run.result.elapsedMs)}</>}
            <div className="mono text-[11px] text-[#9AA3B8] break-all mt-0.5">{run.result.path}</div>
          </Notice>
        )}
        {run.status === "error" && err && <ErrorBox err={err} />}

        {/* ---------- footer ---------- */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10.5px] text-[#566074]">Same renderer as the viewport · t = frame ÷ fps · deterministic</span>
          <div className="ml-auto flex gap-2">
            {running && isRender ? (
              <button type="button" className="tbtn !px-4" disabled={run.cancelling} onClick={cancel}>
                Cancel export
              </button>
            ) : (
              <>
                <button type="button" className="tbtn !px-4" onClick={() => setModal(null)}>
                  {run.status === "done" ? "Close" : "Cancel"}
                </button>
                <button
                  type="button"
                  className="tbtn primary !px-4"
                  disabled={running || nativeOnly || !!ffBlocked || (isRender && !plan)}
                  onClick={() => void (isRender ? startRender() : quick())}
                >
                  <Download size={14} /> {isRender ? "Export" : "Save…"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Notice({ tone, children }: { tone: "info" | "warn" | "ok"; children: ReactNode }) {
  const t = { info: "border-cyan/30 bg-cyan/[0.07] text-[#BFEFF7]", warn: "border-amber/30 bg-amber/[0.08] text-[#FBD38D]", ok: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200" }[tone];
  const I = tone === "ok" ? CircleCheck : tone === "warn" ? CircleAlert : Info;
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ${t}`}>
      <I size={14} className="mt-0.5 flex-none" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const ERR_TITLE: Record<string, string> = {
  disk_full: "The disk is full",
  permission: "Permission denied",
  ffmpeg_missing: "FFmpeg is missing",
  no_h264: "FFmpeg can't encode H.264",
  ffmpeg_failed: "FFmpeg stopped",
  invalid: "Check the export settings",
  busy: "An export is already running",
};

function ErrorBox({ err }: { err: NativeExportError }) {
  return (
    <div className="rounded-lg border border-red-500/35 bg-red-500/[0.08] px-3 py-2.5 text-[12px] text-red-200 flex gap-2.5" role="alert">
      <CircleAlert size={15} className="mt-0.5 flex-none" />
      <div className="min-w-0">
        <div className="font-semibold text-red-100">{ERR_TITLE[err.code] ?? "Export failed"}</div>
        <div className="text-[11.5px] leading-relaxed break-words">{err.message}</div>
        {err.code === "disk_full" && <div className="text-[11px] mt-1 text-red-300/80">Partial files were removed. Free some space, or export to another drive.</div>}
      </div>
    </div>
  );
}

/** Blocking explainer shown when FFmpeg is absent — PNG sequence / SVG / JSON still work. */
function FfmpegMissing({ info }: { info: FfmpegInfo }) {
  const noX264 = info.found && !info.h264;
  return (
    <div className="rounded-xl border border-amber/35 bg-amber/[0.07] p-3.5" role="alert" data-help="export-ffmpeg">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#FBD38D]">
        <CircleAlert size={15} /> {noX264 ? "This FFmpeg build has no H.264 encoder" : "FFmpeg isn't installed"}
      </div>
      <p className="text-[11.5px] text-[#E8D3A8] leading-relaxed mt-1.5">
        {noX264 ? "MP4 needs libx264. GIF still works with this build." : "MP4 and GIF are encoded by FFmpeg, which Kinetix looks for next to the app (bundled sidecar), in the KINETIX_FFMPEG variable, and on your PATH."}
      </p>
      <ul className="text-[11.5px] text-[#E8D3A8] mt-1.5 list-disc pl-4 leading-relaxed">
        <li>
          <b>Windows:</b> <span className="mono">winget install Gyan.FFmpeg</span>
        </li>
        <li>
          <b>Linux:</b> <span className="mono">sudo apt install ffmpeg</span>
        </li>
        <li>Installer builds can ship FFmpeg inside the app — see the README “Bundling FFmpeg”.</li>
      </ul>
      <p className="text-[11.5px] text-[#E8D3A8] mt-1.5">
        You can still export a <b>PNG sequence</b>, <b>SVG</b> and <b>Scene JSON</b> right now — pick one above.
      </p>
    </div>
  );
}
