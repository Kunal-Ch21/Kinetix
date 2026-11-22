# Kinetix Studio

Native 2D AI motion, vector & character animation suite — **Tauri v2 (Rust) + Vite + React 19 + TypeScript + Tailwind v4**. 100 % offline: SQLite (WAL) on disk, a local Ollama / llama.cpp on `127.0.0.1`, a 60 FPS Canvas2D engine.

One consistent project. The **Milestone 3 `Scene` model** (`src/engine/types.ts`) is the single source of truth; Milestone 1 (UI, drawing, persistence) and Milestone 2 (AI pipeline) run on top of it.

```
src/
  main.tsx, App.tsx          single root: layout, shortcuts, boot
  state/store.ts             Scene store, history (undo_push / undo_pop / redo_pop), persistence, image import
  engine/                    types · rig · ops (the ONE op vocabulary) · render · lighting · typography · particles
                             environment · path (morphing) · geometry (brush→Bézier fit) · images · sample
  components/                Header, IslandBot + Robot, Viewport, Outliner, Timeline/DopeSheet, Inspector, Director,
                             AiModals (Model Manager + missing-model gate), Modals (Export, Ctrl+K, Docs), ZenOverlay
  lib/                       ai (Rust bridge) · director · microcontext · knowledge (offline KB) · menus · native
  docs/chapters.json         docs source → Help Hub "User Guide" tab + public/docs/guide.html (npm run guide)
src-tauri/src/
  commands.rs                projects / assets / undo (save_project projects Scene → objects, parts, lights,
                             emitters, keyframes, story_events)
  ai/                        gatekeeper · ripple · schema · llm · compactor · commands
  export.rs                  Milestone 4 exporter: frame plan/naming, ffmpeg arg builder, job lifecycle
                             (start / write_frame / progress / cancel / finish), error mapping, ffmpeg discovery
src/export/                  plan.ts (frame range/naming, mirrors Rust) · exporter.ts (render → stream) · svg.ts
```

## Scripts

| | |
|---|---|
| `npm run dev` | Vite dev server (browser preview, localStorage fallback) |
| `npm run build` | `tsc --noEmit && vite build` → single-file `dist/index.html` |
| `npm run tauri dev` / `npm run tauri build` | desktop app |
| `npm run guide` | regenerate `public/docs/guide.html` from `chapters.json` |
| `node scripts/check-ops.mjs` | asserts `applyOps` cases == Rust `schema::OPS` |
| `npm test` | vitest engine tests: renderer determinism, export plan, SVG export, Rust-fixture sync |
| `cd src-tauri && cargo test` | gatekeeper, ripple, compactor, SQLite round-trip, export (ffmpeg arg builder, frame naming/range, real MP4/GIF/PNG pipeline when `ffmpeg` is on PATH) |
| `npm run ffmpeg:prepare` | stage FFmpeg as the Tauri sidecar `src-tauri/binaries/ffmpeg-<target-triple>` |
| `npm run tauri:build` / `npm run tauri:build:bundled` | installers without / with the bundled FFmpeg sidecar |

## AI pipeline (one op vocabulary)

`ai_run` → gatekeeper builds a ~150-token micro-context from SQLite → stateless 2-message call with a JSON Schema whose `op` enum is the `applyOps` vocabulary → `ripple::resolve` does **all** arithmetic (relative `modifier: add|multiply|set`, `speed_multiplier`, event-relative timing, ripple shift / split, duplicate lock, alias resolution) and returns ops in the *same* vocabulary (`set_track`, `set_event`, `set_duration`, … are produced by Rust only) → `applyOps` applies exactly what Rust returned.

Shortcuts: 50+ studio actions, all rebindable in **Settings → Keybinds** (click a row, press the new keys; conflicts offer *Swap* / *Override*; *Reset to Defaults*; saved to localStorage). Defaults: `V` select · `B` brush · `P` pen · `U` shape · `T` text · `Alt+L` light · `E` eyedropper · `H` hand · `Space` play · `I` keyframe · `J`/`K` prev/next keyframe · `Tab` Studio⇄Zen · `Ctrl+K` AI Director · `Ctrl+Z/Y` undo/redo (disabled when there is nothing to undo/redo) · `Ctrl+D` duplicate · `Ctrl+G` group · `Shift+?` Inspect Mode · `F1` Help.

## Lighting

Lights are **invisible studio emitters** (no sun disc): *Spot / Cone Beam*, *Directional Rim Light*, *Area / Point Light*. Each has an origin `(x1,y1)`, an aim target `(x2,y2)`, intensity, cone spread, falloff and an *affects* list (which objects get diffuse light, rim highlights and cast shadows). Select a light to get dashed on-canvas handles (never exported). AI ops: `add_light` / `set_light` with `origin_x/origin_y → target_x/target_y`, `aim`, `intensity`, `cone`, `falloff`, `at`+`duration` to sweep. Prompts like “Cast a cool cyan rim light from top-left onto the logo” are also understood locally (`src/lib/lightPrompt.ts`) with no model installed.

## Performance notes

The 60 FPS loop never touches React (playhead lives in `live`; timecode / scrub bar / dope-sheet playhead are DOM-updated at ~15 Hz). Static art is cached off-screen (`engine/cache.ts`, `engine/environment.ts`), particles use a fixed pool with a hard cap, there is no `shadowBlur` or full-canvas `filter`, DPR is clamped to 1.5, fonts are Latin-only, and the Rust side opens SQLite/WAL on a background thread (`db.rs::GatedConn`).


## Exporting (Milestone 4)

**Export** opens a modal: MP4 (H.264) · GIF · PNG sequence · SVG · Scene JSON · PNG still, at 720p / 1080p / custom, 24 / 30 / 60 fps, over a chosen range, to a path from the native save dialog.

* **Deterministic**: the exporter creates an off-screen canvas at the export size and calls the *same* `Renderer.render(scene, { t })` the viewport uses, with `t = frame / fps`. No screen capture. `src/engine/__tests__/determinism.test.ts` asserts that rendering the same `t` twice (also after other frames, and on a fresh renderer) yields byte-identical pixels.
* **Streaming**: one frame in flight at a time. MP4 → raw RGBA written to FFmpeg's stdin (back-pressure from the encoder throttles the UI); PNG/GIF → PNG bytes written to disk. Nothing accumulates in RAM.
* **MP4**: `libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -movflags +faststart`, BT.709 tags. **GIF**: two passes, `palettegen=stats_mode=diff` → `paletteuse=dither=bayer`, from temp PNGs that are deleted afterwards.
* **Safe writes**: videos go to `<file>.part` and are renamed after FFmpeg exits 0. Cancel (or closing the app) kills FFmpeg and removes the `.part` file / temp frames / the PNG frames this job wrote.
* **Errors** are mapped to plain language (`disk_full`, `permission`, `ffmpeg_missing`, `no_h264`, `ffmpeg_failed`, `invalid`). If FFmpeg is missing the dialog says how to install it and PNG sequence / SVG / JSON stay available.
* **FFmpeg lookup**: `KINETIX_FFMPEG` → sidecar next to the executable → `ffmpeg` on `PATH`.

## Build & package

Prerequisites: Node 20+, Rust stable (≥ 1.77), and the Tauri v2 system packages for your OS
([prerequisites](https://v2.tauri.app/start/prerequisites/)). On Debian/Ubuntu:
`sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev build-essential pkg-config libssl-dev libayatana-appindicator3-dev librsvg2-dev`.

```bash
npm install
npm run lint && npm test && npx tsc --noEmit        # front-end checks
(cd src-tauri && cargo test && cargo clippy --all-targets)   # Rust checks
npm run tauri dev                                    # run the desktop app

# --- installers, FFmpeg found at runtime (user installs it) ---
npm run tauri:build                                  # Windows: NSIS .exe + MSI   |  Linux: AppImage + deb
npx tauri build --bundles nsis                       # one target only (nsis | msi | appimage | deb)

# --- installers that ship FFmpeg inside the app (sidecar / externalBin) ---
npm run ffmpeg:prepare -- --from "C:\tools\ffmpeg\bin\ffmpeg.exe"   # or omit --from to copy the ffmpeg on PATH
npm run tauri:build:bundled                          # = prepare-ffmpeg + tauri build --config src-tauri/tauri.ffmpeg.conf.json
```

Output: `src-tauri/target/release/bundle/{nsis,msi,appimage,deb}/`. Notes:

* Windows bundles are built **on Windows** (NSIS + MSI need NSIS/WiX there); Linux bundles on Linux. `src-tauri/tauri.windows.conf.json` and `tauri.linux.conf.json` are merged automatically and select `nsis, msi` / `appimage, deb`.
* The sidecar file must be named `src-tauri/binaries/ffmpeg-<target-triple>[.exe]` (`x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, …); `prepare-ffmpeg.mjs` does this and checks the build has `libx264`. Use a **static** FFmpeg build — a distro's dynamically linked `/usr/bin/ffmpeg` will not run on other machines. A libx264 build is GPL: ship the license text and offer the source if you redistribute it.
* Icons live in `src-tauri/icons` (regenerate from `src-tauri/app-icon.png` with `npx tauri icon src-tauri/app-icon.png`).
* **Offline CSP** (`tauri.conf.json`): `connect-src ipc: http://ipc.localhost http://127.0.0.1:11434 http://127.0.0.1:8080` — the WebView can only reach the Tauri IPC and the local Ollama / llama.cpp ports. The Rust side talks to those two ports only.
* Capabilities (`src-tauri/capabilities/default.json`): `core:default`, `dialog:allow-open`, `dialog:allow-save`. Exports are written by Rust commands, so no filesystem plugin is exposed to the WebView.
* Release profile: `opt-level 3`, `lto`, `codegen-units 1`, `panic = "abort"`, `strip`.
* Identifier `studio.kinetix.app`; the version (`0.4.0`) is kept identical in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
