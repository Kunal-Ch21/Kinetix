// Interactive Help & Visual Glossary ("Explain like I'm new"): guided first animation, searchable glossary with live
// mini-demos, AI prompt recipes, troubleshooting, and the full written user guide.
import { BookOpen, Check, ChevronRight, GraduationCap, LifeBuoy, Search, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { keyLabel, useKeybinds } from "../lib/keybinds";
import { setModal, setState, setTool, useStore } from "../state/store";
import { DocsModal as Guide, RECIPES } from "./DocsModal";
import { Modal } from "./Modals";

/* ================================================================ interactive demos */

const EASES: { label: string; css: string; note: string }[] = [
  { label: "Linear", css: "linear", note: "Constant speed, then stops dead — like a brick wall." },
  { label: "Ease-in-out", css: "cubic-bezier(.65,0,.35,1)", note: "Starts gently, speeds up, lands softly. The safe default." },
  { label: "Bounce / spring", css: "cubic-bezier(.34,1.56,.64,1)", note: "Overshoots the target and settles back — playful and energetic." },
  { label: "Hold (step)", css: "steps(1,end)", note: "Doesn't move at all, then jumps. Used for flicker and cuts." },
];

function EaseDemo() {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setGo((g) => !g), 1900);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="space-y-2.5">
      {EASES.map((e) => (
        <div key={e.label}>
          <div className="mb-1 flex items-baseline justify-between text-[11.5px]">
            <b className="text-white">{e.label}</b>
            <span className="text-[#8a93a6]">{e.note}</span>
          </div>
          <div className="relative h-6 rounded-full bg-black/40">
            <div className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#06B6D4] shadow-[0_0_12px_rgba(6,182,212,.6)]" style={{ left: go ? "calc(100% - 20px)" : "4px", transition: `left 1.5s ${e.css}` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function BezierDemo() {
  const [p, setP] = useState({ x1: 0.65, y1: 0, x2: 0.35, y2: 1 });
  const [go, setGo] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setGo((g) => !g), 1900);
    return () => window.clearInterval(id);
  }, []);
  const S = 150;
  const px = (v: number) => 20 + v * S;
  const py = (v: number) => 170 - v * S;
  const drag = (which: "1" | "2") => (e: React.PointerEvent<SVGCircleElement>) => {
    const svg = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.min(1, (ev.clientX - svg.left - 20) / S));
      const y = Math.max(-0.5, Math.min(1.5, (170 - (ev.clientY - svg.top)) / S));
      setP((q) => (which === "1" ? { ...q, x1: x, y1: y } : { ...q, x2: x, y2: y }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const css = `cubic-bezier(${p.x1.toFixed(2)},${p.y1.toFixed(2)},${p.x2.toFixed(2)},${p.y2.toFixed(2)})`;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={190} height={190} className="touch-none rounded-lg bg-black/40">
        <rect x={20} y={20} width={S} height={S} fill="none" stroke="rgba(255,255,255,.12)" />
        <line x1={px(0)} y1={py(0)} x2={px(p.x1)} y2={py(p.y1)} stroke="#F59E0B" />
        <line x1={px(1)} y1={py(1)} x2={px(p.x2)} y2={py(p.y2)} stroke="#06B6D4" />
        <path d={`M${px(0)} ${py(0)} C${px(p.x1)} ${py(p.y1)} ${px(p.x2)} ${py(p.y2)} ${px(1)} ${py(1)}`} fill="none" stroke="#fff" strokeWidth={2} />
        <circle cx={px(p.x1)} cy={py(p.y1)} r={6} fill="#F59E0B" onPointerDown={drag("1")} style={{ cursor: "grab" }} />
        <circle cx={px(p.x2)} cy={py(p.y2)} r={6} fill="#06B6D4" onPointerDown={drag("2")} style={{ cursor: "grab" }} />
      </svg>
      <div className="min-w-[200px] flex-1">
        <div className="relative mb-2 h-6 rounded-full bg-black/40">
          <div className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#F59E0B]" style={{ left: go ? "calc(100% - 20px)" : "4px", transition: `left 1.5s ${css}` }} />
        </div>
        <code className="mono block rounded bg-black/40 px-2 py-1 text-[11.5px] text-[#cfe8ff]">{css}</code>
        <p className="mt-2 text-[12px] text-[#9aa6bb]">Drag the two dots. The curve is “speed over time”: steep = fast, flat = slow. Dots pulled above the box make the motion overshoot.</p>
      </div>
    </div>
  );
}

function RimDemo() {
  const [spread, setSpread] = useState(6);
  const [dir, setDir] = useState(-1);
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={150} height={150} viewBox="0 0 150 150" className="rounded-lg bg-[#0a0d14]">
        <defs>
          <mask id="rim-m">
            <circle cx={75} cy={75} r={46} fill="#fff" />
            <circle cx={75 - dir * spread} cy={75 + spread * 0.6} r={46} fill="#000" />
          </mask>
        </defs>
        <circle cx={75} cy={75} r={46} fill="#232B3D" />
        <circle cx={75} cy={75} r={46} fill="#06B6D4" mask="url(#rim-m)" style={{ filter: "drop-shadow(0 0 6px #06B6D4)" }} />
        <text x={dir < 0 ? 12 : 104} y={20} fill="#F59E0B" fontSize={11}>☀ light</text>
      </svg>
      <div className="min-w-[180px] flex-1 space-y-2 text-[12px] text-[#9aa6bb]">
        <label className="flex items-center gap-3">Spread <input type="range" min={0} max={20} value={spread} onChange={(e) => setSpread(+e.target.value)} className="kx-range flex-1" /> <b className="mono w-6 text-white">{spread}</b></label>
        <div className="flex gap-2">
          <button className={`tbtn !h-[26px] ${dir < 0 ? "primary" : ""}`} onClick={() => setDir(-1)}>Light from left</button>
          <button className={`tbtn !h-[26px] ${dir > 0 ? "primary" : ""}`} onClick={() => setDir(1)}>Light from right</button>
        </div>
        <p>Spread is how thick the bright edge is. 0 = no highlight, small = crisp edge, big = strong backlit glow.</p>
      </div>
    </div>
  );
}

function ParentDemo() {
  const [linked, setLinked] = useState(true);
  return (
    <div>
      <div className="relative h-28 overflow-hidden rounded-lg bg-black/40">
        <style>{`@keyframes kxMove{0%,100%{transform:translateX(20px)}50%{transform:translateX(220px)}}.kxm{animation:kxMove 3s ease-in-out infinite}`}</style>
        <div className="kxm absolute left-0 top-6">
          <div className="h-14 w-14 rounded-full bg-[#8B5CF6]" />
          {linked && (
            <>
              <div className="absolute -right-4 top-1 h-5 w-5 rounded-full bg-[#F59E0B]" />
              <div className="absolute -left-4 top-8 h-5 w-5 rounded-full bg-[#06B6D4]" />
            </>
          )}
        </div>
        {!linked && (
          <>
            <div className="absolute left-[110px] top-7 h-5 w-5 rounded-full bg-[#F59E0B]" />
            <div className="absolute left-[40px] top-14 h-5 w-5 rounded-full bg-[#06B6D4]" />
          </>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[12px] text-[#9aa6bb]">
        <button className={`tbtn !h-[26px] ${linked ? "primary" : ""}`} onClick={() => setLinked(!linked)}>{linked ? "Parented: children follow" : "Not parented: children get left behind"}</button>
        <span>Drag a name onto another in the Outliner to parent it.</span>
      </div>
    </div>
  );
}

function BlendDemo() {
  const [m, setM] = useState("screen");
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative h-28 w-44 rounded-lg bg-[#1b2233]">
        <div className="absolute left-4 top-4 h-16 w-16 rounded-full bg-[#F59E0B]" />
        <div className="absolute left-14 top-8 h-16 w-16 rounded-full bg-[#06B6D4]" style={{ mixBlendMode: m as never }} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["normal", "screen", "multiply", "overlay", "difference"].map((b) => (
          <button key={b} className={`tbtn !h-[26px] ${m === b ? "primary" : ""}`} onClick={() => setM(b)}>{b}</button>
        ))}
      </div>
      <p className="basis-full text-[12px] text-[#9aa6bb]">Blend mode = how the top shape mixes with what is under it. Screen brightens (glows), Multiply darkens (shadows).</p>
    </div>
  );
}

function BeamDemo() {
  const [cone, setCone] = useState(22);
  const [aim, setAim] = useState(35);
  const [reach, setReach] = useState(150);
  const o = { x: 30, y: 24 };
  const a = (aim * Math.PI) / 180;
  const c = (cone * Math.PI) / 180;
  const pt = (ang: number) => `${o.x + Math.cos(ang) * reach},${o.y + Math.sin(ang) * reach}`;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={260} height={170} className="rounded-lg bg-[#0a0d14]">
        <defs>
          <linearGradient id="bm" gradientUnits="userSpaceOnUse" x1={o.x} y1={o.y} x2={o.x + Math.cos(a) * reach} y2={o.y + Math.sin(a) * reach}>
            <stop offset="0" stopColor="#FFB347" stopOpacity={0.6} />
            <stop offset="1" stopColor="#FFB347" stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={`${o.x},${o.y} ${pt(a - c)} ${pt(a + c)}`} fill="url(#bm)" />
        <circle cx={o.x} cy={o.y} r={7} fill="none" stroke="#F59E0B" strokeDasharray="3 3" />
        <circle cx={o.x + Math.cos(a) * 110} cy={o.y + Math.sin(a) * 110} r={8} fill="none" stroke="#06B6D4" strokeDasharray="3 3" />
        <rect x={150} y={95} width={46} height={26} rx={4} fill="#3B4156" />
        <text x={150} y={140} fill="#7d8aa0" fontSize={10}>your object</text>
      </svg>
      <div className="min-w-[180px] flex-1 space-y-1.5 text-[12px] text-[#9aa6bb]">
        {([["Cone spread", cone, 5, 60, setCone], ["Aim angle", aim, 0, 80, setAim], ["Falloff", reach, 60, 260, setReach]] as const).map(([l, v, mn, mx, set]) => (
          <label key={l} className="flex items-center gap-3"><span className="w-20">{l}</span><input type="range" min={mn} max={mx} value={v} onChange={(e) => set(+e.target.value)} className="kx-range flex-1" /></label>
        ))}
        <p>The dashed ring is the light's origin and the cyan crosshair is where it aims — both are only drawn while editing, never in your video.</p>
      </div>
    </div>
  );
}

function OnionDemo() {
  const [on, setOn] = useState(true);
  return (
    <div>
      <div className="relative h-20 rounded-lg bg-black/40">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="absolute top-5 h-10 w-10 rounded-full bg-[#06B6D4]" style={{ left: 20 + i * 62, opacity: i === 3 ? 1 : on ? 0.12 + i * 0.1 : 0 }} />
        ))}
      </div>
      <button className={`tbtn !h-[26px] mt-2 ${on ? "primary" : ""}`} onClick={() => setOn(!on)}>Onion skin {on ? "ON" : "OFF"}</button>
      <span className="ml-3 text-[12px] text-[#9aa6bb]">Ghosts of earlier moments show how far something moved.</span>
    </div>
  );
}

const DEMOS: Record<string, () => ReactNode> = { ease: () => <EaseDemo />, bezier: () => <BezierDemo />, rim: () => <RimDemo />, parent: () => <ParentDemo />, blend: () => <BlendDemo />, beam: () => <BeamDemo />, onion: () => <OnionDemo /> };

/* ================================================================ glossary */

interface Term {
  term: string;
  group: "Animation" | "Drawing" | "Lighting" | "Rigging" | "AI" | "Studio";
  what: string;
  why: string;
  tip?: string;
  demo?: keyof typeof DEMOS;
  aka?: string;
  action?: string;
}
const T = (term: string, group: Term["group"], what: string, why: string, tip?: string, demo?: Term["demo"], aka?: string, action?: string): Term => ({ term, group, what, why, tip, demo, aka, action });

const GLOSSARY: Term[] = [
  T("Keyframe", "Animation", "A saved snapshot of a property (like position) at one moment in time.", "Set two keyframes and the computer fills in the movement between them. Example: logo off-screen at 0 s, centred at 1 s.", "Keyframes show as diamonds in the Dope Sheet.", undefined, "key, pose", "add_keyframe"),
  T("Interpolation", "Animation", "How the in-between values are calculated between two keyframes.", "It decides whether the motion is steady, smooth, snappy or bouncy.", "Right-click a diamond to change it.", "ease", "tweening, in-betweening"),
  T("Easing (Ease-in-out)", "Animation", "A way of making motion start slowly, speed up, then slow down before stopping.", "Use ease-in-out so a logo slides smoothly instead of stopping like a brick wall.", "Linear looks robotic; ease-in-out looks natural.", "ease", "ease, smoothing"),
  T("Cubic-Bézier curve", "Animation", "A tiny curve that describes speed over time using two handles.", "Lets you design your own easing — snappy, floaty or overshooting.", "Pull a handle above the box for overshoot.", "bezier", "bezier curve, speed curve"),
  T("Linear vs Bounce", "Animation", "Linear = constant speed. Bounce (spring) = overshoots and settles back.", "Linear for scrolling credits, bounce for playful buttons and pop-ins.", undefined, "ease", "spring, overshoot"),
  T("Timeline", "Animation", "The strip along the bottom that represents time, left (start) to right (end).", "Everything you animate lives on it.", "Drag on the ruler to scrub.", undefined, "time strip"),
  T("Playhead", "Animation", "The vertical line that marks 'now' on the timeline.", "The canvas always shows the scene at the playhead.", "Arrow keys nudge it one frame.", undefined, "scrubber, cursor", "step_fwd"),
  T("Dope Sheet", "Animation", "A grid listing every property you've animated, one row each, with diamonds for keyframes.", "See and edit timing at a glance — drag diamonds earlier or later.", undefined, undefined, "tracks"),
  T("Onion Skinning", "Animation", "Shows a faint ghost of earlier moments on top of the current frame.", "Handy for judging distance and spacing, especially for characters.", "Only visible while paused.", "onion", "ghosting", "onion_toggle"),
  T("Frame / FPS", "Animation", "A frame is one still picture; FPS is how many play each second.", "24–30 fps looks cinematic; 60 fps looks very smooth.", undefined, undefined, "frame rate"),
  T("Loop", "Animation", "Playback that restarts at the end.", "Great for polishing a short motion or making GIFs.", undefined, undefined, undefined, "loop_toggle"),
  T("Morph", "Animation", "Smoothly turning one shape into another.", "Play ⇄ pause icons, logo reveals, creature transformations.", undefined, undefined, "shape tween"),
  T("Kinetic typography", "Animation", "Text that animates letter by letter or word by word.", "Titles, lyric videos and explainers.", "Try the Pop effect with 'word' units.", undefined, "animated text"),
  T("Story flag", "Animation", "A named marker on the timeline.", "Lets you and the AI say 'after Intro'.", undefined, undefined, "marker, event"),
  T("Bézier path / anchor", "Drawing", "A smooth line made of points (anchors) with handles that bend the curve.", "How every shape and icon is stored, so they stay sharp at any size.", "Double-click a point to switch it between smooth and sharp.", undefined, "node, vector, pen path"),
  T("Fill & Stroke", "Drawing", "Fill is the colour inside a shape; stroke is the line around it.", "Icons are often stroke-only; cards are fill-only.", undefined, undefined, "outline"),
  T("Gradient", "Drawing", "A smooth blend between two colours.", "Adds depth to buttons and backgrounds.", undefined),
  T("Blend Mode", "Drawing", "How a shape mixes with whatever is behind it.", "Screen for glows and light leaks, Multiply for shadows.", undefined, "blend", "compositing"),
  T("Opacity", "Drawing", "How see-through something is.", "Fades in and out.", undefined, undefined, "transparency, alpha"),
  T("Pivot / anchor point", "Rigging", "The point an object rotates and scales around — like a door hinge.", "Move it to a character's shoulder to make an arm swing naturally.", undefined, undefined, "origin, hinge"),
  T("Parent–Child Anchors", "Rigging", "Linking objects so children follow their parent's movement.", "Move a body and the eyes, arms and hat come along automatically.", "Drag a name onto another in the Outliner, or press the Group key.", "parent", "hierarchy, rig, group", "group"),
  T("Rig", "Rigging", "A parented set of parts that move together like a puppet.", "Lets you animate a whole character by moving a few handles.", undefined, undefined, "puppet, skeleton"),
  T("Rim Light", "Lighting", "A bright edge along the side of an object that faces the light.", "Separates a dark object from a dark background and makes flat art look 3-D.", "Directional lights are best for rim highlights.", "rim", "edge light, backlight"),
  T("Rim Light Spread", "Lighting", "How thick the glowing edge is.", "Thin = crisp highlight; thick = strong backlit glow.", undefined, "rim", "rim width"),
  T("Spot / Cone Beam", "Lighting", "A light that shines in a cone, like a flashlight.", "Draws the eye to one thing. Example: sweep a spotlight across your title.", "Animate its aim from one object to another.", "beam", "spotlight"),
  T("Directional Rim Light", "Lighting", "Parallel light coming from one side of the scene.", "Even highlights on every object — perfect for moody edge glows.", undefined, "rim", "sun, distant light"),
  T("Area / Point Light", "Lighting", "A soft glow that spreads in all directions from one spot.", "Warm ambience, glow from a lamp or screen.", undefined, undefined, "omni, glow light"),
  T("Falloff distance", "Lighting", "How far light travels before fading out.", "Keeps highlights local.", undefined, "beam", "range"),
  T("Cone spread / beam angle", "Lighting", "How wide a spot beam opens.", "Narrow = dramatic, wide = soft wash.", undefined, "beam", "beam width"),
  T("Aim target (from → to)", "Lighting", "The point a light is pointed at; the beam travels from its origin to the target.", "Animate origin and target to sweep light across the scene.", "Try: “Sweep a warm spotlight beam across the title”.", "beam", "light direction"),
  T("Cast shadow", "Lighting", "A soft dark copy of an object offset away from the light.", "Grounds objects on the page.", undefined),
  T("Bloom / Glow", "Lighting", "A soft halo around very bright parts.", "Neon, magic and sci-fi looks.", undefined),
  T("Depth of field", "Lighting", "Blurs things that are far from the focus distance.", "Cinematic focus pulls.", undefined),
  T("Particles / Emitter", "Lighting", "A source that spawns lots of tiny moving dots (sparks, snow, embers).", "Atmosphere and trails.", undefined, undefined, "fx"),
  T("Micro-Context Tokens", "AI", "The small bundle of facts the AI is shown with each request. A 'token' is roughly a short word-piece.", "Keeping it small makes the local AI fast and accurate.", "Watch the meter next to the prompt box.", undefined, "tokens, context"),
  T("AI Director", "AI", "The prompt box where you describe changes in plain English.", "Faster than clicking through panels.", undefined, undefined, "prompt, chat", "focus_ai"),
  T("Zen mode", "Studio", "A distraction-free view with the canvas full-window and a few floating controls.", "Presenting your work or focusing on the look.", undefined, undefined, "focus mode", "toggle_zen"),
  T("Undo stack", "Studio", "The history of your edits.", "Every edit — including AI edits — can be stepped back.", "Undo is greyed out when there's nothing to undo.", undefined, "history", "undo"),
  T("Export formats", "Studio", "MP4 video, GIF, PNG pictures, SVG vector, or Scene JSON.", "Pick the one the destination wants.", undefined, undefined, "render"),
];

const WALK: { id: string; title: string; body: string; action?: { label: string; run: () => void } }[] = [
  { id: "new", title: "Start blank", body: "Open the project menu and choose ‘New Blank Project’ (or press the New key). You get an empty canvas — nothing pre-made." },
  { id: "shape", title: "Draw a shape", body: "Pick the Shape tool and drag on the canvas. Any rectangle, circle or star will do.", action: { label: "Pick Shape tool", run: () => (setTool("shape"), setModal(null)) } },
  { id: "select", title: "Select it", body: "Switch to the Select tool and click your shape. Handles appear around it.", action: { label: "Pick Select tool", run: () => (setTool("select"), setModal(null)) } },
  { id: "k1", title: "Plant the first keyframe", body: "With the shape selected and the playhead at 0 s, press the Add Keyframe key. A diamond appears in the Dope Sheet." },
  { id: "move", title: "Jump forward and move it", body: "Click the time ruler at about 2 s, then drag the shape to a new spot. Kinetix records a second keyframe automatically." },
  { id: "play", title: "Press play", body: "Hit Play (Space). Your shape glides from A to B." },
  { id: "ease", title: "Make it feel smooth", body: "Right-click the first diamond and choose ‘Ease: in-out’ — the move now starts and stops gently instead of like a brick wall." },
  { id: "light", title: "Add a light", body: "Pick the Add Light tool and click near your shape. Select the light, then drag the cyan crosshair onto your shape to aim it.", action: { label: "Pick Light tool", run: () => (setTool("light"), setModal(null)) } },
  { id: "export", title: "Export", body: "Click Export, choose MP4 (or GIF), and save. Done — your first animation!", action: { label: "Open Export", run: () => setModal("export") } },
];
const WLS = "kinetix.walkthrough.v1";

const FIX: [string, string][] = [
  ["Nothing happens when I drag a shape", "Make sure the Select tool is active (it's the arrow). If a hand or drawing tool is on, dragging draws or pans instead."],
  ["My shape snaps back / won't stay", "Once an object has keyframes, moving it at a different time records a new keyframe. Check which moment the playhead is on."],
  ["The motion looks robotic", "Right-click a keyframe diamond and choose Ease: in-out, or Spring for a bouncy feel."],
  ["I can't see my light", "Lights are invisible by design — you only see the glow they throw on objects. Select the light in the Outliner to see its dashed handles. Objects also need ‘Lit’ or a Rim turned on."],
  ["The rim light doesn't show", "A rim only appears on the side facing a light, and only on objects that have Rim enabled. Aim the light at the object and raise the Rim intensity."],
  ["Undo is greyed out", "There is nothing to undo yet (or you just opened a project). Make an edit and it comes alive."],
  ["The AI says no model is installed", "Open Model Settings to install a local model. Lighting prompts and all manual tools work without one."],
  ["Preview feels slow", "Close extra heavy effects (lots of particles, big blur), or use Zen mode. The preview already caps pixel density for speed."],
  ["Zen mode won't exit", "Click the ‘Exit Zen’ pill in the top-right corner or press the Studio/Zen key (Tab by default)."],
  ["MP4 export fails", "MP4 and GIF need FFmpeg. PNG sequence, SVG and JSON work without it."],
];

const LIGHT_PROMPTS = [
  "Cast a cool cyan rim light from top-left onto the logo",
  "Sweep a warm spotlight beam across the title",
  "Cast a soft white spotlight from the top onto the selected object",
  "Make the rim light brighter and narrower",
  "Aim the spotlight at the subtitle over 2 seconds",
];

/* ================================================================ hub */

const TABS = [
  ["start", "Start here", GraduationCap],
  ["glossary", "Glossary", BookOpen],
  ["recipes", "AI recipes", Wand2],
  ["fix", "Troubleshooting", LifeBuoy],
  ["guide", "User guide", Sparkles],
] as const;

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">{children}</div>;
}

export function HelpHub() {
  useKeybinds();
  const tab = useStore((s) => s.helpTab);
  const [q, setQ] = useState("");
  const [done, setDone] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(WLS) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const toggle = (id: string) =>
    setDone((d) => {
      const n = d.includes(id) ? d.filter((x) => x !== id) : [...d, id];
      try {
        localStorage.setItem(WLS, JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });
  const needle = q.trim().toLowerCase();
  const terms = useMemo(() => GLOSSARY.filter((t) => !needle || `${t.term} ${t.aka ?? ""} ${t.what} ${t.why} ${t.group}`.toLowerCase().includes(needle)), [needle]);
  const fix = FIX.filter(([a, b]) => !needle || `${a} ${b}`.toLowerCase().includes(needle));
  const recipes = RECIPES.filter((r) => !needle || `${r.title} ${r.prompt}`.toLowerCase().includes(needle));
  const searching = needle.length > 0 && tab !== "guide";
  const show = (k: string) => (searching ? k === "glossary" || k === "fix" || k === "recipes" : tab === k);

  return (
    <Modal title="Help & Visual Glossary" icon={<BookOpen size={16} />} onClose={() => setModal(null)} width={1060}>
      <div className="flex h-[min(720px,82vh)] min-h-0 flex-col">
        <div className="flex flex-none items-center gap-2 border-b border-white/[0.07] px-4 py-2">
          <div className="flex flex-1 gap-1 overflow-x-auto">
            {TABS.map(([id, label, Icon]) => (
              <button key={id} onClick={() => (setState({ helpTab: id }), setQ(""))} className={`flex flex-none items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] ${tab === id && !searching ? "bg-white/10 text-white" : "text-[#7d8aa0] hover:text-white"}`}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {tab !== "guide" && (
            <div className="flex h-8 w-[260px] items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3">
              <Search size={13} className="text-[#7d8aa0]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search every term, tool & tip…" className="flex-1 bg-transparent text-[12.5px] text-white outline-none placeholder:text-[#566074]" style={{ userSelect: "text" }} />
            </div>
          )}
        </div>

        <div className="kx-scroll min-h-0 flex-1 overflow-y-auto">
          {tab === "guide" ? (
            <Guide embedded onClose={() => setModal(null)} onTry={(id) => (setModal(null), void import("../lib/menus").then((m) => m.runRecipe(id)))} />
          ) : (
            <div className="space-y-6 p-5">
              {show("start") && (
                <section>
                  <div className="mb-1 text-[18px] font-semibold text-white">Your first animation in 9 steps</div>
                  <p className="mb-3 text-[13px] text-[#9aa6bb]">No experience needed. Tick each step as you go — your progress is remembered. ({done.length}/{WALK.length} done)</p>
                  <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-[#3B82F6] to-[#06B6D4] transition-all" style={{ width: `${(done.length / WALK.length) * 100}%` }} /></div>
                  <div className="space-y-2">
                    {WALK.map((w, i) => (
                      <div key={w.id} className={`flex items-start gap-3 rounded-xl border p-3 ${done.includes(w.id) ? "border-cyan/30 bg-cyan/[0.05]" : "border-white/[0.07] bg-white/[0.025]"}`}>
                        <button onClick={() => toggle(w.id)} aria-label={`Mark step ${i + 1} done`} className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-md border ${done.includes(w.id) ? "border-cyan bg-cyan text-[#07090e]" : "border-white/25"}`}>{done.includes(w.id) && <Check size={13} />}</button>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-semibold text-white">{i + 1}. {w.title}</div>
                          <div className="text-[12.5px] text-[#9aa6bb]">{w.body}</div>
                        </div>
                        {w.action && <button className="tbtn !h-[26px] flex-none" onClick={w.action.run}>{w.action.label} <ChevronRight size={12} /></button>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-[12.5px] text-[#9aa6bb]">
                    <b className="text-white">Stuck on a word?</b> Turn on Inspect Mode (<kbd className="mono rounded border border-white/15 px-1">{keyLabel("inspect_mode") || "?"}</kbd>), then hover any button, slider, panel, light handle or timeline track — the helper robot explains what it is, why you'd use it, and your current shortcut.
                  </div>
                </section>
              )}

              {show("glossary") && (
                <section>
                  {!searching && <div className="mb-3 text-[18px] font-semibold text-white">Visual glossary <span className="text-[13px] font-normal text-[#7d8aa0]">· {terms.length} terms, plain English</span></div>}
                  {searching && <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-cyan">Glossary · {terms.length}</div>}
                  <div className="grid gap-3">
                    {terms.map((t) => (
                      <Card key={t.term}>
                        <div className="mb-1 flex items-baseline gap-2">
                          <h4 className="text-[14.5px] font-semibold text-white">{t.term}</h4>
                          <span className="rounded bg-white/[0.07] px-1.5 py-px text-[9.5px] uppercase tracking-wider text-[#8a93a6]">{t.group}</span>
                          {t.action && keyLabel(t.action) && <kbd className="mono ml-auto rounded border border-white/15 px-1.5 py-px text-[10.5px] text-[#9aa6bb]">{keyLabel(t.action)}</kbd>}
                        </div>
                        <dl className="space-y-1 text-[12.5px] leading-relaxed text-[#B8C0D2]">
                          <div><dt className="inline font-semibold text-cyan">What it is: </dt><dd className="inline">{t.what}</dd></div>
                          <div><dt className="inline font-semibold text-amber">Why use it: </dt><dd className="inline">{t.why}</dd></div>
                          {t.tip && <div><dt className="inline font-semibold text-[#8FB8FF]">Pro tip: </dt><dd className="inline">{t.tip}</dd></div>}
                        </dl>
                        {t.demo && <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/25 p-3">{DEMOS[t.demo]()}</div>}
                      </Card>
                    ))}
                    {!terms.length && <div className="py-6 text-center text-[12.5px] text-[#6F788D]">No glossary match.</div>}
                  </div>
                </section>
              )}

              {show("recipes") && (
                <section>
                  <div className="mb-1 text-[18px] font-semibold text-white">AI prompt recipes</div>
                  <p className="mb-3 text-[12.5px] text-[#9aa6bb]">Click a recipe to put it in the AI Director box, then press Enter. <b className="text-white">Lighting prompts work instantly, even with no model installed.</b></p>
                  <div className="mb-4 grid gap-2">
                    {LIGHT_PROMPTS.filter((p) => !needle || p.toLowerCase().includes(needle)).map((p) => (
                      <button key={p} className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-left text-[12.5px] text-[#DDE3F0] hover:border-cyan/40" onClick={() => (setState({ prompt: p }), setModal(null))}>
                        <Wand2 size={14} className="flex-none text-cyan" /> {p}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-2">
                    {recipes.map((r) => (
                      <button key={r.id} className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-left hover:border-cyan/40" onClick={() => (setState({ prompt: r.prompt ?? "" }), setModal(null))}>
                        <div className="text-[13px] font-semibold text-white">{r.title}</div>
                        <div className="text-[12px] text-[#9aa6bb]">{r.prompt}</div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {show("fix") && (
                <section>
                  <div className="mb-3 text-[18px] font-semibold text-white">Troubleshooting</div>
                  <div className="grid gap-2">
                    {fix.map(([a, b]) => (
                      <Card key={a}>
                        <div className="text-[13.5px] font-semibold text-white">{a}</div>
                        <div className="mt-0.5 text-[12.5px] text-[#9aa6bb]">{b}</div>
                      </Card>
                    ))}
                    {!fix.length && <div className="py-6 text-center text-[12.5px] text-[#6F788D]">No troubleshooting match.</div>}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
