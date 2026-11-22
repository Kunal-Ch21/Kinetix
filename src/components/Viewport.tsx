// 60 FPS viewport: Renderer (M3 engine) + select/rotate/scale gizmos + freehand brush → Bézier fit, Bézier pen,
// node editor, shape / text / light tools, image drop & right-click import, rulers, grid, zoom / pan, onion skin.
import { memo, useEffect, useRef, useState } from "react";
import { corner, fitFreehand, makeShape, parseSvgPath, recenter, taperD, toSvgPath } from "@/engine/geometry";
import { setImageReadyHandler } from "@/engine/images";
import { applyM, clamp, invertM, toHex, toPx } from "@/engine/math";
import { evalLights, type LiveLight } from "@/engine/lighting";
import { Renderer } from "@/engine/render";
import { anchorNorm, evalObj, resolveScene, stageH } from "@/engine/rig";
import type { Anchor, BezierPath, Scene, SceneObject, Vec2 } from "@/engine/types";
import { openMenu, triggerImport } from "@/lib/menu";
import { objectMenu } from "@/lib/menus";
import { addObject, commit, emitLive, getState, importImageFile, live, onLive, runOps, select, setState, setTool, toast, useStore } from "@/state/store";
import { keyLabel } from "@/lib/keybinds";
import { setLightProp, setObjProp } from "./helpers";

type Pt = { x: number; y: number };
type Drag = { kind: "move" | "rotate" | "scale" | "marker" | "lorigin" | "ltarget" | "lcone" | "lfalloff"; id: string };
/** Render-loop stats live outside React: the FPS badge polls this once a second. */
const perf = { fps: 0 };
const PALETTE = ["#EF4444", "#F59E0B", "#22C55E", "#06B6D4", "#8B5CF6", "#EC4899", "#3B82F6"];

/** Imperative hooks used by the keyboard handler and the export modal. */
export const vp = {
  cancelPen: () => {},
  finishPen: () => {},
  deleteAnchor: (): boolean => false,
  exportFrame: async (): Promise<Blob | null> => null,
  zoomIn: () => {},
  zoomOut: () => {},
  zoomFit: () => {},
  zoomReset: () => {},
};

const f2 = (v: number) => Math.round(v * 100) / 100;

function pathD(anchors: Anchor[], closed: boolean): string {
  if (!anchors.length) return "";
  let d = `M${anchors[0].x} ${anchors[0].y}`;
  const seg = (a: Anchor, b: Anchor) => `C${a.ox} ${a.oy} ${b.ix} ${b.iy} ${b.x} ${b.y}`;
  for (let i = 1; i < anchors.length; i++) d += seg(anchors[i - 1], anchors[i]);
  if (closed && anchors.length > 1) d += seg(anchors[anchors.length - 1], anchors[0]) + "Z";
  return d;
}

export function Viewport() {
  const scene = useStore((s) => s.scene);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const mode = useStore((s) => s.mode);
  const editNodes = useStore((s) => s.editNodes);
  const playing = useStore((s) => s.playing);
  const brush = useStore((s) => s.brush);
  const onion = useStore((s) => s.onion);
  const showGrid = useStore((s) => s.showGrid);
  const fitTick = useStore((s) => s.fitTick);
  const ready = useStore((s) => s.ready);
  const zen = mode === "zen";

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onionRef = useRef<HTMLCanvasElement>(null);
  const rdRef = useRef<Renderer | null>(null);
  const onionRd = useRef<Renderer | null>(null);
  const dirty = useRef(true);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const [pen, setPen] = useState<{ anchors: Anchor[]; cursor: Pt | null }>({ anchors: [], cursor: null });
  const penRef = useRef(pen);
  const [rect, setRect] = useState<{ a: Pt; b: Pt } | null>(null);
  const [nodeTick, setNodeTick] = useState(0);
  const spaceDown = useRef(false);
  const sceneRef = useRef(scene);

  useEffect(() => {
    sceneRef.current = scene;
    viewRef.current = view;
    penRef.current = pen;
    dirty.current = true;
  }, [scene, view, pen, selection, size, editNodes, zen, tool, onion, nodeTick, playing]);

  /* ---------- renderer + sizing ---------- */
  useEffect(() => {
    if (canvasRef.current) rdRef.current = new Renderer(canvasRef.current);
    if (onionRef.current) onionRd.current = new Renderer(onionRef.current);
    setImageReadyHandler(() => (dirty.current = true));
    return () => setImageReadyHandler(null);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const pad = zen ? 0 : 44;
      const aw = el.clientWidth - pad;
      const ah = el.clientHeight - pad;
      const ar = sceneRef.current.width / sceneRef.current.height;
      let w = aw;
      let h = w / ar;
      if (h > ah) {
        h = ah;
        w = h * ar;
      }
      w = Math.max(160, Math.floor(w));
      h = Math.max(90, Math.floor(h));
      setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zen, fitTick, scene.width, scene.height]);

  useEffect(() => {
    setView({ zoom: 1, x: 0, y: 0 });
  }, [fitTick]);

  useEffect(() => {
    // clamp: a 3× display would otherwise fill 9× the pixels of a 1× one; 1.5 is visually indistinguishable at this scale
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    for (const c of [canvasRef.current, onionRef.current]) {
      if (!c) continue;
      const w = Math.round(size.w * dpr);
      const h = Math.round(size.h * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
    dirty.current = true;
  }, [size]);

  /* ---------- 60 FPS loop (playback clock + render) ----------
   * Runs entirely outside React: the playhead lives in the mutable `live` object, the canvas is painted straight from
   * it, and the only UI side-effects are (a) ~15 Hz DOM writes via `emitLive` listeners and (b) a ~4 Hz mirror into the
   * store for the inspector. No setState / React render happens per frame. */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUI = 0;
    let lastMirror = 0;
    let frames = 0;
    let fpsT = last;
    let lastT = -1;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const s = getState();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (s.playing) {
        const D = s.scene.duration;
        let t = live.t + dt;
        if (t >= D) {
          if (s.loop) t = t % D;
          else {
            t = D;
            live.t = D;
            setState({ playing: false, time: D });
            emitLive(D);
          }
        }
        live.t = t;
        dirty.current = true;
        frames++;
        if (now - lastUI > 66) {
          emitLive(t);
          lastUI = now;
        }
        if (now - lastMirror > 250) {
          setState({ time: t });
          lastMirror = now;
        }
      } else if (live.t !== lastT) {
        dirty.current = true;
      }
      lastT = live.t;
      if (now - fpsT > 1000) {
        perf.fps = s.playing ? Math.round((frames * 1000) / (now - fpsT)) : 0;
        frames = 0;
        fpsT = now;
      }
      if (dirty.current && rdRef.current) {
        dirty.current = false;
        rdRef.current.render(s.scene, { t: live.t, selection: s.selection[0] ?? null, editor: s.mode === "studio" && !s.playing });
        if (s.onion && !s.playing && onionRd.current) onionRd.current.render(s.scene, { t: Math.max(0, live.t - 0.3), editor: false });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------- coordinates ---------- */
  const canvasPoint = (e: { clientX: number; clientY: number }): Pt => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const toGrid = (p: Pt) => {
    const u = rdRef.current?.lastU ?? 1;
    const Hu = stageH(sceneRef.current);
    return { x: f2(p.x / u), y: f2((p.y / u / Hu) * 100) };
  };

  /* ---------- gizmo / move drags (keyframe-aware) ---------- */
  const beginDrag = (mode: Drag, start: Pt) => {
    const rd = rdRef.current!;
    const sc = sceneRef.current;
    const t0 = live.t;
    const u = rd.lastU;
    const Hu = stageH(sc);
    const id = mode.id;
    const obj = sc.objects.find((o) => o.id === id);
    const res = rd.lastRes?.get(id);
    const ev = obj ? evalObj(obj, t0) : null;
    const center = rd.gizmo?.center ?? { x: 0, y: 0 };
    const a0 = Math.atan2(start.y - center.y, start.x - center.x);
    const d0 = Math.hypot(start.x - center.x, start.y - center.y) || 1;
    const inv = res?.parentGeom ? invertM(res.parentGeom) : null;
    const snap = getState().snap;
    const sn = (v: number) => (snap ? Math.round(v) : Math.round(v * 100) / 100);
    const move = (e: PointerEvent) => {
      const p = canvasPoint(e);
      if (mode.kind === "move" && ev) {
        const dx = (p.x - start.x) / u;
        const dy = (p.y - start.y) / u;
        let nx: number;
        let ny: number;
        if (inv) {
          nx = ev.x + inv[0] * dx + inv[2] * dy;
          ny = ev.y + inv[1] * dx + inv[3] * dy;
        } else {
          nx = sn(ev.x + dx);
          ny = sn(ev.y + (dy / Hu) * 100);
        }
        commit((s) => {
          const o = s.objects.find((q) => q.id === id);
          if (o) {
            setObjProp(o, "x", nx, t0);
            setObjProp(o, "y", ny, t0);
          }
        }, `drag:${id}`, "Move");
      } else if (mode.kind === "rotate" && ev) {
        let deg = ev.rotation + ((Math.atan2(p.y - center.y, p.x - center.x) - a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        else if (snap) deg = Math.round(deg);
        commit((s) => {
          const o = s.objects.find((q) => q.id === id);
          if (o) setObjProp(o, "rotation", Math.round(deg * 10) / 10, t0);
        }, `rot:${id}`, "Rotate");
      } else if (mode.kind === "scale" && ev) {
        const k = Math.max(0.05, ev.scale * (Math.hypot(p.x - center.x, p.y - center.y) / d0));
        commit((s) => {
          const o = s.objects.find((q) => q.id === id);
          if (o) setObjProp(o, "scale", Math.round(k * 1000) / 1000, t0);
        }, `scl:${id}`, "Scale");
      } else if (mode.kind === "lorigin" || mode.kind === "ltarget" || mode.kind === "lcone" || mode.kind === "lfalloff") {
        const g = toGrid(p);
        const lights = rd.lastLights;
        const L = lights.find((q) => q.l.id === id);
        const follow = L?.l.follow ? anchorNorm(sc, L.l.follow, t0, rd.lastRes ?? undefined) : null;
        const ox = follow ? follow.x : 0;
        const oy = follow ? follow.y : 0;
        commit((s) => {
          const l = s.lights.find((q) => q.id === id);
          if (!l || !L) return;
          if (mode.kind === "lorigin") {
            setLightProp(l, "x", f2(g.x - ox), t0);
            setLightProp(l, "y", f2(g.y - oy), t0);
          } else if (mode.kind === "ltarget") {
            setLightProp(l, "tx", f2(g.x - ox), t0);
            setLightProp(l, "ty", f2(g.y - oy), t0);
          } else if (mode.kind === "lcone") {
            const beam = (L.angle * Math.PI) / 180;
            let da = Math.abs(Math.atan2(p.y / u - L.y, p.x / u - L.x) - beam);
            da = Math.min(da, Math.PI * 2 - da);
            setLightProp(l, "cone", Math.round(clamp((da * 180) / Math.PI, 3, 85)), t0);
          } else {
            const d = Math.hypot(p.x / u - L.x, p.y / u - L.y);
            setLightProp(l, "radius", Math.round(clamp(l.type === "spot" ? d / 1.5 : d / 0.95, 5, 150) * 2) / 2, t0);
          }
        }, `lt:${mode.kind}:${id}`, "Move light handle");
      } else if (mode.kind === "marker") {
        const g = toGrid(p);
        commit((s) => {
          const l = s.lights.find((q) => q.id === id);
          if (l && !l.follow) {
            setLightProp(l, "x", g.x, t0);
            setLightProp(l, "y", g.y, t0);
          }
          const em = s.emitters.find((q) => q.id === id);
          if (em && !em.follow) {
            em.x = g.x;
            em.y = g.y;
          }
        }, `mk:${id}`, "Move marker");
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ---------- node editor ---------- */
  const selObj: SceneObject | undefined = scene.objects.find((o) => o.id === selection[0]);
  const nodeActive = editNodes && !!selObj && selObj.kind === "shape" && !selObj.morphTo;
  const nodeSel = useRef<{ sub: number; idx: number } | null>(null);

  const nodeGeom = () => {
    const rd = rdRef.current;
    const o = sceneRef.current.objects.find((q) => q.id === getState().selection[0]);
    const r = o ? rd?.lastRes?.get(o.id) : undefined;
    if (!rd || !o || !r) return null;
    const M = toPx(r.geom, rd.lastU);
    return { o, M, inv: invertM(M), path: parseSvgPath(o.path) as BezierPath };
  };
  const writePath = (id: string, p: BezierPath) =>
    commit((s) => {
      const o = s.objects.find((q) => q.id === id);
      if (o) o.path = toSvgPath(p);
    }, `node:${id}`, "Edit nodes");

  const nodeDown = (e: React.PointerEvent, sub: number, idx: number, part: "a" | "i" | "o") => {
    e.stopPropagation();
    e.preventDefault();
    if (!nodeGeom()) return;
    nodeSel.current = { sub, idx };
    setNodeTick((n) => n + 1);
    const move = (ev: PointerEvent) => {
      const gg = nodeGeom();
      if (!gg) return;
      const cp = canvasPoint(ev);
      const lp = applyM(gg.inv, cp.x, cp.y);
      const p = parseSvgPath(gg.o.path);
      const a = p[sub]?.anchors[idx];
      if (!a) return;
      if (part === "a") {
        const dx = lp.x - a.x;
        const dy = lp.y - a.y;
        Object.assign(a, { x: a.x + dx, y: a.y + dy, ix: a.ix + dx, iy: a.iy + dy, ox: a.ox + dx, oy: a.oy + dy });
      } else if (part === "o") {
        a.ox = lp.x;
        a.oy = lp.y;
        if (!ev.altKey) {
          a.ix = 2 * a.x - lp.x;
          a.iy = 2 * a.y - lp.y;
        }
      } else {
        a.ix = lp.x;
        a.iy = lp.y;
        if (!ev.altKey) {
          a.ox = 2 * a.x - lp.x;
          a.oy = 2 * a.y - lp.y;
        }
      }
      writePath(gg.o.id, p);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggleSmooth = (sub: number, idx: number) => {
    const g = nodeGeom();
    if (!g) return;
    const p = parseSvgPath(g.o.path);
    const s = p[sub];
    const a = s?.anchors[idx];
    if (!a) return;
    const isCorner = a.ix === a.x && a.iy === a.y && a.ox === a.x && a.oy === a.y;
    if (isCorner) {
      const prev = s.anchors[(idx - 1 + s.anchors.length) % s.anchors.length];
      const next = s.anchors[(idx + 1) % s.anchors.length];
      const tx = (next.x - prev.x) / 6;
      const ty = (next.y - prev.y) / 6;
      Object.assign(a, { ix: a.x - tx, iy: a.y - ty, ox: a.x + tx, oy: a.y + ty });
    } else Object.assign(a, { ix: a.x, iy: a.y, ox: a.x, oy: a.y });
    writePath(g.o.id, p);
  };

  /** Ctrl+click on the path inserts an anchor (de Casteljau split of the nearest segment). */
  const insertAnchor = (cp: Pt) => {
    const g = nodeGeom();
    if (!g) return false;
    const lp = applyM(g.inv, cp.x, cp.y);
    const p = parseSvgPath(g.o.path);
    let best = { d: Infinity, sub: 0, i: 0, t: 0 };
    p.forEach((s, si) => {
      const n = s.closed ? s.anchors.length : s.anchors.length - 1;
      for (let i = 0; i < n; i++) {
        const a = s.anchors[i];
        const b = s.anchors[(i + 1) % s.anchors.length];
        for (let k = 1; k < 20; k++) {
          const t = k / 20;
          const u = 1 - t;
          const x = u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x;
          const y = u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y;
          const d = Math.hypot(x - lp.x, y - lp.y);
          if (d < best.d) best = { d, sub: si, i, t };
        }
      }
    });
    if (!isFinite(best.d) || best.d > 6) return false;
    const s = p[best.sub];
    const a = s.anchors[best.i];
    const b = s.anchors[(best.i + 1) % s.anchors.length];
    const t = best.t;
    const L = (p0: Vec2, p1: Vec2): Vec2 => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
    const p01 = L([a.x, a.y], [a.ox, a.oy]);
    const p12 = L([a.ox, a.oy], [b.ix, b.iy]);
    const p23 = L([b.ix, b.iy], [b.x, b.y]);
    const p012 = L(p01, p12);
    const p123 = L(p12, p23);
    const m = L(p012, p123);
    a.ox = p01[0];
    a.oy = p01[1];
    b.ix = p23[0];
    b.iy = p23[1];
    s.anchors.splice(best.i + 1, 0, { x: m[0], y: m[1], ix: p012[0], iy: p012[1], ox: p123[0], oy: p123[1] });
    writePath(g.o.id, p);
    return true;
  };

  vp.deleteAnchor = () => {
    const sel = nodeSel.current;
    const g = nodeGeom();
    if (!sel || !g) return false;
    const p = parseSvgPath(g.o.path);
    const s = p[sel.sub];
    if (!s || s.anchors.length <= 2) return false;
    s.anchors.splice(sel.idx, 1);
    nodeSel.current = null;
    writePath(g.o.id, p);
    return true;
  };

  /* ---------- pen ---------- */
  const finishPen = (closed = false) => {
    const { anchors } = penRef.current;
    setPen({ anchors: [], cursor: null });
    if (anchors.length < 2) return;
    const u = rdRef.current?.lastU ?? 1;
    const Hu = stageH(sceneRef.current);
    const s = getState();
    const mapped: Anchor[] = anchors.map((a) => ({ x: a.x / u, y: a.y / u, ix: a.ix / u, iy: a.iy / u, ox: a.ox / u, oy: a.oy / u }));
    const { path, cx, cy } = recenter([{ closed, anchors: mapped }]);
    addObject(
      {
        label: closed ? "Pen Shape" : "Pen Path",
        path: toSvgPath(path),
        x: f2(cx),
        y: f2((cy / Hu) * 100),
        fill: closed ? s.brush.color : "none",
        stroke: closed ? null : s.brush.color,
        strokeWidth: s.brush.width,
      },
      "Pen path",
    );
    setTool("select");
    setState({ editNodes: true });
  };
  vp.finishPen = () => finishPen(false);
  vp.cancelPen = () => setPen({ anchors: [], cursor: null });

  /* ---------- pointer routing ---------- */
  const panDrag = (e: React.PointerEvent) => {
    const sx = e.clientX;
    const sy = e.clientY;
    const v0 = viewRef.current;
    const move = (ev: PointerEvent) => setView({ ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      return panDrag(e);
    }
    if (tool === "hand") {
      e.preventDefault();
      return panDrag(e);
    }
    if (e.button !== 0 || zen) return;
    const rd = rdRef.current;
    if (!rd) return;
    const p = canvasPoint(e);
    if (tool === "eyedropper") {
      const px = rd.canvas.getContext("2d")!.getImageData(Math.max(0, Math.min(rd.canvas.width - 1, Math.round(p.x))), Math.max(0, Math.min(rd.canvas.height - 1, Math.round(p.y))), 1, 1).data;
      const hex = toHex(`rgb(${px[0]},${px[1]},${px[2]})`).toUpperCase();
      setState((s) => ({ brush: { ...s.brush, color: hex } }));
      const sel = getState().selection[0];
      if (sel && getState().scene.objects.some((o) => o.id === sel && o.kind !== "image")) commit((sc) => void (sc.objects.find((o) => o.id === sel)!.fill = hex), undefined, "Eyedropper fill");
      toast(`Picked ${hex}${sel ? " → applied to selection" : " (brush colour)"}`);
      return setTool("select");
    }
    const u = rd.lastU;
    const Hu = stageH(sceneRef.current);

    if (tool === "brush") {
      const pts = [p];
      setStroke(pts);
      const move = (ev: PointerEvent) => {
        pts.push(canvasPoint(ev));
        setStroke([...pts]);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setStroke(null);
        const b = getState().brush;
        const sub = fitFreehand(pts.map((q) => [q.x / u, q.y / u] as Vec2), b.smoothing);
        if (!sub) return;
        const { path, cx, cy } = recenter([sub]);
        const tapered = b.taper > 0.02;
        addObject(
          {
            label: "Brush Stroke",
            path: tapered ? taperD(path, b.width * 2.2, b.taper) : toSvgPath(path),
            x: f2(cx),
            y: f2((cy / Hu) * 100),
            fill: tapered ? b.color : "none",
            stroke: tapered ? null : b.color,
            strokeWidth: b.width,
          },
          "Freehand stroke",
        );
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }

    if (tool === "pen") {
      const cur = penRef.current.anchors;
      if (cur.length >= 2 && Math.hypot(p.x - cur[0].x, p.y - cur[0].y) < 12) return finishPen(true);
      const idx = cur.length;
      setPen({ anchors: [...cur, corner(p.x, p.y)], cursor: p });
      const move = (ev: PointerEvent) => {
        const q = canvasPoint(ev);
        if (Math.hypot(q.x - p.x, q.y - p.y) < 4) return;
        const next = penRef.current.anchors.map((a, i) => (i === idx ? { ...a, ox: q.x, oy: q.y, ix: 2 * p.x - q.x, iy: 2 * p.y - q.y } : a));
        setPen({ anchors: next, cursor: q });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }

    if (tool === "shape") {
      setRect({ a: p, b: p });
      const move = (ev: PointerEvent) => setRect({ a: p, b: canvasPoint(ev) });
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setRect(null);
        const q = canvasPoint(ev);
        let w = Math.abs(q.x - p.x) / u;
        let h = Math.abs(q.y - p.y) / u;
        let cx = (p.x + q.x) / 2 / u;
        let cy = (p.y + q.y) / 2 / u;
        const kind = getState().shapeKind;
        if (w < 1.5 && h < 1.5) {
          w = 14;
          h = kind === "line" ? 0.1 : 14;
          cx = p.x / u;
          cy = p.y / u;
        }
        addObject(
          {
            label: kind[0].toUpperCase() + kind.slice(1),
            path: toSvgPath(makeShape(kind, w, Math.max(h, 0.1))),
            x: f2(cx),
            y: f2((cy / Hu) * 100),
            fill: kind === "line" ? "none" : PALETTE[Math.floor(Math.random() * PALETTE.length)],
            stroke: kind === "line" ? "#E5E7EB" : null,
            strokeWidth: kind === "line" ? 0.6 : 0.4,
          },
          `Create ${kind}`,
        );
        setTool("select");
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }

    if (tool === "text") {
      const g = toGrid(p);
      runOps([{ op: "add_text", content: "Kinetic Type", size: 7, x: g.x, y: g.y, force_new: true }], "Text");
      return setTool("select");
    }
    if (tool === "light") {
      const g = toGrid(p);
      runOps([{ op: "add_light", type: "spot", origin_x: g.x, origin_y: Math.max(3, g.y - 25), target_x: g.x, target_y: Math.min(97, g.y + 15), color: "#FFE3A3", falloff: 90, cone: 24 }], "Light");
      return setTool("select");
    }

    // select tool
    if (nodeActive && e.ctrlKey && insertAnchor(p)) return;
    const g = rd.gizmo;
    if (g && Math.hypot(p.x - g.rot.x, p.y - g.rot.y) < 11) return beginDrag({ kind: "rotate", id: g.id }, p);
    if (g && Math.hypot(p.x - g.scale.x, p.y - g.scale.y) < 11) return beginDrag({ kind: "scale", id: g.id }, p);
    const m = rd.hitMarker(p.x, p.y);
    if (m) {
      select([m.id]);
      return beginDrag({ kind: "marker", id: m.id }, p);
    }
    const hit = rd.hitTest(sceneRef.current, p.x, p.y);
    if (hit) {
      const cur = getState().selection;
      if (e.shiftKey) {
        select(cur.includes(hit) ? cur.filter((x) => x !== hit) : [...cur, hit]);
        return;
      }
      select([hit]);
      return beginDrag({ kind: "move", id: hit }, p);
    }
    select([]);
  };

  const onMove = (e: React.PointerEvent) => {
    if (tool === "pen" && penRef.current.anchors.length) {
      const c = canvasPoint(e);
      setPen((s) => ({ ...s, cursor: c }));
    }
  };

  const onDouble = (e: React.MouseEvent) => {
    if (zen || tool !== "select") return;
    const rd = rdRef.current;
    if (!rd) return;
    const p = canvasPoint(e);
    const hit = rd.hitTest(sceneRef.current, p.x, p.y);
    if (hit) {
      const o = sceneRef.current.objects.find((q) => q.id === hit);
      select([hit]);
      if (o?.kind === "shape") setState({ editNodes: !getState().editNodes });
    }
  };

  const onMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const rd = rdRef.current;
    if (!rd) return;
    const p = canvasPoint(e);
    const g = toGrid(p);
    const hit = rd.hitTest(sceneRef.current, p.x, p.y);
    if (hit) {
      select([hit]);
      return openMenu(e.clientX, e.clientY, objectMenu(hit, e.clientX, e.clientY));
    }
    const s = getState();
    openMenu(e.clientX, e.clientY, [
      { label: "Import Image…", shortcut: keyLabel("import_image"), onClick: triggerImport },
      { label: "Add Text", onClick: () => runOps([{ op: "add_text", content: "Kinetic Type", size: 7, x: g.x, y: g.y, force_new: true }], "Text") },
      { label: "Add Area Light here", onClick: () => runOps([{ op: "add_light", type: "point", x: g.x, y: g.y, color: "#FFD08A", radius: 60 }], "Light") },
      { label: "Add Spot Beam here", onClick: () => runOps([{ op: "add_light", type: "spot", origin_x: g.x, origin_y: Math.max(3, g.y - 25), target_x: g.x, target_y: Math.min(97, g.y + 15), color: "#FFE3A3", falloff: 90, cone: 24 }], "Light") },
      { label: "Add Directional Rim Light", onClick: () => runOps([{ op: "add_light", type: "sun", origin_x: 8, origin_y: 6, target_x: g.x, target_y: g.y, color: "#06B6D4", intensity: 1, volumetric: false }], "Light") },
      { sep: true, label: "" },
      { label: "Fit to Window", shortcut: keyLabel("zoom_fit"), onClick: () => setState({ fitTick: getState().fitTick + 1 }) },
      { label: s.showGrid ? "Hide Grid" : "Show Grid", shortcut: keyLabel("toggle_grid"), onClick: () => setState({ showGrid: !getState().showGrid }) },
      { label: s.onion ? "Disable Onion Skin" : "Enable Onion Skin", shortcut: keyLabel("onion_toggle"), onClick: () => setState({ onion: !getState().onion }) },
      { label: s.snap ? "Disable Snapping" : "Enable Snapping", shortcut: keyLabel("toggle_snap"), onClick: () => setState({ snap: !getState().snap }) },
    ]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const g = toGrid(canvasPoint(e));
    files.forEach((f, i) => void importImageFile(f, { x: g.x + i * 4, y: g.y + i * 4 }));
  };

  /* ---------- keyboard-local: space pan, wheel zoom ---------- */
  useEffect(() => {
    const d = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = true;
    };
    const u = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
    };
  }, []);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      setView({ ...v, zoom: Math.min(6, Math.max(0.25, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  useEffect(() => {
    vp.exportFrame = () =>
      new Promise((res) => {
        const c = canvasRef.current;
        if (!c) return res(null);
        rdRef.current?.render(getState().scene, { t: live.t, editor: false });
        c.toBlob((b) => res(b), "image/png");
        dirty.current = true;
      });
  }, []);

  useEffect(() => {
    const zoomTo = (f: (z: number) => number) => setView((v) => ({ ...v, zoom: Math.min(6, Math.max(0.25, f(v.zoom))) }));
    vp.zoomIn = () => zoomTo((z) => z * 1.25);
    vp.zoomOut = () => zoomTo((z) => z / 1.25);
    vp.zoomFit = () => setState({ fitTick: getState().fitTick + 1 });
    vp.zoomReset = () => setView({ zoom: 1, x: 0, y: 0 });
  }, []);

  /* ---------- overlay geometry ---------- */
  const cw = canvasRef.current?.width ?? size.w;
  const ch = canvasRef.current?.height ?? size.h;
  const nodes = nodeActive ? nodeGeom() : null;

  const penPath = pen.anchors.length ? pathD(pen.anchors, false) : "";
  const penRubber =
    pen.anchors.length && pen.cursor
      ? (() => {
          const a = pen.anchors[pen.anchors.length - 1];
          return `M${a.x} ${a.y}C${a.ox} ${a.oy} ${pen.cursor.x} ${pen.cursor.y} ${pen.cursor.x} ${pen.cursor.y}`;
        })()
      : "";
  const cursor = tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";

  return (
    <div ref={stageRef} data-help="viewport" className="relative min-h-0 flex-1 overflow-hidden bg-[#07090E]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.04) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
      <div
        className="absolute left-1/2 top-1/2 shadow-[0_20px_80px_rgba(0,0,0,.6)]"
        style={{ width: size.w, height: size.h, transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.zoom})` }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onDoubleClick={onDouble} onContextMenu={onMenu} style={{ width: size.w, height: size.h, display: "block", cursor, touchAction: "none" }} aria-label="Animation viewport" />
        <canvas ref={onionRef} style={{ width: size.w, height: size.h, opacity: onion && !playing && !zen ? 0.28 : 0, pointerEvents: "none", position: "absolute", inset: 0, mixBlendMode: "screen" }} />
        {!zen && (
          <svg viewBox={`0 0 ${cw} ${ch}`} className="pointer-events-none absolute inset-0" style={{ width: size.w, height: size.h, overflow: "visible" }}>
            {showGrid &&
              Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((g) => (
                <g key={g} stroke="rgba(255,255,255,0.07)" strokeWidth={1}>
                  <line x1={(cw * g) / 100} y1={0} x2={(cw * g) / 100} y2={ch} />
                  <line x1={0} y1={(cw * g) / 100} x2={cw} y2={(cw * g) / 100} />
                </g>
              ))}
            {stroke && stroke.length > 1 && <polyline points={stroke.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={brush.color} strokeWidth={Math.max(1.5, brush.width * (cw / 100))} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />}
            {rect && <rect x={Math.min(rect.a.x, rect.b.x)} y={Math.min(rect.a.y, rect.b.y)} width={Math.abs(rect.b.x - rect.a.x)} height={Math.abs(rect.b.y - rect.a.y)} fill="rgba(59,130,246,.15)" stroke="#3B82F6" strokeDasharray="6 4" />}
            {pen.anchors.length > 0 && (
              <g>
                <path d={penPath} fill="none" stroke="#06B6D4" strokeWidth={2} />
                <path d={penRubber} fill="none" stroke="#06B6D4" strokeWidth={1.2} strokeDasharray="5 4" opacity={0.7} />
                {pen.anchors.map((a, i) => (
                  <g key={i}>
                    {(a.ox !== a.x || a.oy !== a.y) && (
                      <>
                        <line x1={a.ix} y1={a.iy} x2={a.ox} y2={a.oy} stroke="#06B6D4" strokeWidth={1} />
                        <circle cx={a.ix} cy={a.iy} r={3.5} fill="#07090E" stroke="#06B6D4" />
                        <circle cx={a.ox} cy={a.oy} r={3.5} fill="#07090E" stroke="#06B6D4" />
                      </>
                    )}
                    <rect x={a.x - 4.5} y={a.y - 4.5} width={9} height={9} fill={i === 0 ? "#F59E0B" : "#fff"} stroke="#06B6D4" />
                  </g>
                ))}
              </g>
            )}
            {!playing && <LightHandles scene={scene} selId={selection[0] ?? null} u={cw / 100} onSelect={(id) => select([id])} onHandle={(kind, id, e) => {
              e.stopPropagation();
              e.preventDefault();
              select([id]);
              beginDrag({ kind, id }, canvasPoint(e));
            }} />}
            {nodes &&
              nodes.path.map((s, si) => (
                <g key={si} className="pointer-events-auto">
                  {s.anchors.map((a, i) => {
                    const A = applyM(nodes.M, a.x, a.y);
                    const I = applyM(nodes.M, a.ix, a.iy);
                    const O = applyM(nodes.M, a.ox, a.oy);
                    const hasH = a.ix !== a.x || a.iy !== a.y || a.ox !== a.x || a.oy !== a.y;
                    const on = nodeSel.current?.sub === si && nodeSel.current.idx === i;
                    return (
                      <g key={i}>
                        {hasH && (
                          <>
                            <line x1={I.x} y1={I.y} x2={O.x} y2={O.y} stroke="#F59E0B" strokeWidth={1} opacity={0.8} />
                            <circle cx={I.x} cy={I.y} r={4} fill="#07090E" stroke="#F59E0B" strokeWidth={1.5} onPointerDown={(e) => nodeDown(e, si, i, "i")} style={{ cursor: "move" }} />
                            <circle cx={O.x} cy={O.y} r={4} fill="#07090E" stroke="#F59E0B" strokeWidth={1.5} onPointerDown={(e) => nodeDown(e, si, i, "o")} style={{ cursor: "move" }} />
                          </>
                        )}
                        <rect
                          x={A.x - 5}
                          y={A.y - 5}
                          width={10}
                          height={10}
                          fill={on ? "#3B82F6" : "#fff"}
                          stroke="#3B82F6"
                          strokeWidth={1.5}
                          onPointerDown={(e) => nodeDown(e, si, i, "a")}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            toggleSmooth(si, i);
                          }}
                          style={{ cursor: "move" }}
                        />
                      </g>
                    );
                  })}
                </g>
              ))}
          </svg>
        )}
      </div>

      {!zen && <Rulers size={size} view={view} height={scene.height} stage={stageRef.current} />}

      {!zen && (
        <div className="pointer-events-none absolute bottom-2 left-9 flex gap-2 font-mono text-[10px] text-white/60">
          <span className="rounded bg-black/50 px-1.5 py-0.5">0–100 grid · {scene.width}×{scene.height}</span>
          <LiveSeconds />
          <span className="rounded bg-black/50 px-1.5 py-0.5 tabular-nums">{Math.round(view.zoom * 100)}%</span>
          {tool === "pen" && <span className="rounded bg-cyan/20 px-1.5 py-0.5 text-cyan">Pen: click / drag · Enter finish · click first anchor to close</span>}
          {nodeActive && <span className="rounded bg-amber/20 px-1.5 py-0.5 text-amber">Nodes: drag · dbl-click smooth/corner · Ctrl+click add · Del remove</span>}
        </div>
      )}
      {!zen && (
        <div data-help="fps" className="absolute right-3 top-6 rounded-full bg-black/50 px-2 py-0.5 font-mono text-[10px] tabular-nums text-amber">
          <FpsBadge />
        </div>
      )}
      {!ready && <div className="absolute inset-0 grid place-items-center bg-[#07090E] text-xs text-[#6F788D]">Loading project…</div>}
    </div>
  );
}

/** Normalised 0–100 ruler (top) and export-pixel ruler (left), anchored to the zoomed / panned stage. */
function Rulers({ size, view, height, stage }: { size: { w: number; h: number }; view: { zoom: number; x: number; y: number }; height: number; stage: HTMLDivElement | null }) {
  if (!stage) return null;
  const w = size.w * view.zoom;
  const h = size.h * view.zoom;
  const x0 = (stage.clientWidth - w) / 2 + view.x;
  const y0 = (stage.clientHeight - h) / 2 + view.y;
  const ticksX = Array.from({ length: 11 }, (_, i) => i * 10);
  const stepY = height > 800 ? 200 : 100;
  const ticksY = Array.from({ length: Math.floor(height / stepY) + 1 }, (_, i) => i * stepY);
  return (
    <>
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-[16px] border-b border-white/10 bg-[#0B0E15]/90">
        {ticksX.map((g) => (
          <span key={g} className="mono absolute top-0 text-[8.5px] text-[#6F788D]" style={{ left: x0 + (w * g) / 100 }}>
            <i className="absolute left-0 top-0 h-[16px] w-px bg-white/15" />
            <b className="ml-1 font-normal">{g}</b>
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 top-[16px] w-[28px] overflow-hidden border-r border-white/10 bg-[#0B0E15]/90">
        {ticksY.map((px) => (
          <span key={px} className="mono absolute left-0 text-[8px] text-[#6F788D]" style={{ top: y0 + (h * px) / height - 16 }}>
            <i className="absolute left-0 top-0 h-px w-[28px] bg-white/15" />
            <b className="absolute left-0.5 top-[2px] font-normal">{px}</b>
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute left-0 top-0 grid h-[16px] w-[28px] place-items-center bg-[#0B0E15] text-[7px] text-[#6F788D]">%/px</div>
    </>
  );
}

/** Seconds readout written straight to the DOM from the live clock. */
function LiveSeconds() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const set = (t: number) => {
      if (ref.current) ref.current.textContent = `${t.toFixed(2)}s`;
    };
    set(live.t);
    return onLive(set);
  }, []);
  return <span ref={ref} className="rounded bg-black/50 px-1.5 py-0.5 tabular-nums" />;
}

/** FPS badge: polls the loop's counter once per second (no per-frame React work). */
function FpsBadge() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFps(perf.fps), 500);
    return () => window.clearInterval(id);
  }, []);
  return <>{fps} FPS</>;
}

type HandleKind = "lorigin" | "ltarget" | "lcone" | "lfalloff";
const TYPE_LABEL = { spot: "Spot / Cone Beam", sun: "Directional Rim Light", point: "Area / Point Light" } as const;

/**
 * Editor-only wireframe for light emitters. Lights are invisible in playback and export; while editing, each one gets a
 * dashed origin handle, and the selected one also gets its aim target, cone-spread and falloff handles.
 */
const LightHandles = memo(function LightHandles({ scene, selId, u, onSelect, onHandle }: { scene: Scene; selId: string | null; u: number; onSelect: (id: string) => void; onHandle: (k: HandleKind, id: string, e: React.PointerEvent) => void }) {
  const time = useStore((s) => s.time);
  if (!scene.lights.length) return null;
  const lights: LiveLight[] = evalLights(scene, time, resolveScene(scene, time));
  const dash = "5 4";
  return (
    <g className="pointer-events-auto" fontFamily="JetBrains Mono Variable, monospace">
      {lights.map((L) => {
        const on = L.l.id === selId;
        const ox = L.x * u;
        const oy = L.y * u;
        const tx = L.tx * u;
        const ty = L.ty * u;
        const col = on ? "#F59E0B" : "rgba(245,158,11,0.5)";
        const beam = (L.angle * Math.PI) / 180;
        const len = L.radius * u * 1.5;
        const point = L.l.type === "point";
        const sun = L.l.type === "sun";
        // directional: direction of travel is origin → target
        const dx = tx - ox;
        const dy = ty - oy;
        const dl = Math.hypot(dx, dy) || 1;
        const nx = -dy / dl;
        const ny = dx / dl;
        return (
          <g key={L.l.id} opacity={on ? 1 : 0.8}>
            {/* origin: dashed wireframe — NOT a sun; this ring is only drawn while editing */}
            <circle cx={ox} cy={oy} r={on ? 12 : 8} fill="rgba(7,9,14,0.55)" stroke={col} strokeWidth={1.4} strokeDasharray={dash} data-help="light-origin" onPointerDown={(e) => (on ? onHandle("lorigin", L.l.id, e) : (e.stopPropagation(), onSelect(L.l.id)))} style={{ cursor: "move" }} />
            <path d={`M${ox - 4} ${oy}H${ox + 4}M${ox} ${oy - 4}V${oy + 4}`} stroke={col} strokeWidth={1.2} pointerEvents="none" />
            {on && (
              <>
                <text x={ox + 16} y={oy - 10} fontSize={10} fill="#F59E0B" pointerEvents="none">{TYPE_LABEL[L.l.type]} · {L.l.label}</text>
                {!point && (
                  <>
                    <line x1={ox} y1={oy} x2={tx} y2={ty} stroke="#F59E0B" strokeWidth={1.2} strokeDasharray={dash} pointerEvents="none" />
                    {sun &&
                      [-2, -1, 1, 2].map((k) => (
                        <line key={k} x1={ox + nx * k * 14} y1={oy + ny * k * 14} x2={tx + nx * k * 14} y2={ty + ny * k * 14} stroke="#F59E0B" strokeWidth={0.9} strokeDasharray="3 6" opacity={0.6} pointerEvents="none" />
                      ))}
                    <circle cx={tx} cy={ty} r={10} fill="rgba(7,9,14,0.55)" stroke="#06B6D4" strokeWidth={1.6} strokeDasharray={dash} data-help="light-target" onPointerDown={(e) => onHandle("ltarget", L.l.id, e)} style={{ cursor: "crosshair" }} />
                    <path d={`M${tx - 6} ${ty}H${tx + 6}M${tx} ${ty - 6}V${ty + 6}`} stroke="#06B6D4" strokeWidth={1.2} pointerEvents="none" />
                    <text x={tx + 14} y={ty - 8} fontSize={9.5} fill="#06B6D4" pointerEvents="none">aim</text>
                  </>
                )}
                {L.l.type === "spot" && (
                  <>
                    {[-1, 1].map((sg) => (
                      <line key={sg} x1={ox} y1={oy} x2={ox + Math.cos(beam + sg * ((L.cone * Math.PI) / 180)) * len} y2={oy + Math.sin(beam + sg * ((L.cone * Math.PI) / 180)) * len} stroke="#F59E0B" strokeWidth={1} strokeDasharray={dash} opacity={0.8} pointerEvents="none" />
                    ))}
                    <path d={`M${ox + Math.cos(beam - (L.cone * Math.PI) / 180) * len} ${oy + Math.sin(beam - (L.cone * Math.PI) / 180) * len}A${len} ${len} 0 0 1 ${ox + Math.cos(beam + (L.cone * Math.PI) / 180) * len} ${oy + Math.sin(beam + (L.cone * Math.PI) / 180) * len}`} fill="none" stroke="#F59E0B" strokeWidth={0.8} strokeDasharray="2 5" opacity={0.6} pointerEvents="none" />
                    <rect x={ox + Math.cos(beam + (L.cone * Math.PI) / 180) * len * 0.8 - 5} y={oy + Math.sin(beam + (L.cone * Math.PI) / 180) * len * 0.8 - 5} width={10} height={10} transform={`rotate(45 ${ox + Math.cos(beam + (L.cone * Math.PI) / 180) * len * 0.8} ${oy + Math.sin(beam + (L.cone * Math.PI) / 180) * len * 0.8})`} fill="#07090E" stroke="#F59E0B" strokeWidth={1.5} data-help="light-cone" onPointerDown={(e) => onHandle("lcone", L.l.id, e)} style={{ cursor: "ew-resize" }} />
                    <circle cx={ox + Math.cos(beam) * len} cy={oy + Math.sin(beam) * len} r={5} fill="#07090E" stroke="#F59E0B" strokeWidth={1.5} data-help="light-falloff" onPointerDown={(e) => onHandle("lfalloff", L.l.id, e)} style={{ cursor: "ew-resize" }} />
                  </>
                )}
                {point && (
                  <>
                    <circle cx={ox} cy={oy} r={L.radius * u * 0.95} fill="none" stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 6" opacity={0.6} pointerEvents="none" />
                    <circle cx={ox + L.radius * u * 0.95} cy={oy} r={5} fill="#07090E" stroke="#F59E0B" strokeWidth={1.5} data-help="light-falloff" onPointerDown={(e) => onHandle("lfalloff", L.l.id, e)} style={{ cursor: "ew-resize" }} />
                  </>
                )}
              </>
            )}
          </g>
        );
      })}
    </g>
  );
});
