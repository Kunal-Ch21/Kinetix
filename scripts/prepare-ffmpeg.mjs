// Stages an FFmpeg binary as a Tauri sidecar (bundle.externalBin = "binaries/ffmpeg").
// Tauri requires the file to be named  binaries/ffmpeg-<target-triple>[.exe]  at build time and copies it next to the
// installed app as plain `ffmpeg[.exe]`, which is where the Rust exporter looks first.
//
//   node scripts/prepare-ffmpeg.mjs                      # copy the ffmpeg found on PATH
//   node scripts/prepare-ffmpeg.mjs --from C:\tools\ffmpeg\bin\ffmpeg.exe
//   FFMPEG_PATH=/opt/ffmpeg/ffmpeg node scripts/prepare-ffmpeg.mjs
//   node scripts/prepare-ffmpeg.mjs --triple x86_64-pc-windows-msvc --from ./ffmpeg.exe   # cross-staging
//
// Nothing is downloaded: the app stays 100 % offline and you choose the FFmpeg build (and license) you ship.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const m = /^host:\s*(\S+)/m.exec(out);
  if (!m) throw new Error("could not read the host target triple from `rustc -vV`");
  return m[1];
}

function which(cmd) {
  try {
    const out = execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
    return out.split(/\r?\n/).find(Boolean);
  } catch {
    return undefined;
  }
}

const triple = flag("--triple") ?? process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTriple();
const from = flag("--from") ?? process.env.FFMPEG_PATH ?? which("ffmpeg");
if (!from || !existsSync(from)) {
  console.error("FFmpeg not found. Install it, or pass --from <path-to-ffmpeg> (or set FFMPEG_PATH).");
  process.exit(1);
}

const windows = triple.includes("windows");
const dest = resolve(root, "src-tauri/binaries", `ffmpeg-${triple}${windows ? ".exe" : ""}`);
mkdirSync(dirname(dest), { recursive: true });

// Only run the binary for a sanity check when it can execute on this machine.
if (windows === (process.platform === "win32")) {
  const v = execFileSync(from, ["-hide_banner", "-version"], { encoding: "utf8" });
  const enc = execFileSync(from, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  console.log(v.split("\n")[0]);
  if (!enc.includes("libx264")) {
    console.error("This FFmpeg has no libx264 encoder — MP4 export would be unavailable. Use a build with --enable-libx264.");
    process.exit(1);
  }
  if (/--enable-gpl/.test(v)) console.warn("NOTE: this is a GPL build of FFmpeg (libx264). Shipping it means complying with the GPL (offer source, include the license).");
}

copyFileSync(from, dest);
if (!windows) chmodSync(dest, 0o755);
console.log(`sidecar staged: ${dest} (${(statSync(dest).size / 1048576).toFixed(1)} MB)`);
console.log("now run:  npm run tauri:build:bundled");
