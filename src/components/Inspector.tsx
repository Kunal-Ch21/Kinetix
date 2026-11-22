import { useState } from "react";
import { buildMorph, upsertKey } from "@/engine/anim";
import { Ease } from "@/engine/math";
import { evalObj, evalProp } from "@/engine/rig";
import { ENV_PRESETS, cloneEnv, descendantsOf } from "@/engine/scene";
import type { Emitter, EmitterKind, Light, Scene, SceneObject, TextSpec } from "@/engine/types";
import { CurveEditor } from "./CurveEditor";
import { KeyRef, keyAll, lookup, setLightProp, setObjProp, trackOwner } from "./helpers";
import { Btn, ColorField, Num, Section, Select, TextField, Toggle } from "./ui";

type Tab = "props" | "light" | "rig" | "world" | "curve";
const BLENDS = ["source-over", "screen", "lighter", "multiply", "overlay", "soft-light", "hard-light", "color-dodge", "difference", "plus-lighter"];
const EMITTERS: EmitterKind[] = ["embers", "sparks", "mist", "rain", "snow", "trail"];

interface Props {
  scene: Scene;
  selId: string | null;
  time: number;
  commit: (fn: (s: Scene) => void, coalesce?: string) => void;
  selKey: KeyRef | null;
  onSelect: (id: string | null) => void;
  onClone: (id: string) => void;
  onAddEmitter: (kind: string) => void;
}

export function Inspector(p: Props) {
  const [tab, setTab] = useState<Tab>("props");
  const sel = lookup(p.scene, p.selId);
  const tabs: [Tab, string][] = [
    ["props", "Properties"],
    ["light", "Lighting"],
    ["rig", "Rig & Morph"],
    ["world", "World"],
    ["curve", "Curve"],
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-0.5 border-b border-white/[0.07] px-2 pt-2">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-t-md px-2 py-1.5 text-[11px] font-medium ${tab === k ? "bg-white/[0.07] text-white shadow-[inset_0_-2px_0_#3B82F6]" : "text-[#7F889D] hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="kx-scroll min-h-0 flex-1 overflow-y-auto">
        {tab === "props" && <PropsTab {...p} sel={sel} />}
        {tab === "light" && <LightTab {...p} sel={sel} />}
        {tab === "rig" && <RigTab {...p} sel={sel} />}
        {tab === "world" && <WorldTab {...p} />}
        {tab === "curve" && <CurveTab {...p} />}
      </div>
    </div>
  );
}

/** Lights created before aim targets existed only had an angle — give them an explicit (x2, y2) the first time it is edited. */
function ensureAim(l: Light) {
  if (l.tx !== undefined && l.ty !== undefined) return;
  const a = (l.angle * Math.PI) / 180;
  const sun = l.type === "sun";
  l.tx = sun ? 50 : Math.round((l.x + Math.cos(a) * 25) * 10) / 10;
  l.ty = sun ? 50 : Math.round((l.y + Math.sin(a) * 25) * 10) / 10;
  if (sun) {
    l.x = Math.round((50 + Math.cos(a) * 45) * 10) / 10;
    l.y = Math.round((50 + Math.sin(a) * 45) * 10) / 10;
  }
}

type Sel = ReturnType<typeof lookup>;
const Empty = ({ text }: { text: string }) => <div className="p-4 text-xs leading-relaxed text-[#6F788D]">{text}</div>;

function useEdit(p: Props) {
  return {
    obj: (key: string, fn: (o: SceneObject, s: Scene) => void) =>
      p.commit((s) => {
        const t = lookup(s, p.selId);
        if (t && t.kind === "object") fn(t.item, s);
      }, `${key}:${p.selId}`),
    light: (key: string, fn: (l: Light, s: Scene) => void) =>
      p.commit((s) => {
        const t = lookup(s, p.selId);
        if (t && t.kind === "light") fn(t.item, s);
      }, `${key}:${p.selId}`),
    emitter: (key: string, fn: (e: Emitter) => void) =>
      p.commit((s) => {
        const t = lookup(s, p.selId);
        if (t && t.kind === "emitter") fn(t.item);
      }, `${key}:${p.selId}`),
  };
}

function PropsTab(p: Props & { sel: Sel }) {
  const { sel, time } = p;
  const ed = useEdit(p);
  if (!sel) return <Empty text="Select an object, light or emitter on the canvas, in the outliner, or on the dope sheet to edit it. Drag on the stage to move; use the round handle to rotate and the square corner to scale." />;

  if (sel.kind === "light") {
    const l = sel.item;
    const v = (prop: string, base: number) => evalProp(l.tracks, prop, time, base);
    return (
      <>
        <Section title="Light · invisible emitter">
          <TextField label="Name" value={l.label} onChange={(x) => ed.light("name", (o) => (o.label = x))} />
          <Select label="Type" value={l.type} options={[{ value: "spot", label: "Spot / Cone Beam" }, { value: "sun", label: "Directional Rim Light" }, { value: "point", label: "Area / Point Light" }]} onChange={(x) => ed.light("type", (o) => { o.type = x as Light["type"]; ensureAim(o); })} />
          <ColorField label="Colour" value={l.color} onChange={(c) => ed.light("color", (o) => (o.color = c ?? o.color))} />
          <Num label="Intensity" value={v("intensity", l.intensity)} min={0} max={2.5} step={0.01} onChange={(x) => ed.light("int", (o) => setLightProp(o, "intensity", x, time))} />
          <Num label="Falloff" value={v("radius", l.radius)} min={5} max={150} step={0.5} onChange={(x) => ed.light("rad", (o) => setLightProp(o, "radius", x, time))} />
          {l.type === "spot" && <Num label="Cone spread" value={v("cone", l.cone)} min={3} max={85} step={1} onChange={(x) => ed.light("cone", (o) => setLightProp(o, "cone", x, time))} />}
          <Toggle label="Light shafts (visible beam haze)" value={l.volumetric} onChange={(x) => ed.light("vol", (o) => (o.volumetric = x))} />
          <Toggle label="Enabled" value={l.visible} onChange={(x) => ed.light("vis", (o) => (o.visible = x))} />
        </Section>
        <Section title={l.follow ? "Origin offset (x1, y1)" : "Origin (x1, y1) · 0–100 grid"}>
          <Num label="X1" value={v("x", l.x)} min={l.follow ? -50 : -10} max={l.follow ? 50 : 110} step={0.1} onChange={(x) => ed.light("x", (o) => setLightProp(o, "x", x, time))} />
          <Num label="Y1" value={v("y", l.y)} min={l.follow ? -50 : -10} max={l.follow ? 50 : 110} step={0.1} onChange={(x) => ed.light("y", (o) => setLightProp(o, "y", x, time))} />
          <Select label="Follow" value={l.follow ?? ""} options={[{ value: "", label: "— none —" }, ...p.scene.objects.map((o) => ({ value: o.id, label: o.label }))]} onChange={(x) => ed.light("follow", (o) => (o.follow = x || null))} />
        </Section>
        {l.type !== "point" && (
          <Section title="Aim target (x2, y2)">
            <Num label="X2" value={v("tx", l.tx ?? l.x)} min={-10} max={110} step={0.1} onChange={(x) => ed.light("tx", (o) => { ensureAim(o); setLightProp(o, "tx", x, time); })} />
            <Num label="Y2" value={v("ty", l.ty ?? l.y)} min={-10} max={110} step={0.1} onChange={(x) => ed.light("ty", (o) => { ensureAim(o); setLightProp(o, "ty", x, time); })} />
            <Select label="Aim at" value="" options={[{ value: "", label: "— pick an object —" }, ...p.scene.objects.filter((o) => !o.parent).map((o) => ({ value: o.id, label: o.label }))]} onChange={(id) => id && ed.light("aim", (o, s) => { const t = s.objects.find((q) => q.id === id); if (t) { const e = evalObj(t, time); ensureAim(o); setLightProp(o, "tx", Math.round(e.x * 10) / 10, time); setLightProp(o, "ty", Math.round(e.y * 10) / 10, time); } })} />
          </Section>
        )}
        <Section title="Lights these objects" right={<span className="text-[10px] text-[#6F788D]">{l.affects?.length ? `${l.affects.length} selected` : "all"}</span>}>
          <div className="text-[11px] leading-snug text-[#7d8aa0]">Choose which objects get this light's diffuse glow, directional rim highlight and cast shadow. Leave everything unticked to light all of them.</div>
          <div className="max-h-28 space-y-0.5 overflow-auto">
            {p.scene.objects.filter((o) => !o.parent).map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 text-[11.5px] text-[#9AA3B8]">
                <input type="checkbox" className="accent-cyan" checked={!!l.affects?.includes(o.id)} onChange={(e) => ed.light("aff", (x) => { const set = new Set(x.affects ?? []); if (e.target.checked) set.add(o.id); else set.delete(o.id); x.affects = [...set]; })} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
        </Section>
        <Section title="Animate">
          <div className="flex flex-wrap gap-1">
            {(l.type === "point" ? ["intensity", "x", "y", "radius"] : l.type === "spot" ? ["intensity", "x", "y", "tx", "ty", "radius", "cone"] : ["intensity", "x", "y", "tx", "ty"]).map((prop) => (
              <Btn key={prop} small tone="amber" onClick={() => ed.light("key", (o) => { ensureAim(o); const rec = o as unknown as Record<string, number | undefined>; upsertKey(o, prop, time, evalProp(o.tracks, prop, time, rec[prop] ?? 0)); })}>
                ◆ {prop}
              </Btn>
            ))}
          </div>
          <Btn small tone="danger" onClick={() => p.commit((s) => void (s.lights = s.lights.filter((x) => x.id !== l.id)))}>Delete light</Btn>
        </Section>
      </>
    );
  }

  if (sel.kind === "emitter") {
    const e = sel.item;
    const set = <K extends keyof Emitter>(k: K, v: Emitter[K]) => ed.emitter(String(k), (o) => void (o[k] = v));
    return (
      <>
        <Section title="Particle emitter">
          <TextField label="Name" value={e.label} onChange={(x) => set("label", x)} />
          <Select label="Kind" value={e.kind} options={EMITTERS.map((k) => ({ value: k, label: k }))} onChange={(x) => set("kind", x as EmitterKind)} />
          <Select label="Follow" value={e.follow ?? ""} options={[{ value: "", label: "— fixed —" }, ...p.scene.objects.map((o) => ({ value: o.id, label: o.label }))]} onChange={(x) => set("follow", x || null)} />
          <Select label="Layer" value={e.layer} options={[{ value: "back", label: "Behind objects" }, { value: "front", label: "In front" }]} onChange={(x) => set("layer", x as Emitter["layer"])} />
          <Toggle label="Additive (glow) blend" value={e.additive} onChange={(x) => set("additive", x)} />
          <Toggle label="Visible" value={e.visible} onChange={(x) => set("visible", x)} />
        </Section>
        <Section title="Emission">
          <Num label="Rate /s" value={e.rate} min={0.5} max={250} step={0.5} onChange={(x) => set("rate", x)} />
          <Num label="Life s" value={e.life} min={0.2} max={15} step={0.1} onChange={(x) => set("life", x)} />
          <Num label="Speed" value={e.speed} min={0} max={80} step={0.5} onChange={(x) => set("speed", x)} />
          <Num label="Angle" value={e.angle} min={-180} max={180} step={1} onChange={(x) => set("angle", x)} />
          <Num label="Spread" value={e.spread} min={0} max={360} step={1} onChange={(x) => set("spread", x)} />
          <Num label="Gravity" value={e.gravity} min={-30} max={40} step={0.1} onChange={(x) => set("gravity", x)} />
          <Num label="Size" value={e.size} min={0.1} max={25} step={0.1} onChange={(x) => set("size", x)} />
          <Num label="Width %" value={e.area} min={0} max={120} step={1} onChange={(x) => set("area", x)} />
          <ColorField label="Colour" value={e.color} onChange={(c) => set("color", c ?? e.color)} />
          <ColorField label="Colour → " value={e.color2} allowNone onChange={(c) => set("color2", c)} />
        </Section>
        <Section title="Timing & position">
          <Num label="Start s" value={e.start} min={0} max={p.scene.duration} step={0.1} onChange={(x) => set("start", x)} />
          <Num label="End s (0=∞)" value={e.end} min={0} max={p.scene.duration} step={0.1} onChange={(x) => set("end", x)} />
          {!e.follow && <Num label="X" value={e.x} min={0} max={100} step={0.1} onChange={(x) => set("x", x)} />}
          {!e.follow && <Num label="Y" value={e.y} min={-10} max={110} step={0.1} onChange={(x) => set("y", x)} />}
          <Btn small tone="danger" onClick={() => p.commit((s) => void (s.emitters = s.emitters.filter((x) => x.id !== e.id)))}>Delete emitter</Btn>
        </Section>
      </>
    );
  }

  const o = sel.item;
  const ev = evalObj(o, time);
  const isChild = !!o.parent;
  const set = (prop: string, v: number) => ed.obj(prop, (x) => setObjProp(x, prop, v, time));
  return (
    <>
      <Section title="Object" right={<span className="font-mono text-[10px] text-[#6F788D]">{o.id}</span>}>
        <TextField label="Name" value={o.label} onChange={(x) => ed.obj("label", (c) => (c.label = x))} />
        <TextField label="Aliases" value={o.aliases.join(", ")} onChange={(x) => ed.obj("alias", (c) => (c.aliases = x.split(",").map((a) => a.trim()).filter(Boolean)))} />
        <Toggle label="Visible" value={o.visible} onChange={(x) => ed.obj("vis", (c) => (c.visible = x))} />
      </Section>
      <Section title={isChild ? "Transform (local to parent)" : "Transform (0–100 grid)"}>
        <Num label={isChild ? "dx" : "X"} value={ev.x} min={isChild ? -40 : 0} max={isChild ? 40 : 100} step={0.1} onChange={(v) => set("x", v)} />
        <Num label={isChild ? "dy" : "Y"} value={ev.y} min={isChild ? -40 : 0} max={isChild ? 40 : 100} step={0.1} onChange={(v) => set("y", v)} />
        <Num label="Rotation" value={ev.rotation} min={-360} max={360} step={0.5} onChange={(v) => set("rotation", v)} />
        <Num label="Scale" value={ev.scale} min={0.05} max={6} step={0.01} onChange={(v) => set("scale", v)} />
        <Num label="Opacity" value={ev.opacity} min={0} max={1} step={0.01} onChange={(v) => set("opacity", v)} />
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <Btn small tone="amber" onClick={() => p.commit((s) => { const t = lookup(s, p.selId); if (t?.kind === "object") keyAll(t.item, ["x", "y", "rotation", "scale", "opacity"], time); })}>
            ◆ Key transform
          </Btn>
          <Btn small onClick={() => p.commit((s) => { const t = lookup(s, p.selId); if (t?.kind === "object") t.item.tracks = []; })}>Clear keys</Btn>
        </div>
      </Section>
      <Section title="Fill & stroke">
        <ColorField label="Fill" value={o.fill === "none" ? null : o.fill} allowNone onChange={(c) => ed.obj("fill", (x) => (x.fill = c ?? "none"))} />
        <ColorField label="Morph fill" value={o.fillTo} allowNone onChange={(c) => ed.obj("fillTo", (x) => (x.fillTo = c))} />
        <ColorField label="Stroke" value={o.stroke} allowNone onChange={(c) => ed.obj("stroke", (x) => (x.stroke = c))} />
        <Num label="Stroke w" value={o.strokeWidth} min={0} max={5} step={0.05} onChange={(v) => ed.obj("sw", (x) => (x.strokeWidth = v))} />
        <Toggle label="Linear gradient fill" value={!!o.gradient} onChange={(on) => ed.obj("grad", (x) => (x.gradient = on ? { from: x.fill === "none" ? "#3B82F6" : x.fill, to: "#06B6D4", angle: 90 } : null))} />
        {o.gradient && (
          <>
            <ColorField label="From" value={o.gradient.from} onChange={(c) => ed.obj("g1", (x) => x.gradient && (x.gradient.from = c ?? x.gradient.from))} />
            <ColorField label="To" value={o.gradient.to} onChange={(c) => ed.obj("g2", (x) => x.gradient && (x.gradient.to = c ?? x.gradient.to))} />
            <Num label="Angle" value={o.gradient.angle} min={0} max={360} step={1} onChange={(v) => ed.obj("g3", (x) => x.gradient && (x.gradient.angle = v))} />
          </>
        )}
        <Select label="Blend" value={o.blend} options={BLENDS.map((b) => ({ value: b, label: b }))} onChange={(b) => ed.obj("blend", (x) => (x.blend = b as GlobalCompositeOperation))} />
      </Section>
      {o.kind === "text" && o.text && <TextSection o={o} ed={ed} />}
    </>
  );
}

function TextSection({ o, ed }: { o: SceneObject; ed: ReturnType<typeof useEdit> }) {
  const t = o.text!;
  const set = <K extends keyof TextSpec>(k: K, v: TextSpec[K]) => ed.obj(`tx-${String(k)}`, (x) => x.text && (x.text[k] = v));
  return (
    <Section title="Kinetic typography">
      <TextField label="Content" value={t.content} onChange={(v) => set("content", v)} />
      <Select label="Effect" value={t.effect} options={["rise", "fade", "pop", "drop", "spin", "wave", "typewriter"].map((v) => ({ value: v, label: v }))} onChange={(v) => set("effect", v as TextSpec["effect"])} />
      <Select label="Stagger by" value={t.unit} options={[{ value: "char", label: "Character" }, { value: "word", label: "Word" }]} onChange={(v) => set("unit", v as TextSpec["unit"])} />
      <Num label="Stagger s" value={t.stagger} min={0} max={1} step={0.01} onChange={(v) => set("stagger", v)} />
      <Num label="Duration" value={t.duration} min={0.05} max={3} step={0.05} onChange={(v) => set("duration", v)} />
      <Num label="Start s" value={t.start} min={0} max={20} step={0.05} onChange={(v) => set("start", v)} />
      <Num label="Size" value={t.size} min={1} max={30} step={0.1} onChange={(v) => set("size", v)} />
      <Num label="Weight" value={t.weight} min={300} max={900} step={100} onChange={(v) => set("weight", v)} />
      <Select label="Align" value={t.align} options={["left", "center", "right"].map((v) => ({ value: v, label: v }))} onChange={(v) => set("align", v as TextSpec["align"])} />
      <Select label="Font" value={t.font} options={[{ value: "sans", label: "Inter" }, { value: "mono", label: "JetBrains Mono" }]} onChange={(v) => set("font", v as TextSpec["font"])} />
    </Section>
  );
}

function LightTab(p: Props & { sel: Sel }) {
  const { sel, time } = p;
  const ed = useEdit(p);
  if (!sel || sel.kind !== "object") return <Empty text="Select an object to edit its rim light, cast shadow, ambient occlusion, glow and depth. Select a light to edit it in the Properties tab." />;
  const o = sel.item;
  const ev = evalObj(o, time);
  const rim = o.rim;
  const sh = o.shadow;
  return (
    <>
      <Section title="Rim light (specular edge)" right={<MiniToggle on={!!rim} onChange={(on) => ed.obj("rim-on", (x) => (x.rim = on ? { color: "#06B6D4", intensity: 1, spread: 0.9, lightColor: true, angle: -45 } : null))} />}>
        {rim ? (
          <>
            <Num label="Intensity" value={rim.intensity} min={0} max={2.5} step={0.01} onChange={(v) => ed.obj("ri", (x) => x.rim && (x.rim.intensity = v))} />
            <Num label="Spread" value={rim.spread} min={0.1} max={4} step={0.05} onChange={(v) => ed.obj("rs", (x) => x.rim && (x.rim.spread = v))} />
            <Toggle label="Use each light's colour" value={rim.lightColor} onChange={(v) => ed.obj("rl", (x) => x.rim && (x.rim.lightColor = v))} />
            <ColorField label="Rim colour" value={rim.color} onChange={(c) => ed.obj("rc", (x) => x.rim && (x.rim.color = c ?? x.rim.color))} />
            <Num label="No-light dir" value={rim.angle} min={-180} max={180} step={1} onChange={(v) => ed.obj("ra", (x) => x.rim && (x.rim.angle = v))} />
            <Btn small tone="amber" onClick={() => ed.obj("rk", (x) => upsertKey(x, "rim", time, ev.rim))}>◆ Key rim strength</Btn>
          </>
        ) : (
          <p className="text-[11px] text-[#6F788D]">Off. Enable to add a light-facing crescent in each light’s colour.</p>
        )}
      </Section>
      <Section title="Cast shadow" right={<MiniToggle on={!!sh} onChange={(on) => ed.obj("sh-on", (x) => (x.shadow = on ? { opacity: 0.4, blur: 3, dx: 4, dy: 4, auto: true } : null))} />}>
        {sh ? (
          <>
            <Num label="Opacity" value={sh.opacity} min={0} max={1} step={0.01} onChange={(v) => ed.obj("so", (x) => x.shadow && (x.shadow.opacity = v))} />
            <Num label="Softness" value={sh.blur} min={0} max={20} step={0.1} onChange={(v) => ed.obj("sb", (x) => x.shadow && (x.shadow.blur = v))} />
            <Toggle label="Away from key light" value={sh.auto} onChange={(v) => ed.obj("sa", (x) => x.shadow && (x.shadow.auto = v))} />
            <Num label={sh.auto ? "Distance" : "Offset X"} value={sh.dx} min={-20} max={20} step={0.1} onChange={(v) => ed.obj("sx", (x) => x.shadow && (x.shadow.dx = v))} />
            {!sh.auto && <Num label="Offset Y" value={sh.dy} min={-20} max={20} step={0.1} onChange={(v) => ed.obj("sy", (x) => x.shadow && (x.shadow.dy = v))} />}
          </>
        ) : (
          <p className="text-[11px] text-[#6F788D]">Off.</p>
        )}
      </Section>
      <Section title="Surface & atmosphere">
        <Toggle label="Diffuse lit (light wash)" value={o.lit} onChange={(v) => ed.obj("lit", (x) => (x.lit = v))} />
        <Num label="Glow / bloom" value={ev.glow} min={0} max={3} step={0.01} onChange={(v) => ed.obj("glow", (x) => setObjProp(x, "glow", v, time))} />
        <Num label="Occlusion" value={o.ao} min={0} max={1} step={0.01} onChange={(v) => ed.obj("ao", (x) => (x.ao = v))} />
        <Num label="Depth" value={o.depth} min={0} max={1} step={0.01} onChange={(v) => ed.obj("depth", (x) => (x.depth = v))} />
        <p className="text-[10.5px] leading-snug text-[#6F788D]">Depth 0 = near, 1 = far. Far objects take on horizon haze; objects away from the focus plane blur (World → Depth of field).</p>
      </Section>
    </>
  );
}

function MiniToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={`h-4 w-7 rounded-full p-0.5 transition ${on ? "bg-[#3B82F6]" : "bg-white/10"}`}>
      <span className={`block h-3 w-3 rounded-full bg-white transition ${on ? "translate-x-3" : ""}`} />
    </button>
  );
}

function RigTab(p: Props & { sel: Sel }) {
  const { sel, time, scene } = p;
  const ed = useEdit(p);
  const [dur, setDur] = useState(1.5);
  if (!sel || sel.kind !== "object") return <Empty text="Select an object to parent it to another part, set its pivot, clone a variant, edit its Bézier path or morph it into another shape." />;
  const o = sel.item;
  const ev = evalObj(o, time);
  const blocked = new Set([o.id, ...descendantsOf(scene, o.id).map((d) => d.id)]);
  const parents = scene.objects.filter((x) => !blocked.has(x.id));
  const targets = scene.objects.filter((x) => x.id !== o.id && x.kind === "shape" && x.path);
  const kids = scene.objects.filter((x) => x.parent === o.id);
  return (
    <>
      <Section title="Parent-child rig">
        <Select
          label="Parent"
          value={o.parent ?? ""}
          options={[{ value: "", label: "— none (root) —" }, ...parents.map((x) => ({ value: x.id, label: x.label }))]}
          onChange={(v) =>
            ed.obj("parent", (x, s) => {
              x.parent = v || null;
              if (v) {
                x.x = 0;
                x.y = 0;
                const pi = s.objects.findIndex((q) => q.id === v);
                const ci = s.objects.indexOf(x);
                if (ci < pi) {
                  s.objects.splice(ci, 1);
                  s.objects.splice(s.objects.findIndex((q) => q.id === v) + 1, 0, x);
                }
              }
            })
          }
        />
        <Num label="Pivot X" value={o.pivotX} min={-30} max={30} step={0.1} onChange={(v) => ed.obj("px", (x) => (x.pivotX = v))} />
        <Num label="Pivot Y" value={o.pivotY} min={-30} max={30} step={0.1} onChange={(v) => ed.obj("py", (x) => (x.pivotY = v))} />
        <p className="text-[10.5px] leading-snug text-[#6F788D]">The pivot is the point of this part’s own geometry pinned to its anchor and used as the centre of rotation. Children inherit position, rotation, scale and opacity every frame.</p>
        {kids.length > 0 && (
          <div className="rounded-md border border-white/[0.07] bg-black/20 p-2 text-[11px] text-[#9AA3B8]">
            Children: {kids.map((k) => (
              <button key={k.id} type="button" onClick={() => p.onSelect(k.id)} className="mr-1 rounded bg-white/[0.06] px-1.5 py-0.5 hover:bg-white/10">
                {k.label}
              </button>
            ))}
          </div>
        )}
        <Btn small tone="blue" onClick={() => p.onClone(o.id)}>Clone Variant</Btn>
      </Section>
      <Section title="Vector path morph (morph_to)">
        {o.kind === "text" ? (
          <p className="text-[11px] text-[#6F788D]">Text objects cannot morph.</p>
        ) : (
          <>
            <Select
              label="Target"
              value=""
              options={[{ value: "", label: targets.length ? "Choose shape to morph into…" : "No other shapes" }, ...targets.map((x) => ({ value: x.id, label: x.label }))]}
              onChange={(v) => {
                if (!v) return;
                p.commit((s) => {
                  const me = s.objects.find((q) => q.id === o.id);
                  const t = s.objects.find((q) => q.id === v);
                  if (me && t) buildMorph(me, t.path, t.fill, time, dur);
                });
              }}
            />
            <Num label="Duration" value={dur} min={0.1} max={6} step={0.1} slider onChange={setDur} />
            <p className="text-[10.5px] leading-snug text-[#6F788D]">Choosing a target writes morph keyframes from the playhead ({time.toFixed(2)}s) over the duration. Segment counts, winding and start point are matched automatically.</p>
            <Num label="Progress" value={ev.morph} min={0} max={1} step={0.01} onChange={(v) => ed.obj("morph", (x) => setObjProp(x, "morph", v, time))} />
            {o.morphTo && (
              <Btn small onClick={() => ed.obj("unmorph", (x) => { x.morphTo = null; x.fillTo = null; x.morph = 0; x.tracks = x.tracks.filter((t) => t.prop !== "morph"); })}>
                Clear morph
              </Btn>
            )}
          </>
        )}
      </Section>
      {o.kind === "shape" && (
        <Section title="Bézier path (SVG d)">
          <textarea
            key={o.id + ":" + o.path.length}
            defaultValue={o.path}
            spellCheck={false}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== o.path) ed.obj("path", (x) => (x.path = v));
            }}
            className="h-24 w-full resize-y rounded border border-white/10 bg-black/30 p-2 font-mono text-[10.5px] text-[#CFE8FF] outline-none focus:border-[#3B82F6]/70"
          />
          <p className="text-[10.5px] text-[#6F788D]">Edit and click away to apply. M L H V C S Q T A Z supported.</p>
        </Section>
      )}
    </>
  );
}

function WorldTab(p: Props) {
  const { scene } = p;
  const env = scene.env;
  const setEnv = (key: string, fn: (e: Scene["env"]) => void) => p.commit((s) => fn(s.env), `env-${key}`);
  return (
    <>
      <Section title="Procedural background">
        <div className="flex flex-wrap gap-1">
          {Object.keys(ENV_PRESETS).map((k) => (
            <Btn key={k} small onClick={() => p.commit((s) => void (s.env = cloneEnv(ENV_PRESETS[k])))}>{k}</Btn>
          ))}
        </div>
      </Section>
      <Section title="Sky gradient" right={<Btn small onClick={() => setEnv("skyadd", (e) => e.sky.push({ at: 0.5, color: "#445577" }))}>+ stop</Btn>}>
        {env.sky.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2">
            <ColorField label={`Stop ${i + 1}`} value={s.color} onChange={(c) => setEnv("skyc" + i, (e) => (e.sky[i].color = c ?? e.sky[i].color))} />
            <div className="flex items-center gap-1">
              <input type="number" step={0.05} min={0} max={1} value={s.at} onChange={(ev) => setEnv("skya" + i, (e) => (e.sky[i].at = Math.min(1, Math.max(0, parseFloat(ev.target.value) || 0))))} className="w-14 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-right font-mono text-[11px] text-[#DDE3F0]" />
              {env.sky.length > 2 && <button type="button" aria-label="Remove stop" onClick={() => setEnv("skyrm", (e) => void e.sky.splice(i, 1))} className="text-[#7F889D] hover:text-white">×</button>}
            </div>
          </div>
        ))}
      </Section>
      <Section title="Stars">
        <p className="text-[11px] leading-snug text-[#7d8aa0]">Scenes have no sun disc — light comes from invisible lights you add with the Light tool.</p>
        <Num label="Stars" value={env.stars} min={0} max={300} step={1} onChange={(v) => setEnv("stars", (e) => (e.stars = Math.round(v)))} />
      </Section>
      <Section title="Clouds" right={<MiniToggle on={!!env.clouds} onChange={(on) => setEnv("cl", (e) => (e.clouds = on ? { count: 7, speed: 0.5, color: "#FFFFFF", shade: "#7A8AA8", opacity: 0.8, y0: 15, y1: 60 } : null))} />}>
        {env.clouds && (
          <>
            <Num label="Count" value={env.clouds.count} min={1} max={20} step={1} onChange={(v) => setEnv("cn", (e) => e.clouds && (e.clouds.count = Math.round(v)))} />
            <Num label="Drift" value={env.clouds.speed} min={0} max={4} step={0.05} onChange={(v) => setEnv("cs", (e) => e.clouds && (e.clouds.speed = v))} />
            <Num label="Opacity" value={env.clouds.opacity} min={0} max={1} step={0.01} onChange={(v) => setEnv("co", (e) => e.clouds && (e.clouds.opacity = v))} />
            <ColorField label="Lit colour" value={env.clouds.color} onChange={(c) => setEnv("cc", (e) => e.clouds && (e.clouds.color = c ?? e.clouds.color))} />
            <ColorField label="Shade" value={env.clouds.shade} onChange={(c) => setEnv("csh", (e) => e.clouds && (e.clouds.shade = c ?? e.clouds.shade))} />
          </>
        )}
      </Section>
      <Section title="Parallax mountains" right={<Btn small onClick={() => setEnv("madd", (e) => e.mountains.push({ color: "#1A2038", base: 90, height: 12, parallax: 0.5, seed: Math.floor(Math.random() * 20), haze: 0.2 }))}>+ layer</Btn>}>
        {env.mountains.map((m, i) => (
          <div key={i} className="rounded-md border border-white/[0.06] bg-black/20 p-2">
            <ColorField label={`Layer ${i + 1}`} value={m.color} onChange={(c) => setEnv("mc" + i, (e) => (e.mountains[i].color = c ?? e.mountains[i].color))} />
            <Num label="Height" value={m.height} min={2} max={40} step={0.5} onChange={(v) => setEnv("mh" + i, (e) => (e.mountains[i].height = v))} />
            <Num label="Parallax" value={m.parallax} min={0} max={3} step={0.05} onChange={(v) => setEnv("mp" + i, (e) => (e.mountains[i].parallax = v))} />
            <button type="button" className="text-[10.5px] text-[#7F889D] hover:text-red-300" onClick={() => setEnv("mrm", (e) => void e.mountains.splice(i, 1))}>Remove layer</button>
          </div>
        ))}
      </Section>
      <Section title="Atmosphere & camera lens" right={<MiniToggle on={!!env.haze} onChange={(on) => setEnv("hz", (e) => (e.haze = on ? { color: "#FF9A5C", amount: 0.25, horizon: 76 } : null))} />}>
        {env.haze && (
          <>
            <ColorField label="Haze" value={env.haze.color} onChange={(c) => setEnv("hc", (e) => e.haze && (e.haze.color = c ?? e.haze.color))} />
            <Num label="Amount" value={env.haze.amount} min={0} max={1} step={0.01} onChange={(v) => setEnv("ha", (e) => e.haze && (e.haze.amount = v))} />
            <Num label="Horizon" value={env.haze.horizon} min={30} max={100} step={0.5} onChange={(v) => setEnv("hh", (e) => e.haze && (e.haze.horizon = v))} />
          </>
        )}
        <Num label="DoF focus" value={env.dof.focus} min={0} max={1} step={0.01} onChange={(v) => setEnv("df", (e) => (e.dof.focus = v))} />
        <Num label="DoF blur" value={env.dof.amount} min={0} max={8} step={0.1} onChange={(v) => setEnv("da", (e) => (e.dof.amount = v))} />
        <Num label="Bloom" value={env.bloom} min={0} max={2} step={0.01} onChange={(v) => setEnv("bl", (e) => (e.bloom = v))} />
        <Num label="Vignette" value={env.vignette} min={0} max={1} step={0.01} onChange={(v) => setEnv("vg", (e) => (e.vignette = v))} />
      </Section>
      <Section title="Particle emitters">
        <div className="flex flex-wrap gap-1">
          {EMITTERS.map((k) => (
            <Btn key={k} small onClick={() => p.onAddEmitter(k)}>+ {k}</Btn>
          ))}
        </div>
        {scene.emitters.map((e) => (
          <button key={e.id} type="button" onClick={() => p.onSelect(e.id)} className={`flex w-full items-center justify-between rounded-md border px-2 py-1 text-left text-[11.5px] ${p.selId === e.id ? "border-[#06B6D4]/60 bg-[#06B6D4]/10 text-white" : "border-white/[0.07] text-[#9AA3B8] hover:bg-white/5"}`}>
            <span>{e.label}</span>
            <span className="font-mono text-[10px] text-[#6F788D]">{e.kind}</span>
          </button>
        ))}
      </Section>
    </>
  );
}

function CurveTab(p: Props) {
  const { selKey, scene } = p;
  if (!selKey) return <Empty text="Click a keyframe diamond on the dope sheet to edit the easing curve that leaves it. Drag the amber and cyan handles; pull outside the box for overshoot and springs." />;
  const key = trackOwner(scene, selKey.owner)?.tracks.find((t) => t.prop === selKey.prop)?.keys.find((k) => Math.abs(k.t - selKey.t) < 0.0005);
  if (!key) return <Empty text="That keyframe no longer exists." />;
  const owner = trackOwner(scene, selKey.owner)!;
  const set = (e: Ease) =>
    p.commit((s) => {
      const k = trackOwner(s, selKey.owner)?.tracks.find((t) => t.prop === selKey.prop)?.keys.find((x) => Math.abs(x.t - selKey.t) < 0.0005);
      if (k) k.ease = e;
    }, `curve:${selKey.owner}:${selKey.prop}:${selKey.t}`);
  return (
    <Section title="Cubic-Bézier curve" right={<span className="font-mono text-[10px] text-[#6F788D]">{owner.label} · {selKey.prop} @ {selKey.t.toFixed(2)}s</span>}>
      <CurveEditor ease={key.ease} onChange={set} />
      <p className="text-[10.5px] leading-snug text-[#6F788D]">Shapes the motion from this keyframe to the next. Value at key: <span className="font-mono">{key.v}</span></p>
    </Section>
  );
}
