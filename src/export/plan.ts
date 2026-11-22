// Pure export planning helpers. The Rust twin lives in src-tauri/src/export.rs (`plan_frames`, `frame_name`, `pad_width`);
// both sides are unit-tested against the same vectors so the UI preview always matches what Rust really writes.

export const FPS_CHOICES = [24, 30, 60] as const;
export type ExportFormat = "mp4" | "gif" | "png" | "svg" | "json";
export type ResolutionPreset = "720p" | "1080p" | "custom";

export interface FramePlan {
  first: number; // index of the first frame; t = first / fps
  count: number;
  pad: number; // zero-padding width of file names
  fps: number;
}

export const padWidth = (lastIndex: number) => Math.max(4, String(lastIndex).length);
export const frameName = (prefix: string, index: number, pad: number) => `${prefix}_${String(index).padStart(pad, "0")}.png`;
/** Scene time (seconds) a frame is rendered at — the ONLY place frame → time is defined for the exporter. */
export const frameTime = (index: number, fps: number) => index / fps;

/** Frames cover [start, end) seconds (end exclusive): a 10 s project at 60 fps is exactly 600 frames. */
export function planFrames(start: number, end: number, fps: number, duration: number): FramePlan | null {
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) return null;
  if (![start, end, duration].every(Number.isFinite) || duration <= 0) return null;
  const s = Math.max(0, start);
  const e = Math.min(end, duration);
  const first = Math.round(s * fps);
  const endExcl = Math.round(e * fps);
  if (endExcl <= first) return null;
  const count = endExcl - first;
  return { first, count, pad: padWidth(first + count - 1), fps };
}

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** 720p / 1080p keep the scene's aspect ratio (height fixed, width derived and rounded to even for yuv420p). */
export function resolutionFor(preset: ResolutionPreset, scene: { width: number; height: number }, custom: { width: number; height: number }) {
  if (preset === "custom") return { width: clampDim(custom.width, 7680), height: clampDim(custom.height, 4320) };
  const h = preset === "720p" ? 720 : 1080;
  return { width: even((h * scene.width) / scene.height), height: h };
}
const clampDim = (n: number, max: number) => Math.min(max, Math.max(16, even(Number.isFinite(n) ? n : 16)));

export const aspectDiffers = (a: { width: number; height: number }, b: { width: number; height: number }) => Math.abs(a.width / a.height - b.width / b.height) > 0.01;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Safe default file name from the project name. */
export function safeName(name: string): string {
  const s = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "kinetix";
}

/** Rough uncompressed-frame warning threshold for custom sizes (RGBA bytes per frame). */
export const frameBytes = (w: number, h: number) => w * h * 4;
