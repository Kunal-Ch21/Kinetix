import { useEffect, useRef, type ReactNode } from "react";
import { Director } from "./components/Director";
import { Header } from "./components/Header";
import { Inspector } from "./components/Inspector";
import { IslandBot } from "./components/IslandBot";
import { ExportModal } from "./components/ExportModal";
import { DocsModal, SpotlightModal } from "./components/Modals";
import { GateModal, ModelsModal } from "./components/AiModals";
import { SettingsModal } from "./components/SettingsModal";
import { AssetLibrary, Outliner } from "./components/Outliner";
import { Timeline } from "./components/Timeline";
import { Viewport, vp } from "./components/Viewport";
import { ZenOverlay } from "./components/ZenOverlay";
import { ContextMenu } from "./components/ui";
import { runAction } from "./lib/actions";
import { eventCombo, isModifierKey, matchAction } from "./lib/keybinds";
import { closeMenu, registerImportInput, registerOpenInput, useMenu } from "./lib/menu";
import { runRecipe } from "./lib/menus";
import { boot, commit, duplicateNode, getState, importImageFile, openProjectFile, select, setModal, setState, useStore } from "./state/store";

function InspectorHost() {
  const scene = useStore((s) => s.scene);
  const sel = useStore((s) => s.selection[0] ?? null);
  const time = useStore((s) => s.time);
  const selKey = useStore((s) => s.selKey);
  return (
    <Inspector
      scene={scene}
      selId={sel}
      time={time}
      commit={commit}
      selKey={selKey}
      onSelect={(id) => select(id ? [id] : [])}
      onClone={(id) => duplicateNode(id, true)}
      onAddEmitter={(kind) => {
        const o = scene.objects.find((x) => x.id === sel);
        import("./state/store").then((m) => m.runOps([{ op: "add_emitter", kind, ...(o && kind === "trail" ? { follow: o.id } : {}) }], "Emitter"));
      }}
    />
  );
}

/**
 * Collapsible dock used for the Zen transition. The panel content keeps its fixed size (so nothing reflows or gets
 * clipped while it animates); only the wrapper shrinks to 0 and clips it.
 */
function Dock({ open, axis, size, children, className = "" }: { open: boolean; axis: "x" | "y"; size: number; children: ReactNode; className?: string }) {
  const style = axis === "x" ? { width: open ? size : 0 } : { height: open ? size : 0 };
  return (
    <div className={`kx-dock flex-none overflow-hidden ${className}`} style={style} aria-hidden={!open} {...(open ? {} : { inert: true })}>
      <div className="flex h-full" style={axis === "x" ? { width: size } : { height: size }}>
        {children}
      </div>
    </div>
  );
}

const REPEATABLE = new Set(["step_fwd", "step_back", "step_fwd_10", "step_back_10", "zoom_in", "zoom_out", "next_keyframe", "prev_keyframe"]);
const ALWAYS = new Set(["focus_ai", "open_help", "open_settings"]);

export default function App() {
  const mode = useStore((s) => s.mode);
  const modal = useStore((s) => s.modal);
  const toast = useStore((s) => s.toast);
  const menu = useMenu();
  const importRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLInputElement>(null);
  const zen = mode === "zen";

  useEffect(() => {
    registerImportInput(importRef.current);
    registerOpenInput(openRef.current);
    // Startup is non-blocking: the shell (and a "Loading project…" canvas) paints first; the database read, sample
    // seeding and the optional ?try= recipe all run after that first paint.
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      void boot().then(() => {
        const id = new URLSearchParams(window.location.search).get("try");
        if (id) {
          window.history.replaceState(null, "", window.location.pathname);
          setTimeout(() => runRecipe(id), 60);
        }
      });
    };
    const raf = requestAnimationFrame(() => setTimeout(start, 0));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      registerImportInput(null);
      registerOpenInput(null);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setState({ toast: null }), 3800);
    return () => window.clearTimeout(id);
  }, [toast]);

  /* ---------- keyboard: every shortcut is looked up in the (user-customisable) keybind table ---------- */
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (document.body.dataset.recording) return; // Settings → Keybinds is capturing a new shortcut
      if (isModifierKey(e)) return;
      const s = getState();
      const act = matchAction(e);
      if (typing(e.target)) {
        if (act === "focus_ai") {
          e.preventDefault();
          runAction("focus_ai");
        } else if (e.key === "Escape") {
          if (s.modal) setModal(null);
          else (e.target as HTMLElement).blur();
        }
        return;
      }
      if (e.key === "Escape") {
        closeMenu();
        if (s.modal) return setModal(null);
        if (s.inspectMode) return;
        vp.cancelPen();
        return setState({ editNodes: false, tool: "select" });
      }
      if (!act) return;
      if (s.modal && !ALWAYS.has(act)) return;
      if (e.repeat && !REPEATABLE.has(act)) {
        e.preventDefault();
        return;
      }
      if (act === "delete_keyframe" && !s.selKey && !s.selection.length) return;
      e.preventDefault();
      runAction(act);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  /* ---------- global guards: native context menu off, file drops never navigate ---------- */
  useEffect(() => {
    const ctx = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      e.preventDefault();
    };
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("contextmenu", ctx);
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("contextmenu", ctx);
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: "#07090e" }} data-mode={mode}>
      <input
        ref={importRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg"
        className="hidden"
        onChange={(e) => {
          Array.from(e.target.files ?? []).forEach((f) => void importImageFile(f));
          e.target.value = "";
        }}
      />
      <input
        ref={openRef}
        type="file"
        accept=".json,.kinetix"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openProjectFile(f);
          e.target.value = "";
        }}
      />

      {/* One persistent layout: the canvas is never unmounted; Zen just collapses the docks around it. */}
      <Dock open={!zen} axis="y" size={46} className="relative z-50">
        <Header />
      </Dock>
      <IslandBot />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <Dock open={!zen} axis="x" size={260} className="border-r border-white/[0.07] bg-[#0E1118]">
            <aside data-help="outliner" className="flex h-full w-[260px] flex-none flex-col">
              <div className="panel-title">Outliner · Rig Tree</div>
              <Outliner />
              <AssetLibrary />
            </aside>
          </Dock>
          <main className="flex min-w-0 flex-1 flex-col">
            <Viewport />
          </main>
          <Dock open={!zen} axis="x" size={300} className="border-l border-white/[0.07] bg-[#0E1118]">
            <aside data-help="inspector" className="h-full w-[300px] flex-none">
              <InspectorHost />
            </aside>
          </Dock>
        </div>
        <Dock open={!zen} axis="y" size={210} className="border-t border-white/[0.07]">
          <div className="flex h-[210px] w-full">
            <Director />
            <Timeline />
          </div>
        </Dock>
        {zen && <ZenOverlay />}
      </div>

      {modal === "models" && <ModelsModal />}
      {modal === "gate" && <GateModal />}
      {modal === "docs" && <DocsModal />}
      {modal === "export" && <ExportModal />}
      {modal === "spotlight" && <SpotlightModal />}
      {modal === "settings" && <SettingsModal />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      {toast && (
        <div key={toast.id} className={`kx-glass pointer-events-none fixed left-1/2 z-[150] flex h-8 max-w-[80vw] -translate-x-1/2 items-center rounded-full border border-white/10 px-4 text-[12px] text-white anim-in ${zen ? "bottom-[132px]" : "bottom-[226px]"}`}>
          <span className="truncate">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

// re-exported for tests / tooling that want to read the active combo of a raw event
export { eventCombo };
