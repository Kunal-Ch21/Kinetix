// Collapsible Outliner & Rig Tree (drag to parent, right-click menu) + Custom Shape & Asset Library.
import { ChevronDown, ChevronRight, Cloud, Eye, EyeOff, Image as ImageIcon, Layers, Shapes, Sun, Type } from "lucide-react";
import { useState } from "react";
import type { SceneObject } from "../engine/types";
import { lightMenu, objectMenu } from "../lib/menus";
import { openMenu, triggerImport } from "../lib/menu";
import { TEMPLATES, TEMPLATE_CATEGORIES, insertTemplate, type TemplateCategory } from "../lib/templates";
import { insertAsset, insertShape, parentTo, renameNode, select, toggleVisible, useStore } from "../state/store";

function Row({ id, label, depth, icon, visible, sub, kind, draggable, hasKids, open, onToggleOpen }: { id: string; label: string; depth: number; icon: React.ReactNode; visible: boolean; sub?: string; kind: "object" | "other"; draggable?: boolean; hasKids?: boolean; open?: boolean; onToggleOpen?: () => void }) {
  const sel = useStore((s) => s.selection.includes(id));
  const [editing, setEditing] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <div
      data-sel={sel}
      data-drop={over}
      className="row group"
      style={{ paddingLeft: 8 + depth * 14 }}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/kx-node", id)}
      onDragOver={(e) => {
        if (kind === "object") {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const src = e.dataTransfer.getData("text/kx-node");
        if (src && src !== id) parentTo(src, id);
      }}
      onClick={() => select([id])}
      onContextMenu={(e) => {
        e.preventDefault();
        select([id]);
        openMenu(e.clientX, e.clientY, kind === "object" ? objectMenu(id, e.clientX, e.clientY) : lightMenu(id));
      }}
    >
      <button type="button" className="flex h-4 w-4 items-center justify-center text-[#6c7588]" onClick={(e) => (e.stopPropagation(), onToggleOpen?.())}>
        {hasKids ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
      </button>
      <span className={sel ? "text-cyan" : "text-[#6c7588]"}>{icon}</span>
      {editing ? (
        <input
          autoFocus
          defaultValue={label}
          className="field !h-5 !px-1 flex-1"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => (renameNode(id, e.target.value.trim() || label), setEditing(false))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <span className={`flex-1 truncate text-[12px] ${visible ? "" : "opacity-40"}`} onDoubleClick={() => setEditing(true)}>
          {label}
        </span>
      )}
      {sub ? <span className="mono text-[9.5px] text-[#5E6679]">{sub}</span> : null}
      <button type="button" aria-label={visible ? "Hide" : "Show"} className="text-[#5E6679] opacity-0 hover:text-white group-hover:opacity-100" onClick={(e) => (e.stopPropagation(), toggleVisible(id))}>
        {visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
    </div>
  );
}

export function Outliner() {
  const scene = useStore((s) => s.scene);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const ids = new Set(scene.objects.map((o) => o.id));
  const roots = scene.objects.filter((o) => !o.parent || !ids.has(o.parent)).slice().reverse();
  const kids = (id: string) => scene.objects.filter((c) => c.parent === id);
  const tree = (o: SceneObject, depth: number): React.ReactNode => {
    const ch = kids(o.id);
    const n = o.tracks.reduce((a, t) => a + t.keys.length, 0);
    return (
      <div key={o.id}>
        <Row id={o.id} label={o.label} depth={depth} kind="object" draggable visible={o.visible} sub={n ? `◆${n}` : undefined} hasKids={ch.length > 0} open={!closed[o.id]} onToggleOpen={() => setClosed((c) => ({ ...c, [o.id]: !c[o.id] }))} icon={o.kind === "text" ? <Type size={12} /> : o.kind === "image" ? <ImageIcon size={12} /> : <Layers size={12} />} />
        {!closed[o.id] && ch.map((c) => tree(c, depth + 1))}
      </div>
    );
  };
  const Head = ({ t }: { t: string }) => <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5E6679]">{t}</div>;
  return (
    <div className="kx-scroll min-h-0 flex-1 overflow-y-auto py-1" data-help="outliner" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      const src = e.dataTransfer.getData("text/kx-node");
      if (src) parentTo(src, null);
    }}>
      {roots.length === 0 && scene.lights.length === 0 && scene.emitters.length === 0 && (
        <p className="px-3 py-6 text-center text-[11.5px] leading-relaxed text-[#6F788D]">Blank canvas.<br />Draw with the Brush or Pen, import an image, or tell the AI Director what to make.</p>
      )}
      {roots.map((o) => tree(o, 0))}
      {scene.lights.length > 0 && <Head t="Lights" />}
      {scene.lights.map((l) => <Row key={l.id} id={l.id} label={l.label} depth={0} kind="other" visible={l.visible} sub={l.type} icon={<Sun size={12} />} />)}
      {scene.emitters.length > 0 && <Head t="Particles" />}
      {scene.emitters.map((e) => <Row key={e.id} id={e.id} label={e.label} depth={0} kind="other" visible={e.visible} sub={e.kind} icon={<Cloud size={12} />} />)}
    </div>
  );
}

const NO_SHAPES: { id: string; label: string; path: string }[] = []; // stable reference: a fresh [] per snapshot loops useSyncExternalStore

export function AssetLibrary() {
  const [tab, setTab] = useState<"templates" | "shapes" | "images">("templates");
  const library = useStore((s) => s.scene.library ?? NO_SHAPES);
  const assets = useStore((s) => s.assets);
  return (
    <div className="flex max-h-[270px] min-h-[150px] flex-none flex-col border-t border-white/[0.07]" data-help="assets">
      <div className="flex h-8 flex-none items-center gap-1 px-2">
        {(["templates", "shapes", "images"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-md px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] ${tab === t ? "bg-white/10 text-white" : "text-[#7F889D]"}`}>
            {t === "templates" ? "Templates" : t === "shapes" ? "Shapes" : "Images"}
          </button>
        ))}
        {tab === "images" && (
          <button type="button" className="tbtn ml-auto !h-[22px] !px-2" onClick={triggerImport}>
            Import
          </button>
        )}
      </div>
      <div className="kx-scroll grid min-h-0 flex-1 grid-cols-4 content-start gap-1.5 overflow-y-auto px-2 pb-2">
        {tab === "templates" && <TemplateGrid />}
        {tab === "shapes" &&
          library.map((s) => (
            <button key={s.id} type="button" title={`Insert ${s.label}`} onClick={() => insertShape(s.id)} className="flex aspect-square items-center justify-center rounded-lg border border-white/10 bg-black/30 hover:border-cyan/50">
              <svg viewBox="-12 -12 24 24" className="h-8 w-8"><path d={s.path} fill="#3B82F6" fillOpacity={0.5} stroke="#06B6D4" strokeWidth={0.6} /></svg>
            </button>
          ))}
        {tab === "shapes" && library.length === 0 && <p className="col-span-4 py-3 text-center text-[11px] leading-snug text-[#6F788D]"><Shapes size={14} className="mx-auto mb-1" />Right-click a path → “Save as Custom Shape”.</p>}
        {tab === "images" &&
          assets.map((a) => (
            <button key={a.id} type="button" title={`Insert ${a.label}`} onClick={() => insertAsset(a.id)} className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/30 hover:border-cyan/50">
              <img src={a.src} alt={a.label} className="h-full w-full object-contain" draggable={false} />
            </button>
          ))}
        {tab === "images" && assets.length === 0 && <p className="col-span-4 py-3 text-center text-[11px] text-[#6F788D]">No images yet — import, drag &amp; drop, or right-click the canvas.</p>}
      </div>
    </div>
  );
}

/** Universal presets: motion graphics, vector icons and character rigs. Clicking inserts it; New Project stays blank. */
function TemplateGrid() {
  const [cat, setCat] = useState<TemplateCategory>("Motion Graphics");
  const list = TEMPLATES.filter((t) => t.category === cat);
  return (
    <div className="col-span-4">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {TEMPLATE_CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} className={`rounded-full border px-2 py-0.5 text-[10px] ${cat === c ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-white/10 text-[#8a93a6] hover:text-white"}`}>
            {c}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {list.map((t) => (
          <button key={t.id} type="button" title={t.blurb} onClick={() => insertTemplate(t)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-1.5 text-left hover:border-cyan/50">
            <svg viewBox="-12 -12 24 24" className="h-8 w-8 flex-none"><path d={t.preview} fill="#3B82F6" fillOpacity={0.45} stroke="#06B6D4" strokeWidth={0.7} /></svg>
            <span className="min-w-0 truncate text-[10.5px] leading-tight text-[#CBD2E1]">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
