export interface KB {
  id: string;
  title: string;
  text: string;
  keys: string[];
}

/** Embedded App Knowledge Base — powers Inspect Mode tooltips and the offline rule-based chat fallback. */
export const KB: KB[] = [
  { id: "tool-select", title: "SELECT TOOL (V)", text: "Click objects to select them, drag to move, use the corner handles to scale and the round handle on top to rotate. Press Enter on a path to edit its Bézier nodes.", keys: ["select", "move", "scale", "rotate", "gizmo", "handle", "pointer"] },
  { id: "tool-brush", title: "FREEHAND BRUSH (B)", text: "Draw with the mouse or a stylus. Your stroke is smoothed into clean cubic Bézier curves. Tune Smoothing, Width and Taper in the floating brush bar, then save it as a reusable custom shape.", keys: ["brush", "freehand", "draw", "sketch", "paint", "stroke", "smooth", "taper"] },
  { id: "tool-pen", title: "BÉZIER PEN (P)", text: "Click to drop corner anchors, click-and-drag to pull out smooth tangent handles. Click the first anchor to close the shape, Enter to finish an open path, Esc to cancel.", keys: ["pen", "bezier", "bézier", "anchor", "node", "path", "curve", "tangent"] },
  { id: "tool-shape", title: "CUSTOM SHAPE (S)", text: "Drag on the canvas to create a parametric shape: rectangle, ellipse, star, polygon or line. Every shape is a real Bézier path you can edit node by node.", keys: ["shape", "rectangle", "ellipse", "circle", "star", "polygon", "line", "rect"] },
  { id: "tool-text", title: "TEXT TOOL (T)", text: "Click on the canvas and type. Text is a first-class object — it can be keyframed, lit with rim light and animated per character or word with kinetic typography.", keys: ["text", "type", "typography", "font", "title", "letters"] },
  { id: "tool-image", title: "IMPORT IMAGE (I)", text: "Import PNG, JPG, WebP or SVG. You can also drag & drop files straight onto the canvas. Images become animatable sprites: scale, rotate, tint, rim-light, parent other parts to them or use them as parallax layers.", keys: ["image", "import", "png", "jpg", "webp", "svg", "sprite", "drop", "picture", "asset"] },
  { id: "tool-light", title: "ADD LIGHT (L)", text: "Click the canvas to place a light. Choose Point, Spot or Sun/Moon in the Inspector. Lights are scene objects, so they can be animated, parented and keyframed like anything else.", keys: ["light", "lamp", "sun", "moon", "spot", "point", "glow", "lighting"] },
  { id: "undo", title: "UNDO (Ctrl+Z)", text: "Steps back through every edit — manual or AI. Each edit stores a lightweight snapshot, so you can undo dozens of steps instantly.", keys: ["undo", "revert", "mistake", "back"] },
  { id: "redo", title: "REDO (Ctrl+Y)", text: "Re-applies the edit you just undid. Making any new edit clears the redo list.", keys: ["redo", "forward"] },
  { id: "project-menu", title: "PROJECT MENU", text: "New Blank Project opens an empty canvas with zero scenes or characters. Open and Save work with .kinetix.json files, and Open Sample Showcase reloads the 'Apex Morph' demo.", keys: ["project", "new", "open", "save", "sample", "showcase", "blank", "file", "menu"] },
  { id: "mode-toggle", title: "STUDIO | ZEN", text: "Studio shows all four panels. Zen makes the canvas edge-to-edge with a floating Ctrl+K AI bar and a mini timeline. Press Tab to flip between them.", keys: ["zen", "studio", "mode", "fullscreen", "tab", "focus", "distraction"] },
  { id: "model-settings", title: "MODEL SETTINGS", text: "Open the AI Engine panel to pick a local model tier or load your own .gguf file. Everything runs 100% offline on your machine — no cloud, no terminal.", keys: ["model", "ollama", "llama", "gguf", "ai", "engine", "download", "install", "qwen"] },
  { id: "docs", title: "DOCS", text: "The built-in user guide: model setup, drawing, image import & rigging, rim lighting, timeline & morphing, kinetic type & environments, exporting, and a prompt cookbook.", keys: ["docs", "guide", "help", "manual", "documentation", "tutorial"] },
  { id: "export", title: "EXPORT", text: "Opens the exporter: MP4 (H.264), GIF (palette-optimised), PNG sequence, SVG snapshot or Scene JSON. Every frame is rendered by the same renderer as the viewport at t = frame ÷ fps, at 720p, 1080p or a custom size, 24/30/60 fps, over the range you choose.", keys: ["export", "render", "mp4", "gif", "video", "sequence", "png", "svg", "json", "h264", "save"] },
  { id: "export-dialog", title: "EXPORT DIALOG", text: "Pick a format, resolution, frame rate and time range, choose the output with the native save dialog, then press Export. Progress shows frame x / N, ETA and MB written; Cancel kills FFmpeg and deletes every temp file.", keys: ["export dialog", "progress", "cancel", "eta"] },
  { id: "export-format", title: "EXPORT FORMAT", text: "MP4 and GIF are encoded by FFmpeg; PNG sequence, SVG, Scene JSON and PNG still need nothing extra. MP4 uses H.264 yuv420p with faststart; GIF uses an optimised 256-colour palette.", keys: ["format", "codec", "h264", "palette"] },
  { id: "export-res", title: "EXPORT RESOLUTION", text: "720p and 1080p keep the scene's aspect ratio; Custom takes any even size up to 7680 × 4320. The scene is on a 0–100 grid, so the composition never changes with the size.", keys: ["resolution", "720p", "1080p", "4k", "size", "pixels"] },
  { id: "export-fps", title: "EXPORT FRAME RATE", text: "24, 30 or 60 fps. Frame i is rendered at exactly t = i ÷ fps, so the result is deterministic. GIF delays are 1/100 s, so 60 fps plays at about 50.", keys: ["fps", "frame rate", "framerate", "60"] },
  { id: "export-range", title: "EXPORT RANGE", text: "Start and end in seconds. The end is exclusive: a 10 s project at 60 fps is exactly 600 frames. 'From playhead' starts the export where the timeline is parked.", keys: ["range", "start", "end", "trim", "duration", "frames"] },
  { id: "export-quality", title: "MP4 QUALITY (CRF)", text: "CRF 18 is visually near-lossless; higher numbers make smaller files. The preset trades encode speed for size — veryfast is the default.", keys: ["crf", "quality", "bitrate", "preset", "size"] },
  { id: "export-output", title: "EXPORT OUTPUT", text: "Choose where the file goes with the native save dialog (or a folder for PNG sequences). Videos are written to a .part file and renamed only when FFmpeg finishes, so a failed export never leaves a broken file.", keys: ["output", "path", "folder", "save", "destination"] },
  { id: "export-ffmpeg", title: "FFMPEG", text: "MP4/GIF need FFmpeg. Kinetix looks at KINETIX_FFMPEG, then a copy bundled beside the app, then your PATH. Install: winget install Gyan.FFmpeg (Windows) or sudo apt install ffmpeg (Linux). PNG sequence, SVG and JSON work without it.", keys: ["ffmpeg", "install", "missing", "not found", "encoder", "x264"] },
  { id: "export-progress", title: "EXPORT PROGRESS", text: "Frame x / N, ETA, elapsed time and MB written. Cancel stops at once: FFmpeg is killed and temp/partial files are removed. Disk-full and permission errors are reported in plain language.", keys: ["progress", "eta", "disk full", "permission", "cancel", "error"] },
  { id: "outliner", title: "OUTLINER & RIG", text: "Every object in your scene as a tree. Drag a row onto another to parent it. Child parts inherit their parent's movement, rotation and scale. Use the eye to hide and the lock to protect an object.", keys: ["outliner", "layers", "tree", "rig", "parent", "child", "hierarchy", "rigging"] },
  { id: "assets", title: "SHAPE & ASSET LIBRARY", text: "Reusable custom shapes (saved from any path) and imported images live here. Click one to drop it into the scene.", keys: ["library", "assets", "shapes", "images", "reuse", "custom"] },
  { id: "viewport", title: "VIEWPORT", text: "The hardware-accelerated canvas. Scroll to zoom, hold Space or middle-mouse to pan, press F to fit. Rulers show the normalized 0–100 scene grid, independent of export size.", keys: ["viewport", "canvas", "zoom", "pan", "stage", "grid", "ruler", "coordinates"] },
  { id: "fps", title: "FPS READOUT", text: "Live frame rate of the viewport. Kinetix targets a locked 60 FPS.", keys: ["fps", "performance", "speed", "frame rate"] },
  { id: "inspector", title: "INSPECTOR", text: "All properties of the selected object: transform, fill & stroke, realistic lighting and the cubic-Bézier curve editor for the selected keyframes.", keys: ["inspector", "properties", "panel"] },
  { id: "pos", title: "POSITION X / Y", text: "Where the object sits on the 0–100 grid. (0,0) is the top-left corner, (100,100) the bottom-right. If this channel has keyframes, editing it writes a keyframe at the playhead.", keys: ["position", "x", "y", "coordinates", "location"] },
  { id: "scale", title: "SCALE", text: "Uniform size multiplier around the pivot point. 1.0 is original size.", keys: ["scale", "size", "bigger", "smaller"] },
  { id: "rotation", title: "ROTATION", text: "Rotation in degrees around the pivot crosshair. Negative values turn counter-clockwise.", keys: ["rotation", "rotate", "angle", "degrees", "spin"] },
  { id: "pivot", title: "PIVOT", text: "The point an object rotates and scales around, in its own local space. Drag the crosshair gizmo on the canvas to move it.", keys: ["pivot", "origin", "anchor point", "center"] },
  { id: "opacity", title: "OPACITY", text: "Transparency of the object and everything parented to it. Keyframe it for fades and cross-dissolves.", keys: ["opacity", "transparency", "fade", "alpha"] },
  { id: "blend", title: "BLEND MODE", text: "How this object's pixels combine with what's behind it. Screen and Lighter (additive) are perfect for glows, light beams and sparks.", keys: ["blend", "screen", "multiply", "additive", "composite", "overlay"] },
  { id: "fill", title: "FILL", text: "Solid colour or a two/three-stop linear gradient with adjustable angle.", keys: ["fill", "color", "colour", "gradient", "paint"] },
  { id: "stroke", title: "STROKE", text: "Outline colour and thickness in scene units. Freehand strokes can also taper at both ends.", keys: ["stroke", "outline", "border", "line width"] },
  { id: "rim", title: "RIM LIGHT", text: "A specular edge light that wraps around the silhouette of vector shapes, text and sprites. Set colour, intensity and spread. Keyframe the intensity to make flashes and morph glows.", keys: ["rim", "rim light", "edge", "specular", "backlight", "realistic"] },
  { id: "rim-intensity", title: "RIM INTENSITY", text: "How strong the rim light is, from 0 to 1000. Animate it (Rim_Intensity track) for pulses.", keys: ["intensity", "brightness", "strength"] },
  { id: "rim-spread", title: "RIM LIGHT SPREAD", text: "Defines how softly the light wraps around the character. High values create a subtle glow; low values give a thin crisp edge.", keys: ["spread", "soft", "wrap", "glow"] },
  { id: "rim-color", title: "RIM COLOUR", text: "The rim runs from the first colour to the second across the object, like warm amber on one side and cool cyan on the other.", keys: ["rim colour", "rim color", "amber", "cyan"] },
  { id: "shadows", title: "SHADOWS", text: "Soft cast shadow behind the object — set colour, blur, offset and opacity.", keys: ["shadow", "drop shadow", "cast", "blur"] },
  { id: "curve", title: "CUBIC-BÉZIER CURVE", text: "Drag the two handles to shape how a segment accelerates between keyframes. Pick a preset like ease-in-out or spring, or draw your own curve.", keys: ["curve", "easing", "ease", "bezier curve", "spring", "timing", "interpolation"] },
  { id: "director", title: "AI DIRECTOR", text: "Describe a change in plain English. The local AI translates it into structured scene JSON — it never draws pixels — so playback stays a smooth 60 FPS. It runs 100% offline through Ollama or llama.cpp on 127.0.0.1.", keys: ["director", "ai", "prompt", "describe", "command", "natural language"] },
  { id: "chips", title: "QUICK CHIPS", text: "One-click prompt starters. They fill the AI Director bar so you can tweak and send.", keys: ["chips", "suggestions", "examples", "quick"] },
  { id: "token", title: "MICRO-CONTEXT INSPECTOR", text: "Shows exactly what the AI would see: a tiny roster of cast, the selected object, and the keyframe at the playhead — typically 50–150 tokens instead of the whole project.", keys: ["token", "tokens", "context", "micro-context", "inspector", "payload", "memory"] },
  { id: "dopesheet", title: "KEYFRAME DOPE SHEET", text: "One row per animated property. Drag amber diamonds to retime them, Shift-click to select several, Delete to remove. Right-click for Add, Copy, Paste and easing options.", keys: ["dope", "dopesheet", "timeline", "keyframe", "keyframes", "track", "diamond"] },
  { id: "keyframe", title: "KEYFRAME ◆", text: "A recorded value at one moment in time. Drag the diamond to retime it, Shift-click to select several, then shape the motion between keys with the Cubic-Bézier curve editor.", keys: ["keyframe", "diamond", "key", "retime"] },
  { id: "play", title: "PLAY / PAUSE (Space)", text: "Plays the animation at a locked 60 frames per second. Tap Space, or click this button.", keys: ["play", "pause", "preview", "playback"] },
  { id: "transport", title: "TRANSPORT", text: "Play / pause (Space), step one frame (← →), jump to start or end, and toggle looping.", keys: ["play", "pause", "transport", "stop", "loop", "frame"] },
  { id: "autokey", title: "AUTO-KEY", text: "When on, any change to position, rotation, scale or opacity automatically records a keyframe at the playhead.", keys: ["auto key", "autokey", "record", "animate", "automatic"] },
  { id: "onion", title: "ONION SKIN", text: "Shows faint ghosts of the selected object a moment before (amber) and after (cyan) the playhead so you can judge motion arcs.", keys: ["onion", "ghost", "skin", "arc"] },
  { id: "snap", title: "SNAPPING", text: "Snaps moves to the grid and keyframes to whole frames.", keys: ["snap", "snapping", "grid"] },
  { id: "story-track", title: "STORY EVENT FLAGS", text: "One-line scene summaries with time ranges, like 'Mid-Air Morph'. They let you (and the AI) refer to moments by meaning instead of by raw keyframes.", keys: ["story", "event", "flag", "scene", "semantic", "chapter"] },
  { id: "playhead", title: "PLAYHEAD", text: "Drag along the ruler to scrub. The timecode reads minutes:seconds.frames at 60 frames per second.", keys: ["playhead", "scrub", "timecode", "time"] },
  { id: "island", title: "DYNAMIC ISLAND HELPER", text: "That's me! Hover or click any control while Inspect Mode (?) is on and I'll explain it. Or just type a question below.", keys: ["island", "helper", "robot", "bot", "assistant"] },
  { id: "inspect", title: "INSPECT MODE", text: "While Inspect Mode is on, controls don't run when you click them — I just explain what they do. Click ? again or press Esc to leave.", keys: ["inspect", "question mark", "explain"] },
  { id: "howto-new", title: "NEW BLANK PROJECT", text: "Project menu → New Blank Project. You get a completely empty canvas — no pre-loaded scenes or characters.", keys: ["blank", "empty", "clean", "start", "fresh"] },
  { id: "howto-morph", title: "MORPHING", text: "Shape-to-shape path morphing (morph_to) turns any custom path into another — set it in the Inspector or ask the Director (\"morph the circle into a star at 1s over 2s\"). Clone Variant duplicates a rig with overrides. The Apex Morph sample morphs a falcon into a Shadow Beast this way.", keys: ["morph", "transform into", "turn into", "shapeshift"] },
  { id: "howto-offline", title: "100% OFFLINE", text: "Kinetix Studio never calls a cloud API. The AI model runs locally through Ollama or llama.cpp, and projects live in a local SQLite database.", keys: ["offline", "cloud", "privacy", "internet", "local"] },
  { id: "howto-shortcuts", title: "SHORTCUTS", text: "V select · B brush · P pen · S shape · T text · I import · L light · Space play · ←/→ step frame · K add keyframe · Tab Studio/Zen · Ctrl+K Spotlight AI · Ctrl+Z / Ctrl+Y undo / redo · F fit view · Delete remove.", keys: ["shortcut", "shortcuts", "hotkey", "keyboard", "keys"] },
  { id: "howto-parent", title: "PARENT & RIG", text: "Right-click an object → Parent To, or drag its row onto another in the Outliner. The child then follows its parent's transform automatically.", keys: ["attach", "parent", "child", "rig", "limb", "bone"] },
];

const byId = new Map(KB.map((k) => [k.id, k]));
export const kbGet = (id: string) => byId.get(id);

const STOP = new Set(["the", "a", "an", "to", "how", "do", "i", "is", "what", "does", "can", "my", "of", "it", "in", "on", "and", "for", "this", "that", "me", "you", "with", "make", "use"]);

export function kbAnswer(q: string): { title: string; text: string; confident: boolean } {
  const words = q
    .toLowerCase()
    .replace(/[^a-z0-9é\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  let best: KB | null = null;
  let bestScore = 0;
  for (const e of KB) {
    let s = 0;
    for (const w of words) {
      for (const k of e.keys) {
        if (k === w) s += 3;
        else if (k.includes(w) || (w.length > 3 && w.includes(k))) s += 1.5;
      }
      if (e.title.toLowerCase().includes(w)) s += 1;
    }
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  if (best && bestScore >= 2) return { title: best.title, text: best.text, confident: true };
  return {
    title: "I'M NOT SURE YET",
    text: "Try asking about the brush, pen, importing images, rim light, keyframes, Zen mode or shortcuts — or turn on Inspect Mode (?) and hover any control.",
    confident: false,
  };
}
