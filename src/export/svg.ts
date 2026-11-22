// Static SVG snapshot of the scene at time `t`, built from the same resolved rig the Renderer draws
// (parent-child matrices, keyframes, morph). Lighting/bloom/particles are raster effects and are not part of SVG.
import { clamp, mixColor } from "../engine/math";
import { Sub, boundsOf, lerpSubs, parseCached, prepareMorph, subsToD } from "../engine/path";
import { resolveScene, stageH } from "../engine/rig";
import type { Scene, SceneObject } from "../engine/types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => String(Math.round(v * 10000) / 10000);

const BLEND: Record<string, string> = {
  "source-over": "normal",
  screen: "screen",
  multiply: "multiply",
  overlay: "overlay",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  "color-dodge": "color-dodge",
  difference: "difference",
  lighter: "plus-lighter",
  "plus-lighter": "plus-lighter",
};

function geometry(o: SceneObject, morph: number): { d: string; subs: Sub[] } {
  if (o.morphTo && morph > 0.0005) {
    const m = prepareMorph(o.path, o.morphTo, parseCached);
    const subs = lerpSubs(m.a, m.b, clamp(morph, 0, 1));
    return { d: subsToD(subs), subs };
  }
  return { d: o.path, subs: parseCached(o.path) };
}

/** `imageSrc(id)` should return a data URL for imported sprites so the SVG is self-contained. */
export function sceneToSvg(scene: Scene, t: number, imageSrc: (id: string) => string | null = () => null): string {
  const Hu = stageH(scene);
  const res = resolveScene(scene, t);
  const defs: string[] = [];
  const body: string[] = [];

  // sky
  const sky = scene.env.sky.length ? scene.env.sky : [{ at: 0, color: "#07090E" }];
  defs.push(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${sky.map((s) => `<stop offset="${n(s.at)}" stop-color="${esc(s.color)}"/>`).join("")}</linearGradient>`);
  body.push(`<rect id="sky-rect" width="100" height="${n(Hu)}" fill="url(#sky)"/>`);
  if (scene.env.sun) {
    const s = scene.env.sun;
    body.push(`<circle id="sun" cx="${n(s.x)}" cy="${n((s.y / 100) * Hu)}" r="${n(s.r)}" fill="${esc(s.color)}"/>`);
  }

  scene.objects.forEach((o, i) => {
    const r = res.get(o.id);
    if (!r || r.hidden || r.opacity <= 0.002) return;
    const attrs: string[] = [`id="${esc(o.id)}"`, `data-label="${esc(o.label)}"`, `transform="matrix(${r.geom.map(n).join(" ")})"`];
    if (r.opacity < 0.999) attrs.push(`opacity="${n(clamp(r.opacity, 0, 1))}"`);
    const style: string[] = [];
    if (o.blend !== "source-over") style.push(`mix-blend-mode:${BLEND[o.blend] ?? "normal"}`);

    const filters: string[] = [];
    if (o.shadow && o.shadow.opacity > 0) {
      defs.push(`<filter id="sh${i}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${n(o.shadow.dx)}" dy="${n(o.shadow.auto ? o.shadow.dx : o.shadow.dy)}" stdDeviation="${n(o.shadow.blur / 2)}" flood-color="#000" flood-opacity="${n(o.shadow.opacity)}"/></filter>`);
      filters.push(`url(#sh${i})`);
    }
    if (r.ev.glow > 0) {
      defs.push(`<filter id="gl${i}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${n(r.ev.glow * 1.5)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
      filters.push(`url(#gl${i})`);
    }
    if (filters.length) style.push(`filter:${filters.join(" ")}`);
    if (style.length) attrs.push(`style="${style.join(";")}"`);

    let fill = o.fillTo ? mixColor(o.fill, o.fillTo, r.ev.morph) : o.fill;
    const strokeAttr = o.stroke ? ` stroke="${esc(o.stroke)}" stroke-width="${n(o.strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"` : "";

    if (o.kind === "text" && o.text) {
      const tx = o.text;
      const anchor = tx.align === "left" ? "start" : tx.align === "right" ? "end" : "middle";
      const fam = tx.font === "mono" ? "'JetBrains Mono', monospace" : "Inter, sans-serif";
      body.push(`<g ${attrs.join(" ")}><text text-anchor="${anchor}" dominant-baseline="central" font-family="${esc(fam)}" font-size="${n(tx.size)}" font-weight="${tx.weight}" fill="${esc(fill)}"${strokeAttr}>${esc(tx.content)}</text></g>`);
      return;
    }

    const { d, subs } = geometry(o, r.ev.morph);
    const b = boundsOf(subs);
    const img = o.image ? imageSrc(o.image) : null;
    if (img) {
      defs.push(`<clipPath id="cp${i}"><path d="${esc(d)}"/></clipPath>`);
      body.push(`<g ${attrs.join(" ")}><g clip-path="url(#cp${i})"><image href="${esc(img)}" x="${n(b.x0)}" y="${n(b.y0)}" width="${n(b.x1 - b.x0)}" height="${n(b.y1 - b.y0)}" preserveAspectRatio="none"/></g>${o.stroke ? `<path d="${esc(d)}" fill="none"${strokeAttr}/>` : ""}</g>`);
      return;
    }
    if (o.gradient && fill !== "none") {
      const a = (o.gradient.angle * Math.PI) / 180;
      const hx = Math.cos(a) / 2;
      const hy = Math.sin(a) / 2;
      defs.push(`<linearGradient id="lg${i}" x1="${n(0.5 - hx)}" y1="${n(0.5 - hy)}" x2="${n(0.5 + hx)}" y2="${n(0.5 + hy)}"><stop offset="0" stop-color="${esc(o.gradient.from)}"/><stop offset="1" stop-color="${esc(o.gradient.to)}"/></linearGradient>`);
      fill = `url(#lg${i})`;
    }
    body.push(`<g ${attrs.join(" ")}><path d="${esc(d)}" fill="${esc(o.fill === "none" ? "none" : fill)}"${strokeAttr}/></g>`);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 ${n(Hu)}" width="${scene.width}" height="${scene.height}" data-kinetix-scene="${esc(scene.name)}" data-t="${n(t)}">
<title>${esc(scene.name)} — t=${n(t)}s</title>
<defs>
${defs.join("\n")}
</defs>
${body.join("\n")}
</svg>
`;
}
