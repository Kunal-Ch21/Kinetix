import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useStore } from "../state/store";
import { ai, type AiStatus, type LiveContext } from "./ai";
import { isBusy, subscribeBusy } from "./director";
import { buildMicroContext } from "./microcontext";
import { isTauri } from "./native";

/* ---------- shared model status (one poller for every component) ---------- */

let status: AiStatus = { native: isTauri(), running: false, backend: "none", models: [], model: null };
const subs = new Set<() => void>();
let timer: number | undefined;
let refs = 0;
let firstTimer: number | undefined;

export async function refreshStatus() {
  try {
    const s = await ai.status();
    if (JSON.stringify(s) !== JSON.stringify(status)) {
      status = s;
      subs.forEach((f) => f());
    }
  } catch {
    /* keep previous status */
  }
}

export function useAiStatus(): AiStatus {
  const s = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => status,
    () => status,
  );
  useEffect(() => {
    refs += 1;
    if (refs === 1) {
      // health check (llama-server / Ollama) runs AFTER the first paint settles, never during startup
      firstTimer = window.setTimeout(() => void refreshStatus(), 1500);
      timer = window.setInterval(refreshStatus, 5000);
    }
    return () => {
      refs -= 1;
      if (refs === 0) {
        window.clearInterval(timer);
        window.clearTimeout(firstTimer);
      }
    };
  }, []);
  return s;
}

export function useBusy(): boolean {
  return useSyncExternalStore(subscribeBusy, isBusy, isBusy);
}

/* ---------- live Micro-Context Token Inspector ---------- */

export function useMicroContext(): LiveContext & { live: boolean } {
  const project = useStore((s) => s.scene);
  const selection = useStore((s) => s.selection);
  const prompt = useStore((s) => s.prompt);
  const t = useStore((s) => Math.round(s.time * 10) / 10);

  // Instant, synchronous preview (also the browser fallback)…
  const local = useMemo(() => buildMicroContext(project, selection, t, prompt), [project, selection, t, prompt]);
  // …replaced by the authoritative Rust gatekeeper payload a moment after the user stops changing things.
  const [remote, setRemote] = useState<LiveContext | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let dead = false;
    const h = window.setTimeout(() => {
      ai.preview(project, selection, t, prompt)
        .then((r) => {
          if (!dead) setRemote(r);
        })
        .catch(() => {
          if (!dead) setRemote(null);
        });
    }, 250);
    return () => {
      dead = true;
      window.clearTimeout(h);
    };
  }, [project, selection, t, prompt]);

  return remote ? { ...remote, live: true } : { ...local, live: false };
}
