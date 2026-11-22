// Native frame-by-frame exporter (front-end half). Every frame is rendered by the SAME `Renderer` the viewport uses,
// on an off-screen canvas at the export resolution, at t = frame / fps — no screen capture, fully deterministic.
// Frames are streamed to Rust one at a time (raw RGBA → ffmpeg stdin, or PNG → files); only one frame is ever in flight.
import { replaceImage } from "../engine/images";
import { Renderer } from "../engine/render";
import { fontOf } from "../engine/typography";
import type { Scene } from "../engine/types";
import { invoke, invokeRaw } from "../lib/native";
import { ExportFormat, FramePlan, frameTime } from "./plan";

export interface FfmpegInfo {
  found: boolean;
  path: string | null;
  version: string | null;
  source: "env" | "sidecar" | "system" | null;
  h264: boolean;
  message: string | null;
}

export interface RenderExportOptions {
  format: Extract<ExportFormat, "mp4" | "gif" | "png">;
  width: number;
  height: number;
  fps: number;
  start: number;
  end: number;
  outPath: string; // file for mp4/gif, folder for png
  crf: number;
  preset: string;
  loopGif: boolean;
  prefix: string;
}

export interface ExportProgress {
  phase: "preparing" | "rendering" | "encoding" | "done";
  stage: string;
  framesDone: number;
  total: number;
  bytesWritten: number;
  elapsedMs: number;
  etaMs: number | null;
}

export interface ExportResult {
  path: string;
  bytes: number;
  frames: number;
  elapsedMs: number;
}

/** Error shape produced by the Rust side (`ExportError`). */
export interface NativeExportError {
  code: string;
  message: string;
}

export class ExportCancelled extends Error {
  constructor() {
    super("Export cancelled");
  }
}

export const asExportError = (e: unknown): NativeExportError => {
  if (e && typeof e === "object" && "code" in e && "message" in e) return e as NativeExportError;
  if (typeof e === "string") return { code: "io", message: e };
  return { code: "io", message: e instanceof Error ? e.message : String(e) };
};

export const probeFfmpeg = () => invoke<FfmpegInfo>("export_probe_ffmpeg");

/** Fonts + sprites must be decoded before frame 0 or the first frames would render without them. */
export async function prepareAssets(scene: Scene, imageSrc: (id: string) => Promise<string | null>) {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts) {
    const loads = scene.objects.filter((o) => o.kind === "text" && o.text).map((o) => fonts.load(fontOf(o.text!), o.text!.content || "A").catch(() => []));
    await Promise.all(loads);
    await fonts.ready;
  }
  const ids = [...new Set(scene.objects.map((o) => o.image).filter((x): x is string => !!x))];
  for (const id of ids) {
    const src = await imageSrc(id);
    if (src) await replaceImage(id, src);
  }
}

/** Renders one frame to a fresh canvas — shared by the exporter, the still-PNG export and the determinism test. */
export function makeFrameRenderer(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new Renderer(canvas);
  const ctx = canvas.getContext("2d")!;
  return {
    canvas,
    render(scene: Scene, t: number) {
      renderer.render(scene, { t, editor: false });
    },
    rgba(): Uint8Array {
      const d = ctx.getImageData(0, 0, width, height).data;
      return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    },
    png(): Promise<Uint8Array> {
      return new Promise((res, rej) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error("PNG encode failed"))), "image/png"));
    },
  };
}

interface StartInfo {
  jobId: string;
  plan: FramePlan;
  ffmpeg: string | null;
}
interface NativeProgress {
  state: "running" | "encoding" | "done" | "cancelled" | "failed";
  stage: string;
  framesDone: number;
  total: number;
  bytesWritten: number;
  elapsedMs: number;
  etaMs: number | null;
  message: string | null;
}

export interface Control {
  cancelled: boolean;
}

export async function runExport(scene: Scene, o: RenderExportOptions, imageSrc: (id: string) => Promise<string | null>, onProgress: (p: ExportProgress) => void, ctl: Control): Promise<ExportResult> {
  const frozen = structuredClone(scene); // edits made while exporting must not leak into the video
  onProgress({ phase: "preparing", stage: "Preparing assets", framesDone: 0, total: 0, bytesWritten: 0, elapsedMs: 0, etaMs: null });
  await prepareAssets(frozen, imageSrc);
  if (ctl.cancelled) throw new ExportCancelled();

  const start = await invoke<StartInfo>("export_start", {
    args: { format: o.format, width: o.width, height: o.height, fps: o.fps, start: o.start, end: o.end, duration: frozen.duration, outPath: o.outPath, crf: o.crf, preset: o.preset, prefix: o.prefix, loopGif: o.loopGif },
  });
  const { jobId, plan } = start;
  const fr = makeFrameRenderer(o.width, o.height);

  let native: NativeProgress | null = null;
  let polling = false;
  const emit = (phase: ExportProgress["phase"], n: number) =>
    onProgress({
      phase,
      stage: native?.stage ?? "Rendering frames",
      framesDone: Math.max(n, native?.framesDone ?? 0),
      total: plan.count,
      bytesWritten: native?.bytesWritten ?? 0,
      elapsedMs: native?.elapsedMs ?? 0,
      etaMs: native?.etaMs ?? null,
    });
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      native = await invoke<NativeProgress>("export_progress", { jobId });
    } catch {
      /* job may already be gone */
    } finally {
      polling = false;
    }
  };

  let writeError: unknown = null;
  let inflight: Promise<void> | null = null;
  let done = 0;
  const timer = window.setInterval(() => void poll().then(() => emit("rendering", done)), 250);
  try {
    for (let i = 0; i < plan.count; i++) {
      if (ctl.cancelled) throw new ExportCancelled();
      const index = plan.first + i;
      fr.render(frozen, frameTime(index, plan.fps)); // overlaps with the previous frame's write
      const payload = o.format === "mp4" ? fr.rgba() : await fr.png();
      if (inflight) await inflight;
      if (writeError) throw writeError;
      inflight = invokeRaw<void>("export_write_frame", payload, { "x-job": jobId, "x-frame": String(index) }).catch((e) => {
        writeError = e;
      });
      done = i + 1;
    }
    if (inflight) await inflight;
    if (writeError) throw writeError;
    if (ctl.cancelled) throw new ExportCancelled();

    emit("encoding", plan.count);
    const finishing = invoke<ExportResult>("export_finish", { jobId });
    const encTimer = window.setInterval(() => void poll().then(() => emit("encoding", plan.count)), 250);
    try {
      return await finishing;
    } finally {
      window.clearInterval(encTimer);
    }
  } catch (e) {
    const cancelled = ctl.cancelled || e instanceof ExportCancelled || asExportError(e).code === "cancelled";
    await invoke("export_cancel", { jobId }).catch(() => undefined); // kills ffmpeg + removes temp/partial files (idempotent)
    if (cancelled) throw new ExportCancelled();
    throw e;
  } finally {
    window.clearInterval(timer);
  }
}

/** One PNG still at the chosen resolution (used by both the browser download and the native save). */
export async function renderStill(scene: Scene, t: number, width: number, height: number, imageSrc: (id: string) => Promise<string | null>): Promise<Uint8Array> {
  const frozen = structuredClone(scene);
  await prepareAssets(frozen, imageSrc);
  const fr = makeFrameRenderer(width, height);
  fr.render(frozen, t);
  return fr.png();
}
