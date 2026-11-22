// Plain-English explainer cards for the Dynamic Island "Inspect Mode" (and the Help Hub).
// Every card has three parts written for someone who has never animated before:
//   what  – a one-sentence definition with no jargon
//   why   – when / why you would use it, with a real-world example
//   tip   – a pro tip (the island also shows the user's *current* keybind for `action`)
import { kbGet } from "./knowledge";

export interface HelpCard {
  title: string;
  what: string;
  why: string;
  tip: string;
  /** keybind action id — the island shows the user's active shortcut for it */
  action?: string;
}

const C = (title: string, what: string, why: string, tip: string, action?: string): HelpCard => ({ title, what, why, tip, action });

export const CARDS: Record<string, HelpCard> = {
  "tool-select": C("Select / Move", "The pointer. Click an object to pick it, then drag it around.", "Use it to position things. Example: drag your logo to the left third of the screen before animating it sliding in.", "Hold Shift while clicking to select several objects at once.", "tool_select"),
  "tool-brush": C("Freehand Brush", "Draw with your mouse or pen like a pencil — Kinetix smooths the wobble into clean curves.", "Great for hand-drawn underlines, swooshes or quick character doodles.", "Raise Smoothing in the brush bar if your line looks shaky.", "tool_brush"),
  "tool-pen": C("Bézier Pen", "Place points one by one; dragging a point bends the line leaving it.", "Use it for precise shapes like a logo mark or a character outline.", "Click the first point again to close the shape. Press Enter to finish an open line.", "tool_pen"),
  "tool-shape": C("Custom Shape", "Drag on the canvas to make a rectangle, circle, star, polygon or line.", "The fastest way to build cards, buttons, bars and icons.", "Pick the shape type from the little arrow next to the button.", "tool_shape"),
  "tool-text": C("Text", "Click the canvas to add a piece of text that can animate in letter by letter.", "Use it for titles, lower thirds and captions. Example: a title that pops in one word at a time.", "Select the text and open the Text section in the Inspector to change the effect.", "tool_text"),
  "tool-image": C("Import Image", "Bring in a picture (PNG, JPG, WebP or SVG) to animate like any other object.", "Use it for your real logo, a photo or an illustration.", "You can also drag a file straight onto the canvas.", "import_image"),
  "tool-light": C("Add Light", "Places an invisible studio light. The light itself never shows — only the glow and highlights it throws on your objects.", "Use it to make flat shapes look 3-D. Example: a cyan edge-glow on your logo from the top-left.", "Select the light afterwards: drag the dashed ring to move it and the crosshair to aim it.", "tool_light"),
  "tool-hand": C("Hand (pan)", "Grab the canvas and slide the view around without touching your objects.", "Useful when you have zoomed in and need to reach another corner.", "Hold the middle mouse button to pan temporarily with any tool.", "tool_hand"),
  "tool-eyedropper": C("Eyedropper", "Click anywhere on the canvas to copy the colour you see there.", "Use it to match a new shape to a colour that is already in your scene.", "With an object selected, the picked colour is applied to it straight away.", "tool_eyedropper"),
  undo: C("Undo", "Takes back your last change.", "Made a mistake? One click and you're back. It works for AI edits too.", "The button greys out when there is nothing left to undo.", "undo"),
  redo: C("Redo", "Puts back a change you just undid.", "Went one step too far back? Redo brings it back.", "Making any new edit clears the redo list — that's normal.", "redo"),
  "project-menu": C("Project menu", "Where you start a new project, open or save files, and rename.", "New Blank Project gives you an empty canvas — nothing pre-made.", "The sample showcase lives here too if you want something to poke at.", "new_project"),
  "mode-toggle": C("Studio | Zen", "Studio shows every panel. Zen hides them all so your animation fills the window.", "Use Zen to focus on how it looks, or to present your work. Everything you need stays in small floating pills.", "Press the key again (or click “Exit Zen”) to come straight back.", "toggle_zen"),
  "model-settings": C("Model Settings", "Choose the local AI brain that understands your typed instructions.", "Needed only for free-form AI commands; lighting prompts and every manual tool work without it.", "Everything runs on your computer — nothing is uploaded."),
  docs: C("Help & Docs", "An interactive guide that explains every tool in plain English, with little demos.", "Start here if a word like “easing” or “rim light” is new to you.", "Press the help key any time to search it.", "open_help"),
  export: C("Export", "Turns your animation into a video, GIF, image sequence or vector file you can share.", "Use MP4 for social media, GIF for chat, PNG sequence for editing software.", "The result is frame-perfect: every frame is drawn exactly as you see it.", "export"),
  "export-dialog": C("Export dialog", "Choose format, size, speed (fps) and which part of the timeline to save.", "Example: 1080p, 30 fps MP4 is a safe default for most platforms.", "Cancel any time — temporary files are cleaned up."),
  "export-format": C("Export format", "The kind of file you get: video (MP4), animated image (GIF), pictures (PNG), or vector (SVG).", "Pick MP4 to share, SVG when you need sharp scalable art.", "MP4 and GIF need FFmpeg; the others work without it."),
  "export-progress": C("Export progress", "Shows how many frames are done and roughly how long is left.", "So you know whether to wait or grab a coffee.", "Closing the app cancels the export safely."),
  "export-ffmpeg": C("FFmpeg", "A free helper program that packs your frames into a video file.", "Required only for MP4 and GIF.", "If it's missing, PNG sequence, SVG and JSON still work."),
  outliner: C("Outliner", "The list of everything in your scene — objects, lights and particle emitters.", "Click a name to select it. Drag one name onto another to make it a child (it will follow its parent).", "Use the eye icon to hide something while you work.", "group"),
  assets: C("Asset Library", "Ready-made templates, shapes and your imported pictures.", "Click a template to drop a finished animated piece (like a lower third) into your scene.", "‘New Project’ stays blank — templates are only added when you click them."),
  viewport: C("Canvas", "Your stage. What you see here is exactly what gets exported.", "Click objects to edit them, or use a tool to draw new ones.", "Scroll to zoom, hold Space or use the Hand tool to pan.", "zoom_fit"),
  fps: C("FPS counter", "Frames per second — how many pictures the preview draws every second.", "Around 60 means butter-smooth. Low numbers mean the scene is heavy.", "It shows 0 when paused."),
  inspector: C("Inspector", "The settings panel for whatever is selected.", "Change size, colour, glow, lighting and more without touching the canvas.", "Drag any slider; the number box on the right lets you type exact values."),
  director: C("AI Director", "Type what you want in plain English and the AI makes the change.", "Example: “Make the logo bounce in from the left.”", "Press the focus key to jump straight to the box.", "focus_ai"),
  "director-input": C("AI prompt box", "Where you describe the change you want.", "Be specific: say which object, what should happen, and how long it should take.", "Try “Cast a cool cyan rim light from top-left onto the logo”.", "focus_ai"),
  chips: C("Quick actions", "One-click example prompts.", "A fast way to try common moves like easing, bounces and rim lights.", "Click one, then edit the text before sending."),
  token: C("Micro-Context meter", "Shows how much of the AI's tiny memory your request uses. Kinetix only sends the few facts that matter.", "Keeps the AI fast and accurate on a normal laptop.", "If it's near full, make your prompt shorter."),
  timeline: C("Timeline", "The strip at the bottom that shows time. Left is the start, right is the end.", "Move the playhead to a moment, then change something to set a keyframe there.", "Drag along the ruler to scrub through your animation."),
  transport: C("Play controls", "Play, pause and jump buttons for the preview.", "Use them to watch your animation as it will really look.", "The space bar toggles play.", "play_pause"),
  playhead: C("Playhead", "The vertical line marking the current moment in time.", "Everything you see on the canvas is the scene at this exact moment.", "Use the arrow keys to nudge it one frame at a time.", "step_fwd"),
  loop: C("Loop", "Starts over automatically when the animation ends.", "Handy when polishing a short motion again and again.", "Turn it off to see exactly where the animation stops.", "loop_toggle"),
  onion: C("Onion skin", "Shows a faint ghost of the scene a moment earlier.", "Lets you judge how far something moved between frames — handy for character animation.", "It only shows while paused.", "onion_toggle"),
  snap: C("Snap", "Makes things land on tidy grid numbers when you drag them.", "Keeps layouts neat and aligned. Example: three cards perfectly in a row.", "Turn it off for very fine, free-hand placement.", "toggle_snap"),
  duration: C("Duration", "How many seconds long your animation is.", "Set it before you start so you know how much time you have.", "You can change it any time — keyframes stay put."),
  "story-flag": C("Story flag", "A labelled marker on the timeline for a part of your story, like “Intro”.", "Lets you (and the AI) talk about moments by name: “after Intro, fade the logo”.", "Click a flag to jump the playhead there."),
  "dopesheet-tracks": C("Dope sheet", "A grid that shows every change you've recorded, one row per property.", "Use it to see timing at a glance and drag keyframes earlier or later.", "Right-click a diamond for easing choices and copy/paste.", "next_keyframe"),
  "dopesheet-ruler": C("Time ruler", "The numbers across the top show seconds.", "Click or drag on it to jump to any moment.", "The playhead follows your pointer."),
  keyframe: C("Keyframe", "A diamond that remembers a value (like position) at one moment.", "Set two keyframes and Kinetix fills in the movement between them. Example: logo at left at 0s, centre at 1s.", "Drag a diamond sideways to change its timing. Easing controls how the motion feels between two diamonds.", "add_keyframe"),
  "light-origin": C("Light origin", "The dashed ring marks where the light is placed. The ring only shows while editing — never in your final video.", "Move it to change where the light comes from. Example: top-left makes shadows fall to the bottom-right.", "Drag to move; it records a keyframe if the light is already animated."),
  "light-target": C("Aim target", "The crosshair marks the spot the light is pointed at.", "Drag it onto the object you want lit. Example: aim a beam at your title so only the title glows.", "Animate it from one object to another to make the light sweep across your scene."),
  "light-cone": C("Cone spread", "The diamond on the beam's edge sets how wide the beam opens, like a flashlight's focus.", "Narrow = dramatic spotlight on one thing. Wide = soft wash over a group.", "A beam of 20–30° looks natural; under 10° looks like a laser."),
  "light-falloff": C("Falloff distance", "How far the light reaches before it fades to nothing.", "Short falloff keeps light close to the source; long falloff lights the whole scene.", "Objects beyond the end of the beam get no highlight at all."),
  inspect: C("Inspect Mode (?)", "Turns the cursor into a question mark: hover or click anything and I'll explain it.", "Perfect when you meet a button or slider you don't recognise.", "Press Esc to leave Inspect Mode.", "inspect_mode"),
  island: C("Dynamic Island helper", "That's me! A pill that grows into a helper whenever you need an explanation.", "Ask a question, or turn on Inspect Mode and point at anything.", "I work fully offline.", "inspect_mode"),
};

/** Field cards — keyed by the slug of the control's label (Inspector sliders, toggles, selects …). */
export const FIELDS: Record<string, HelpCard> = {
  x: C("X position", "How far across the stage the object sits (0 = left edge, 100 = right edge).", "Move things horizontally with numbers when dragging isn't precise enough.", "Set a keyframe here to make it slide sideways."),
  y: C("Y position", "How far down the stage the object sits (0 = top, 100 = bottom).", "Place things vertically; combine with X for exact layouts.", "Animating Y gives lifts, drops and bounces."),
  rotation: C("Rotation", "Turns the object around its pivot, in degrees.", "A 360° spin over one second makes a loading spinner.", "Shift-drag the round handle to rotate in 15° steps."),
  scale: C("Scale", "How big the object is. 1 is normal size, 2 is double.", "Pop-in effects go from 0 to 1 with a little overshoot.", "Scale from the pivot — move the pivot to change what it grows from."),
  opacity: C("Opacity", "How see-through the object is. 1 is solid, 0 is invisible.", "Fade things in and out. Example: fade a title out right before the scene changes.", "Combine with Scale for a classic ‘pop’ entrance."),
  "pivot-x": C("Pivot", "The point an object turns and grows around — like the hinge of a door.", "Move it to the end of a character's arm to make it swing from the shoulder.", "The little cyan cross on the canvas shows the pivot."),
  glow: C("Glow", "Makes the object shine softly, like a neon sign.", "Use it on titles or eyes. Example: a glowing title on a dark background.", "Needs Bloom on in Environment to look its best."),
  blend: C("Blend mode", "Chooses how this object mixes its colours with whatever is behind it.", "Screen makes light effects, Multiply makes shadows, Normal just covers.", "Try Screen on glow shapes to get a light-leak look."),
  fill: C("Fill colour", "The main colour inside the shape.", "Pick your brand colour, or use Gradient for a smooth blend.", "Use the eyedropper tool to match a colour from elsewhere.", "tool_eyedropper"),
  stroke: C("Outline", "A line drawn around the edge of the shape.", "Gives icons a clean outline or cards a subtle border.", "Set the width to 0.2–0.5 for a delicate look."),
  intensity: C("Intensity", "How strong the light is.", "Low is subtle and moody; high is dramatic.", "Keyframe it from 0 up to flash a light on at a certain moment."),
  radius: C("Falloff distance", "How far the light reaches before fading out.", "Short keeps the glow tight; long fills the scene.", "Drag the round handle at the end of the beam on the canvas."),
  cone: C("Cone spread", "How wide the beam opens, in degrees.", "Narrow for a spotlight, wide for a soft wash.", "Drag the diamond on the beam's edge."),
  "rim-spread": C("Rim light spread", "How thick the bright edge on the object is.", "A thin edge looks like a crisp highlight; a wide one looks like a strong backlight.", "Try 0.4 for subtle, 1.5 for dramatic."),
  "rim-intensity": C("Rim intensity", "How bright the edge highlight is.", "Turn it up to separate an object from a dark background.", "Rim only appears on the side facing a light."),
  morph: C("Morph", "Smoothly changes one shape into another.", "Great for icon transitions — a play button turning into a pause button.", "Keyframe it from 0 to 1 and pick an easing."),
  volumetric: C("Light shafts", "Adds a soft, misty beam so you can see the light travelling through the air.", "Gives cinematic atmosphere. Turn it off for a cleaner, flat look.", "Only the beam shows — never a ball."),
  follow: C("Follow", "Makes the light or emitter stick to another object.", "Example: a spotlight that tracks your character as it walks.", "Offsets become relative to the followed object."),
  type: C("Light type", "Spot = a cone of light. Directional = parallel light from one side (great for rim highlights). Area = a soft glow in all directions.", "Spot for focus, Directional for edge highlights, Area for general warmth.", "All three are invisible — you only see their effect."),
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Resolve a data-help key to a 3-part card (exact card → field card → knowledge-base entry → generic). */
export function getHelpCard(key: string): HelpCard | null {
  if (CARDS[key]) return CARDS[key];
  const m = /^(?:slider|field):(.+)$/.exec(key);
  if (m) {
    const f = FIELDS[m[1]] ?? FIELDS[m[1].replace(/-(\d+|x|y)$/, "")];
    if (f) return f;
    const label = m[1].replace(/-/g, " ");
    return C(label.replace(/^./, (c) => c.toUpperCase()), `A control for “${label}” of the selected item.`, "Drag it and watch the canvas — changes are instant and you can undo any time.", "Click the ◆ next to a value (or press the keyframe key) to animate it over time.", "add_keyframe");
  }
  const kb = kbGet(key);
  if (kb) return C(kb.title.replace(/\s*\([^)]*\)\s*$/, ""), kb.text, "Use it whenever you need this part of the studio — hover other controls to compare.", "Turn on Inspect Mode and move the cursor over anything else you're curious about.", "inspect_mode");
  return null;
}

export const fieldHelp = (label: string) => `field:${slug(label)}`;
export const sliderHelp = (label: string) => `slider:${slug(label)}`;
