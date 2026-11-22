import { convertFileSrc, invoke as coreInvoke } from "@tauri-apps/api/core";

/**
 * Native bridge. Inside the Tauri v2 shell every persistence call goes to Rust (SQLite WAL on disk).
 * In a plain browser (vite dev preview) `invoke` rejects with NATIVE_ONLY and callers fall back to localStorage.
 */
export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("NATIVE_ONLY");
  return coreInvoke<T>(cmd, args);
}

/** Raw binary request body (frames) + string headers — no JSON/base64 detour. */
export async function invokeRaw<T = unknown>(cmd: string, bytes: Uint8Array, headers: Record<string, string>): Promise<T> {
  if (!isTauri()) throw new Error("NATIVE_ONLY");
  return coreInvoke<T>(cmd, bytes, { headers });
}

/** Fire-and-forget (activity log, heartbeat, mirrors) — never throws. */
export function invokeQuiet(cmd: string, args?: Record<string, unknown>) {
  if (!isTauri()) return;
  coreInvoke(cmd, args).catch((e) => console.warn(`[kinetix] ${cmd} failed`, e));
}

export const fileUrl = (path: string) => convertFileSrc(path);

/** Browser-only fallbacks (localStorage). */
export const LS = {
  scene: "kinetix.autosave.v2",
  launched: "kinetix.launched.v2",
  assets: "kinetix.assets.v2",
};
