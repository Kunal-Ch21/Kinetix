//! Milestone 4 — native frame-by-frame exporter.
//!
//! The WebView renders every frame with the SAME `Renderer` the viewport uses (t = frame / fps) and streams it here:
//!   * MP4 (H.264): raw RGBA frames are piped into `ffmpeg` stdin — frames are never accumulated in RAM.
//!   * GIF: PNG frames go to a temp folder, then two ffmpeg passes (`palettegen` → `paletteuse`) build an optimised GIF.
//!   * PNG sequence: PNG frames are written straight into the chosen folder as `frame_0000.png`, `frame_0001.png` …
//!
//! Lifecycle commands: `export_start` → `export_write_frame` × N → `export_finish`, with `export_progress` polled by the
//! UI and `export_cancel` which kills ffmpeg and removes every temp / partial file. Output is written to `<file>.part`
//! and renamed only after ffmpeg exits cleanly, so a failed export never leaves a half-written video behind.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{
    ipc::{InvokeBody, Request},
    State,
};

/* ------------------------------------------------------------------ errors */

/// Structured error so the UI can branch on `code` (e.g. show the "FFmpeg missing" modal).
#[derive(Debug, Clone, Serialize)]
pub struct ExportError {
    pub code: String,
    pub message: String,
}

impl ExportError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

pub type Res<T> = Result<T, ExportError>;

/// ENOSPC (28 on Linux/macOS), ERROR_DISK_FULL (112) and ERROR_HANDLE_DISK_FULL (39) on Windows.
pub fn is_disk_full(e: &io::Error) -> bool {
    matches!(e.raw_os_error(), Some(28) | Some(112) | Some(39))
}

/// Maps an I/O error to a message a person can act on.
pub fn io_error(e: &io::Error, action: &str, path: &Path) -> ExportError {
    let p = path.display();
    if is_disk_full(e) {
        ExportError::new("disk_full", format!("Disk full while {action} `{p}`. Free some space or pick another drive, then export again."))
    } else if e.kind() == io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(13) | Some(5) | Some(30)) {
        ExportError::new("permission", format!("Permission denied while {action} `{p}`. Choose a folder you are allowed to write to (not a system or read-only location)."))
    } else if e.kind() == io::ErrorKind::NotFound {
        ExportError::new("io", format!("The folder for `{p}` does not exist ({action})."))
    } else {
        ExportError::new("io", format!("Could not {action} `{p}`: {e}"))
    }
}

/// Turns the tail of ffmpeg's stderr into a clear error.
pub fn ffmpeg_failure(tail: &str, status: Option<i32>) -> ExportError {
    let low = tail.to_lowercase();
    if low.contains("no space left") || low.contains("disk full") {
        return ExportError::new("disk_full", "Disk full while FFmpeg was writing the video. Free some space or pick another drive, then export again.");
    }
    if low.contains("permission denied") || low.contains("access is denied") {
        return ExportError::new("permission", "Permission denied while FFmpeg was writing the video. Choose a folder you are allowed to write to.");
    }
    let lines: Vec<&str> = tail.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let last = lines[lines.len().saturating_sub(4)..].join(" | ");
    let code = status.map(|c| format!(" (exit code {c})")).unwrap_or_default();
    ExportError::new("ffmpeg_failed", format!("FFmpeg stopped{code}: {}", if last.is_empty() { "no output".to_string() } else { last }))
}

/* ------------------------------------------------------------------ frame plan & naming */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    /// Index of the first frame (t = first / fps).
    pub first: u32,
    pub count: u32,
    /// Zero-padding width used in file names.
    pub pad: usize,
    pub fps: u32,
}

/// Frames cover `[start, end)` seconds: frame `i` is rendered at `t = i / fps`. The end is exclusive, so a 10 s project at
/// 60 fps is exactly 600 frames (the frame at t = 10 s would duplicate t = 0 in a loop).
pub fn plan_frames(start: f64, end: f64, fps: u32, duration: f64) -> Res<Plan> {
    if !(1..=120).contains(&fps) {
        return Err(ExportError::new("invalid", format!("Unsupported frame rate {fps} (use 1–120).")));
    }
    if !(start.is_finite() && end.is_finite() && duration.is_finite()) || duration <= 0.0 {
        return Err(ExportError::new("invalid", "The time range is not a valid number."));
    }
    let start = start.max(0.0);
    let end = end.min(duration);
    let first = (start * fps as f64).round() as u32;
    let end_excl = (end * fps as f64).round() as u32;
    if end_excl <= first {
        return Err(ExportError::new("invalid", "The export range is empty — the end must be later than the start."));
    }
    let count = end_excl - first;
    Ok(Plan { first, count, pad: pad_width(first + count - 1), fps })
}

/// File names are at least 4 digits wide (`frame_0000.png`) and grow when the sequence needs it (`frame_12000.png`).
pub fn pad_width(last_index: u32) -> usize {
    last_index.to_string().len().max(4)
}

pub fn frame_name(prefix: &str, index: u32, pad: usize) -> String {
    format!("{prefix}_{index:0pad$}.png")
}

/// Time (seconds) the front-end renders frame `index` at (mirrored by `frameTime` in src/export/plan.ts).
#[allow(dead_code)]
pub fn frame_time(index: u32, fps: u32) -> f64 {
    index as f64 / fps as f64
}

/// Keeps only file-name-safe characters.
pub fn sanitize_prefix(p: Option<&str>) -> String {
    let s: String = p.unwrap_or("").chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(40).collect();
    if s.trim_matches('_').is_empty() {
        "frame".into()
    } else {
        s
    }
}

/* ------------------------------------------------------------------ ffmpeg arguments */

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Mp4,
    Gif,
    Png,
}

#[derive(Debug, Clone)]
pub struct Spec {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub crf: u8,
    pub preset: String,
    pub loop_gif: bool,
}

pub const PRESETS: [&str; 7] = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"];

pub fn clean_preset(p: Option<&str>) -> String {
    match p {
        Some(x) if PRESETS.contains(&x) => x.to_string(),
        _ => "veryfast".to_string(),
    }
}

fn s(x: impl ToString) -> String {
    x.to_string()
}

fn path_arg(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn base_args() -> Vec<String> {
    ["-y", "-hide_banner", "-loglevel", "error", "-nostats"].iter().map(s).collect()
}

/// MP4 / H.264: raw RGBA on stdin → yuv420p, BT.709, `+faststart`, CRF rate control.
pub fn mp4_args(spec: &Spec, out: &Path) -> Vec<String> {
    let mut a = base_args();
    a.extend(["-f", "rawvideo", "-pix_fmt", "rgba"].iter().map(s));
    a.extend([s("-s"), format!("{}x{}", spec.width, spec.height), s("-framerate"), s(spec.fps), s("-i"), s("pipe:0"), s("-an")]);
    a.extend([s("-vf"), s("scale=out_color_matrix=bt709:out_range=tv,format=yuv420p")]);
    a.extend([s("-c:v"), s("libx264"), s("-preset"), spec.preset.clone(), s("-crf"), s(spec.crf.min(51))]);
    a.extend([s("-pix_fmt"), s("yuv420p"), s("-profile:v"), s("high")]);
    a.extend([s("-colorspace"), s("bt709"), s("-color_primaries"), s("bt709"), s("-color_trc"), s("bt709")]);
    a.extend([s("-r"), s(spec.fps), s("-movflags"), s("+faststart"), s("-f"), s("mp4"), path_arg(out)]);
    a
}

/// `<dir>/frame_%04d.png`-style image2 pattern for a plan.
pub fn seq_pattern(dir: &Path, prefix: &str, pad: usize) -> String {
    path_arg(&dir.join(format!("{prefix}_%0{pad}d.png")))
}

/// GIF pass 1: build an optimised 256-colour palette from the whole sequence (only statistics are kept in memory).
pub fn gif_palette_args(pattern: &str, plan: &Plan, palette: &Path) -> Vec<String> {
    let mut a = base_args();
    a.extend([s("-framerate"), s(plan.fps), s("-start_number"), s(plan.first), s("-i"), s(pattern)]);
    a.extend([s("-vf"), s("palettegen=stats_mode=diff:max_colors=256"), s("-frames:v"), s(1), s("-update"), s(1), path_arg(palette)]);
    a
}

/// GIF pass 2: map every frame through the palette (Bayer dithering, rectangle diffing keeps files small).
pub fn gif_encode_args(pattern: &str, plan: &Plan, palette: &Path, out: &Path, loop_forever: bool) -> Vec<String> {
    let mut a = base_args();
    a.extend([s("-framerate"), s(plan.fps), s("-start_number"), s(plan.first), s("-i"), s(pattern)]);
    a.extend([s("-i"), path_arg(palette)]);
    a.extend([s("-lavfi"), s("paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle")]);
    a.extend([s("-loop"), s(if loop_forever { 0 } else { -1 }), s("-f"), s("gif"), path_arg(out)]);
    a
}

/* ------------------------------------------------------------------ ffmpeg discovery */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// "env" (KINETIX_FFMPEG) | "sidecar" (bundled next to the app) | "system" (PATH)
    pub source: Option<String>,
    /// libx264 is compiled in (required for MP4).
    pub h264: bool,
    pub message: Option<String>,
}

fn exe_name() -> String {
    format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)
}

/// Search order: `KINETIX_FFMPEG`, the Tauri sidecar next to the app executable (the bundler strips the
/// `-<target-triple>` suffix when it copies an `externalBin`), then `ffmpeg` on PATH.
pub fn ffmpeg_candidates(exe_dir: Option<&Path>, env_override: Option<String>) -> Vec<(PathBuf, &'static str)> {
    let mut v = vec![];
    if let Some(e) = env_override.filter(|e| !e.trim().is_empty()) {
        v.push((PathBuf::from(e), "env"));
    }
    if let Some(d) = exe_dir {
        v.push((d.join(exe_name()), "sidecar"));
    }
    v.push((PathBuf::from("ffmpeg"), "system"));
    v
}

fn quiet(path: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

fn run_text(path: &Path, args: &[&str]) -> Option<String> {
    let out = quiet(path).args(args).stdin(Stdio::null()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn probe_ffmpeg_at(path: &Path) -> Option<(String, bool)> {
    let text = run_text(path, &["-version"])?;
    let first = text.lines().next()?.trim().to_string();
    if !first.to_lowercase().contains("ffmpeg") {
        return None;
    }
    let h264 = run_text(path, &["-hide_banner", "-encoders"]).map(|e| e.contains("libx264")).unwrap_or(false);
    Some((first, h264))
}

pub fn find_ffmpeg() -> FfmpegInfo {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
    for (path, source) in ffmpeg_candidates(exe_dir.as_deref(), std::env::var("KINETIX_FFMPEG").ok()) {
        if let Some((version, h264)) = probe_ffmpeg_at(&path) {
            return FfmpegInfo {
                found: true,
                path: Some(path_arg(&path)),
                version: Some(version),
                source: Some(source.into()),
                h264,
                message: if h264 { None } else { Some("This FFmpeg build has no libx264 encoder, so MP4 export is unavailable. GIF and PNG sequence still work.".into()) },
            };
        }
    }
    FfmpegInfo {
        found: false,
        path: None,
        version: None,
        source: None,
        h264: false,
        message: Some("FFmpeg was not found. Install it (https://ffmpeg.org/download.html) and make sure `ffmpeg` is on your PATH, or set KINETIX_FFMPEG to its full path. PNG sequence, SVG and JSON export work without it.".into()),
    }
}

/* ------------------------------------------------------------------ job state */

#[derive(Debug, Clone, PartialEq, Eq)]
enum Stage {
    Running,
    Encoding(String),
    Done,
    Cancelled,
    Failed(String),
}

struct Inner {
    stage: Stage,
    frames_done: u32,
    bytes: u64,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stderr_thread: Option<JoinHandle<()>>,
}

struct Job {
    format: Format,
    spec: Spec,
    plan: Plan,
    prefix: String,
    out: PathBuf,
    part: PathBuf,
    frames_dir: PathBuf,
    created_dir: bool,
    ffmpeg: Option<PathBuf>,
    started: Instant,
    cancelled: AtomicBool,
    stderr_tail: Arc<Mutex<String>>,
    inner: Mutex<Inner>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    pub format: Format,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    /// MP4 / GIF: the output file. PNG sequence: the output folder.
    pub out_path: String,
    pub crf: Option<u8>,
    pub preset: Option<String>,
    pub prefix: Option<String>,
    pub loop_gif: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInfo {
    pub job_id: String,
    pub plan: Plan,
    pub ffmpeg: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// running | encoding | done | cancelled | failed
    pub state: String,
    pub stage: String,
    pub frames_done: u32,
    pub total: u32,
    pub bytes_written: u64,
    pub elapsed_ms: u64,
    pub eta_ms: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishResult {
    pub path: String,
    pub bytes: u64,
    pub frames: u32,
    pub elapsed_ms: u64,
}

const TAIL_CAP: usize = 6000;

fn spawn_stderr_reader(mut stderr: ChildStderr, tail: Arc<Mutex<String>>) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 2048];
        loop {
            match stderr.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Ok(mut t) = tail.lock() {
                        t.push_str(&String::from_utf8_lossy(&buf[..n]));
                        if t.len() > TAIL_CAP {
                            let mut cut = t.len() - TAIL_CAP;
                            while !t.is_char_boundary(cut) {
                                cut += 1;
                            }
                            t.drain(..cut);
                        }
                    }
                }
            }
        }
    })
}

fn poisoned() -> ExportError {
    ExportError::new("io", "export state is poisoned")
}

fn cancelled() -> ExportError {
    ExportError::new("cancelled", "Export cancelled.")
}

pub struct ExportManager {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    seq: AtomicU64,
}

impl Default for ExportManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ExportManager {
    pub fn new() -> Self {
        Self { jobs: Mutex::new(HashMap::new()), seq: AtomicU64::new(1) }
    }

    fn job(&self, id: &str) -> Res<Arc<Job>> {
        self.jobs.lock().map_err(|_| poisoned())?.get(id).cloned().ok_or_else(|| ExportError::new("unknown_job", format!("No export job `{id}`.")))
    }

    fn is_active(job: &Job) -> bool {
        job.inner.lock().map(|i| matches!(i.stage, Stage::Running | Stage::Encoding(_))).unwrap_or(false)
    }

    /// Validates, prepares the destination (folder / `.part` file / temp dir) and spawns ffmpeg for MP4.
    /// `ffmpeg` is the resolved binary (None when it was not found).
    pub fn start(&self, a: StartArgs, ffmpeg: Option<PathBuf>) -> Res<StartInfo> {
        {
            let mut jobs = self.jobs.lock().map_err(|_| poisoned())?;
            if jobs.values().any(|j| Self::is_active(j)) {
                return Err(ExportError::new("busy", "Another export is still running. Wait for it to finish or cancel it first."));
            }
            jobs.retain(|_, j| Self::is_active(j)); // forget finished jobs
        }
        let plan = plan_frames(a.start, a.end, a.fps, a.duration)?;
        if !(16..=7680).contains(&a.width) || !(16..=4320).contains(&a.height) {
            return Err(ExportError::new("invalid", format!("Resolution {}×{} is out of range (16–7680 × 16–4320).", a.width, a.height)));
        }
        if a.format == Format::Mp4 && (a.width % 2 != 0 || a.height % 2 != 0) {
            return Err(ExportError::new("invalid", format!("H.264 (yuv420p) needs even dimensions; {}×{} is odd.", a.width, a.height)));
        }
        if a.out_path.trim().is_empty() {
            return Err(ExportError::new("invalid", "Choose where to save the export first."));
        }
        let spec = Spec { width: a.width, height: a.height, fps: a.fps, crf: a.crf.unwrap_or(18).min(51), preset: clean_preset(a.preset.as_deref()), loop_gif: a.loop_gif.unwrap_or(true) };
        let id = format!("job_{}", self.seq.fetch_add(1, Ordering::SeqCst));
        let out = PathBuf::from(&a.out_path);
        let missing = || ExportError::new("ffmpeg_missing", "FFmpeg was not found. MP4 and GIF export need it — install FFmpeg or use PNG sequence / SVG / JSON.");
        if a.format != Format::Png && ffmpeg.is_none() {
            return Err(missing());
        }

        let (part, frames_dir, created_dir, prefix) = match a.format {
            Format::Png => {
                let existed = out.is_dir();
                fs::create_dir_all(&out).map_err(|e| io_error(&e, "creating the folder", &out))?;
                let probe = out.join(".kinetix-write-test");
                if let Err(e) = fs::write(&probe, b"ok") {
                    if !existed {
                        let _ = fs::remove_dir(&out);
                    }
                    return Err(io_error(&e, "writing to", &out));
                }
                let _ = fs::remove_file(&probe);
                (out.clone(), out.clone(), !existed, sanitize_prefix(a.prefix.as_deref()))
            }
            Format::Mp4 | Format::Gif => {
                let parent = out.parent().filter(|p| !p.as_os_str().is_empty()).map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
                if !parent.is_dir() {
                    return Err(ExportError::new("io", format!("The folder `{}` does not exist.", parent.display())));
                }
                let mut part_os = out.clone().into_os_string();
                part_os.push(".part");
                let part = PathBuf::from(part_os);
                fs::File::create(&part).map_err(|e| io_error(&e, "creating", &part))?;
                if a.format == Format::Gif {
                    let d = std::env::temp_dir().join(format!("kinetix-export-{}-{}", std::process::id(), id));
                    if let Err(e) = fs::create_dir_all(&d) {
                        let _ = fs::remove_file(&part);
                        return Err(io_error(&e, "creating the temp folder", &d));
                    }
                    (part, d, true, "frame".to_string())
                } else {
                    (part, parent, false, "frame".to_string())
                }
            }
        };

        let job = Arc::new(Job {
            format: a.format.clone(),
            spec,
            plan,
            prefix,
            out,
            part,
            frames_dir,
            created_dir,
            ffmpeg: if a.format == Format::Png { None } else { ffmpeg },
            started: Instant::now(),
            cancelled: AtomicBool::new(false),
            stderr_tail: Arc::new(Mutex::new(String::new())),
            inner: Mutex::new(Inner { stage: Stage::Running, frames_done: 0, bytes: 0, child: None, stdin: None, stderr_thread: None }),
        });

        if job.format == Format::Mp4 {
            let args = mp4_args(&job.spec, &job.part);
            let ff = job.ffmpeg.as_ref().ok_or_else(missing)?;
            let mut child = match quiet(ff).args(&args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn() {
                Ok(c) => c,
                Err(e) => {
                    let _ = fs::remove_file(&job.part);
                    return Err(if e.kind() == io::ErrorKind::NotFound { missing() } else { io_error(&e, "starting FFmpeg for", &job.out) });
                }
            };
            let mut inner = job.inner.lock().map_err(|_| poisoned())?;
            inner.stdin = child.stdin.take();
            if let Some(err) = child.stderr.take() {
                inner.stderr_thread = Some(spawn_stderr_reader(err, job.stderr_tail.clone()));
            }
            inner.child = Some(child);
        }

        let info = StartInfo { job_id: id.clone(), plan, ffmpeg: job.ffmpeg.as_ref().map(|p| path_arg(p)) };
        self.jobs.lock().map_err(|_| poisoned())?.insert(id, job);
        Ok(info)
    }

    /// Receives frame `index`: PNG bytes (PNG / GIF) or raw RGBA (MP4). Frames must arrive in order.
    pub fn write_frame(&self, id: &str, index: u32, data: &[u8]) -> Res<()> {
        let job = self.job(id)?;
        if job.cancelled.load(Ordering::SeqCst) {
            return Err(cancelled());
        }
        let (expected, stdin) = {
            let mut inner = job.inner.lock().map_err(|_| poisoned())?;
            if inner.stage != Stage::Running {
                return Err(ExportError::new("invalid", "This export is no longer accepting frames."));
            }
            (job.plan.first + inner.frames_done, if job.format == Format::Mp4 { inner.stdin.take() } else { None })
        };
        if index != expected {
            let e = ExportError::new("invalid", format!("Frame {index} arrived out of order (expected {expected})."));
            if let Some(si) = stdin {
                job.inner.lock().map_err(|_| poisoned())?.stdin = Some(si);
            }
            return Err(self.fail(&job, e));
        }

        let wrote: Res<u64> = match job.format {
            Format::Mp4 => {
                let want = job.spec.width as usize * job.spec.height as usize * 4;
                if data.len() != want {
                    Err(ExportError::new("invalid", format!("Frame {index} is {} bytes; {}×{} RGBA needs {want}.", data.len(), job.spec.width, job.spec.height)))
                } else if let Some(mut stdin) = stdin {
                    // Blocking write = back-pressure: the UI cannot outrun the encoder, so frames never pile up in RAM.
                    match stdin.write_all(data).and_then(|_| stdin.flush()) {
                        Ok(()) => {
                            job.inner.lock().map_err(|_| poisoned())?.stdin = Some(stdin);
                            Ok(data.len() as u64)
                        }
                        Err(e) => {
                            // Usually a broken pipe because ffmpeg died; its stderr says why.
                            std::thread::sleep(Duration::from_millis(60));
                            let tail = job.stderr_tail.lock().map(|t| t.clone()).unwrap_or_default();
                            Err(if tail.trim().is_empty() { io_error(&e, "streaming frames to FFmpeg for", &job.out) } else { ffmpeg_failure(&tail, None) })
                        }
                    }
                } else {
                    Err(ExportError::new("invalid", "The video encoder is not running."))
                }
            }
            Format::Png | Format::Gif => {
                if data.len() < 8 || data[..8] != [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a] {
                    Err(ExportError::new("invalid", format!("Frame {index} is not a PNG image.")))
                } else {
                    let path = job.frames_dir.join(frame_name(&job.prefix, index, job.plan.pad));
                    fs::write(&path, data).map(|_| data.len() as u64).map_err(|e| io_error(&e, "writing", &path))
                }
            }
        };

        match wrote {
            Ok(n) => {
                let mut inner = job.inner.lock().map_err(|_| poisoned())?;
                inner.frames_done += 1;
                inner.bytes += n;
                Ok(())
            }
            Err(e) => Err(self.fail(&job, e)),
        }
    }

    pub fn progress(&self, id: &str) -> Res<Progress> {
        let job = self.job(id)?;
        Ok(Self::snapshot(&job))
    }

    fn snapshot(job: &Job) -> Progress {
        let inner = job.inner.lock().unwrap_or_else(|p| p.into_inner());
        let elapsed = job.started.elapsed().as_millis() as u64;
        let (state, stage, message) = match &inner.stage {
            Stage::Running => ("running", "Rendering frames".to_string(), None),
            Stage::Encoding(s) => ("encoding", s.clone(), None),
            Stage::Done => ("done", "Done".to_string(), None),
            Stage::Cancelled => ("cancelled", "Cancelled".to_string(), None),
            Stage::Failed(m) => ("failed", "Failed".to_string(), Some(m.clone())),
        };
        // MB written: for video, what ffmpeg has put on disk so far; for PNG frames, what we wrote.
        let bytes = match job.format {
            Format::Png => inner.bytes,
            Format::Mp4 => fs::metadata(&job.part).or_else(|_| fs::metadata(&job.out)).map(|m| m.len()).unwrap_or(inner.bytes),
            Format::Gif => {
                if state == "running" {
                    inner.bytes
                } else {
                    fs::metadata(&job.part).or_else(|_| fs::metadata(&job.out)).map(|m| m.len()).unwrap_or(inner.bytes)
                }
            }
        };
        let eta = if state == "running" && inner.frames_done > 0 {
            let per = elapsed as f64 / inner.frames_done as f64;
            Some((per * (job.plan.count - inner.frames_done.min(job.plan.count)) as f64).round() as u64)
        } else {
            None
        };
        Progress { state: state.into(), stage, frames_done: inner.frames_done, total: job.plan.count, bytes_written: bytes, elapsed_ms: elapsed, eta_ms: eta, message }
    }

    /// Kills ffmpeg (if any) and removes every partial / temp file this job created. Idempotent.
    pub fn cancel(&self, id: &str) -> Res<Progress> {
        let job = self.job(id)?;
        {
            let mut inner = job.inner.lock().map_err(|_| poisoned())?;
            if inner.stage == Stage::Done {
                drop(inner);
                return Ok(Self::snapshot(&job));
            }
            job.cancelled.store(true, Ordering::SeqCst);
            inner.stdin = None;
            Self::kill(&mut inner);
            inner.stage = Stage::Cancelled;
        }
        Self::cleanup(&job);
        Ok(Self::snapshot(&job))
    }

    pub fn cancel_all(&self) {
        let ids: Vec<String> = self.jobs.lock().map(|j| j.keys().cloned().collect()).unwrap_or_default();
        for id in ids {
            if self.job(&id).map(|j| Self::is_active(&j)).unwrap_or(false) {
                let _ = self.cancel(&id);
            }
        }
    }

    fn kill(inner: &mut Inner) {
        if let Some(mut c) = inner.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        if let Some(t) = inner.stderr_thread.take() {
            let _ = t.join();
        }
    }

    fn cleanup(job: &Job) {
        match job.format {
            Format::Mp4 => {
                let _ = fs::remove_file(&job.part);
            }
            Format::Gif => {
                let _ = fs::remove_file(&job.part);
                let _ = fs::remove_dir_all(&job.frames_dir);
            }
            Format::Png => {
                let done = job.inner.lock().map(|i| i.frames_done).unwrap_or(0);
                for i in 0..=done {
                    let _ = fs::remove_file(job.frames_dir.join(frame_name(&job.prefix, job.plan.first + i, job.plan.pad)));
                }
                if job.created_dir {
                    let _ = fs::remove_dir(&job.frames_dir); // only succeeds when empty
                }
            }
        }
    }

    /// Marks the job failed, cleans up, and returns `err` (or "cancelled" if the user cancelled meanwhile).
    fn fail(&self, job: &Arc<Job>, err: ExportError) -> ExportError {
        if job.cancelled.load(Ordering::SeqCst) {
            return cancelled();
        }
        {
            let mut inner = job.inner.lock().unwrap_or_else(|p| p.into_inner());
            inner.stdin = None;
            Self::kill(&mut inner);
            inner.stage = Stage::Failed(err.message.clone());
        }
        Self::cleanup(job);
        err
    }

    fn set_stage(job: &Job, st: Stage) {
        job.inner.lock().unwrap_or_else(|p| p.into_inner()).stage = st;
    }

    /// Polls the child so a cancel (which takes the child out of `inner`) is noticed within ~25 ms.
    fn wait_child(job: &Job) -> Res<ExitStatus> {
        loop {
            if job.cancelled.load(Ordering::SeqCst) {
                return Err(cancelled());
            }
            let mut finished: Option<(ExitStatus, Option<JoinHandle<()>>)> = None;
            {
                let mut inner = job.inner.lock().map_err(|_| poisoned())?;
                match inner.child.as_mut() {
                    None => return Err(cancelled()),
                    Some(c) => match c.try_wait() {
                        Ok(Some(st)) => {
                            inner.child = None;
                            finished = Some((st, inner.stderr_thread.take()));
                        }
                        Ok(None) => {}
                        Err(e) => return Err(io_error(&e, "waiting for FFmpeg while writing", &job.out)),
                    },
                }
            }
            if let Some((st, thread)) = finished {
                if let Some(t) = thread {
                    let _ = t.join(); // pipe closed → the tail is complete
                }
                return Ok(st);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn run_ffmpeg_pass(job: &Job, args: &[String]) -> Res<()> {
        let ff = job.ffmpeg.as_ref().ok_or_else(|| ExportError::new("ffmpeg_missing", "FFmpeg is not available."))?;
        if let Ok(mut t) = job.stderr_tail.lock() {
            t.clear();
        }
        let mut child = quiet(ff).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| io_error(&e, "starting FFmpeg for", &job.out))?;
        {
            let mut inner = job.inner.lock().map_err(|_| poisoned())?;
            if let Some(err) = child.stderr.take() {
                inner.stderr_thread = Some(spawn_stderr_reader(err, job.stderr_tail.clone()));
            }
            inner.child = Some(child);
        }
        let st = Self::wait_child(job)?;
        if st.success() {
            Ok(())
        } else {
            let tail = job.stderr_tail.lock().map(|t| t.clone()).unwrap_or_default();
            Err(ffmpeg_failure(&tail, st.code()))
        }
    }

    /// Closes the encoder, waits for it, and atomically renames `<file>.part` to the final file.
    pub fn finish(&self, id: &str) -> Res<FinishResult> {
        let job = self.job(id)?;
        if job.cancelled.load(Ordering::SeqCst) {
            return Err(cancelled());
        }
        let done = job.inner.lock().map_err(|_| poisoned())?.frames_done;
        if done != job.plan.count {
            return Err(self.fail(&job, ExportError::new("invalid", format!("Only {done} of {} frames were delivered.", job.plan.count))));
        }
        let outcome: Res<u64> = (|| match job.format {
            Format::Png => Ok(job.inner.lock().map_err(|_| poisoned())?.bytes),
            Format::Mp4 => {
                Self::set_stage(&job, Stage::Encoding("Finalising MP4".into()));
                let stdin = job.inner.lock().map_err(|_| poisoned())?.stdin.take();
                drop(stdin); // EOF → ffmpeg flushes the encoder and writes the moov atom
                let st = Self::wait_child(&job)?;
                if !st.success() {
                    let tail = job.stderr_tail.lock().map(|t| t.clone()).unwrap_or_default();
                    return Err(ffmpeg_failure(&tail, st.code()));
                }
                fs::rename(&job.part, &job.out).map_err(|e| io_error(&e, "saving", &job.out))?;
                fs::metadata(&job.out).map(|m| m.len()).map_err(|e| io_error(&e, "reading", &job.out))
            }
            Format::Gif => {
                let pattern = seq_pattern(&job.frames_dir, &job.prefix, job.plan.pad);
                let palette = job.frames_dir.join("palette.png");
                Self::set_stage(&job, Stage::Encoding("Building optimised palette".into()));
                Self::run_ffmpeg_pass(&job, &gif_palette_args(&pattern, &job.plan, &palette))?;
                Self::set_stage(&job, Stage::Encoding("Encoding GIF".into()));
                Self::run_ffmpeg_pass(&job, &gif_encode_args(&pattern, &job.plan, &palette, &job.part, job.spec.loop_gif))?;
                let _ = fs::remove_dir_all(&job.frames_dir);
                fs::rename(&job.part, &job.out).map_err(|e| io_error(&e, "saving", &job.out))?;
                fs::metadata(&job.out).map(|m| m.len()).map_err(|e| io_error(&e, "reading", &job.out))
            }
        })();
        match outcome {
            Ok(bytes) => {
                Self::set_stage(&job, Stage::Done);
                Ok(FinishResult { path: path_arg(&job.out), bytes, frames: job.plan.count, elapsed_ms: job.started.elapsed().as_millis() as u64 })
            }
            Err(e) => Err(self.fail(&job, e)),
        }
    }
}

/// Removes temp folders left behind by a crashed export (older than a day).
pub fn purge_stale_temp() {
    let Ok(rd) = fs::read_dir(std::env::temp_dir()) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.starts_with("kinetix-export-") {
            continue;
        }
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|d| d > Duration::from_secs(86_400)).unwrap_or(false);
        if old {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

/* ------------------------------------------------------------------ Tauri commands */

#[tauri::command(async)]
pub fn export_probe_ffmpeg() -> FfmpegInfo {
    find_ffmpeg()
}

#[tauri::command(async)]
pub fn export_start(mgr: State<'_, ExportManager>, args: StartArgs) -> Res<StartInfo> {
    let ff = if args.format == Format::Png {
        None
    } else {
        let info = find_ffmpeg();
        if args.format == Format::Mp4 && info.found && !info.h264 {
            return Err(ExportError::new("no_h264", info.message.unwrap_or_else(|| "This FFmpeg build has no libx264 encoder.".into())));
        }
        info.path.map(PathBuf::from)
    };
    mgr.start(args, ff)
}

/// Body = raw bytes (PNG for PNG/GIF, RGBA for MP4). Headers: `x-job`, `x-frame`.
#[tauri::command]
pub async fn export_write_frame(request: Request<'_>, mgr: State<'_, ExportManager>) -> Res<()> {
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let job = header("x-job").ok_or_else(|| ExportError::new("invalid", "missing x-job header"))?;
    let index: u32 = header("x-frame").and_then(|v| v.parse().ok()).ok_or_else(|| ExportError::new("invalid", "missing or bad x-frame header"))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(ExportError::new("invalid", "frame payload must be raw bytes"));
    };
    mgr.write_frame(&job, index, bytes)
}

#[tauri::command(async)]
pub fn export_progress(mgr: State<'_, ExportManager>, job_id: String) -> Res<Progress> {
    mgr.progress(&job_id)
}

#[tauri::command(async)]
pub fn export_cancel(mgr: State<'_, ExportManager>, job_id: String) -> Res<Progress> {
    mgr.cancel(&job_id)
}

#[tauri::command(async)]
pub fn export_finish(mgr: State<'_, ExportManager>, job_id: String) -> Res<FinishResult> {
    mgr.finish(&job_id)
}

/// Writes `bytes` to `<path>.part` and renames it into place, so a failed write never leaves a truncated file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Res<u64> {
    let mut part = path.to_path_buf().into_os_string();
    part.push(".part");
    let part = PathBuf::from(part);
    let write = || -> io::Result<()> {
        let mut f = fs::File::create(&part)?;
        f.write_all(bytes)?;
        f.flush()?;
        fs::rename(&part, path)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&part);
        io_error(&e, "writing", path)
    })?;
    Ok(bytes.len() as u64)
}

/// SVG / JSON scene export (text written to the path chosen in the native save dialog).
#[tauri::command(async)]
pub fn export_write_text(path: String, content: String) -> Res<u64> {
    write_atomic(Path::new(&path), content.as_bytes())
}

/// Single PNG still (base64 payload, a few MB at most).
#[tauri::command(async)]
pub fn export_write_base64(path: String, data: String) -> Res<u64> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|e| ExportError::new("invalid", format!("bad image payload: {e}")))?;
    write_atomic(Path::new(&path), &bytes)
}

/* ------------------------------------------------------------------ tests */

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> Spec {
        Spec { width: 1920, height: 1080, fps: 60, crf: 18, preset: "veryfast".into(), loop_gif: true }
    }

    fn pos(a: &[String], needle: &str) -> usize {
        a.iter().position(|x| x == needle).unwrap_or_else(|| panic!("`{needle}` missing from {a:?}"))
    }

    fn value_after<'a>(a: &'a [String], flag: &str) -> &'a str {
        &a[pos(a, flag) + 1]
    }

    /* ---- frame range & naming ---- */

    #[test]
    fn full_project_is_end_exclusive_at_every_fps() {
        for (fps, frames) in [(24u32, 240u32), (30, 300), (60, 600)] {
            let p = plan_frames(0.0, 10.0, fps, 10.0).unwrap();
            assert_eq!((p.first, p.count, p.fps), (0, frames, fps));
            assert_eq!(p.pad, 4);
        }
    }

    #[test]
    fn sub_range_keeps_absolute_frame_numbers_and_clamps_to_duration() {
        let p = plan_frames(2.5, 4.0, 30, 10.0).unwrap();
        assert_eq!((p.first, p.count), (75, 45));
        // last frame index is 119 → t = 119/30 = 3.9667 s, strictly before the 4.0 s end
        assert!(frame_time(p.first + p.count - 1, 30) < 4.0);
        assert_eq!(frame_time(p.first, 30), 2.5);
        // end beyond the duration is clamped; negative start is clamped to 0
        let p = plan_frames(-3.0, 99.0, 24, 10.0).unwrap();
        assert_eq!((p.first, p.count), (0, 240));
    }

    #[test]
    fn empty_or_invalid_ranges_are_rejected() {
        assert_eq!(plan_frames(3.0, 3.0, 30, 10.0).unwrap_err().code, "invalid");
        assert_eq!(plan_frames(5.0, 4.0, 30, 10.0).unwrap_err().code, "invalid");
        assert_eq!(plan_frames(12.0, 20.0, 30, 10.0).unwrap_err().code, "invalid");
        assert_eq!(plan_frames(0.0, 1.0, 0, 10.0).unwrap_err().code, "invalid");
        assert_eq!(plan_frames(0.0, 1.0, 500, 10.0).unwrap_err().code, "invalid");
        assert_eq!(plan_frames(f64::NAN, 1.0, 30, 10.0).unwrap_err().code, "invalid");
    }

    #[test]
    fn frame_names_are_zero_padded_and_grow_with_the_sequence() {
        assert_eq!(frame_name("frame", 0, 4), "frame_0000.png");
        assert_eq!(frame_name("frame", 7, 4), "frame_0007.png");
        assert_eq!(frame_name("shot", 119, 4), "shot_0119.png");
        assert_eq!(pad_width(9999), 4);
        assert_eq!(pad_width(10_000), 5);
        // 200 s at 60 fps = 12 000 frames → 5 digits, so lexical order == numeric order
        let p = plan_frames(0.0, 200.0, 60, 200.0).unwrap();
        assert_eq!((p.count, p.pad), (12_000, 5));
        assert_eq!(frame_name("frame", p.first + p.count - 1, p.pad), "frame_11999.png");
        let mut names: Vec<String> = [0u32, 9, 10, 100, 11_999].iter().map(|i| frame_name("f", *i, 5)).collect();
        let sorted = names.clone();
        names.sort();
        assert_eq!(names, sorted);
    }

    #[test]
    fn prefix_is_sanitised() {
        assert_eq!(sanitize_prefix(None), "frame");
        assert_eq!(sanitize_prefix(Some("")), "frame");
        assert_eq!(sanitize_prefix(Some("my shot/../x")), "my_shot____x");
        assert_eq!(sanitize_prefix(Some("Apex-Morph_01")), "Apex-Morph_01");
        assert_eq!(sanitize_prefix(Some("///")), "frame");
    }

    /* ---- ffmpeg argument builder ---- */

    #[test]
    fn mp4_args_are_h264_yuv420p_faststart_crf_veryfast() {
        let a = mp4_args(&spec(), Path::new("/tmp/out.mp4.part"));
        assert_eq!(value_after(&a, "-c:v"), "libx264");
        assert_eq!(value_after(&a, "-preset"), "veryfast");
        assert_eq!(value_after(&a, "-crf"), "18");
        assert_eq!(value_after(&a, "-pix_fmt"), "rgba", "first -pix_fmt describes the raw input");
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
        assert_eq!(value_after(&a, "-movflags"), "+faststart");
        assert_eq!(value_after(&a, "-s"), "1920x1080");
        assert_eq!(value_after(&a, "-framerate"), "60");
        assert_eq!(value_after(&a, "-r"), "60");
        assert_eq!(value_after(&a, "-i"), "pipe:0", "frames are streamed on stdin");
        assert_eq!(value_after(&a, "-f"), "rawvideo");
        assert_eq!(a[a.len() - 3..], ["-f".to_string(), "mp4".to_string(), "/tmp/out.mp4.part".to_string()], "explicit muxer because of the .part suffix");
        // input options must precede -i, output options follow it
        assert!(pos(&a, "-s") < pos(&a, "-i") && pos(&a, "-i") < pos(&a, "-c:v"));
        assert!(a.contains(&"-an".to_string()));
    }

    #[test]
    fn mp4_args_honour_crf_and_preset_but_reject_garbage() {
        let mut sp = spec();
        sp.crf = 23;
        sp.preset = clean_preset(Some("slow"));
        let a = mp4_args(&sp, Path::new("o.mp4"));
        assert_eq!((value_after(&a, "-crf"), value_after(&a, "-preset")), ("23", "slow"));
        assert_eq!(clean_preset(Some("rm -rf /")), "veryfast");
        assert_eq!(clean_preset(None), "veryfast");
        sp.crf = 200;
        assert_eq!(value_after(&mp4_args(&sp, Path::new("o.mp4")), "-crf"), "51");
    }

    #[test]
    fn gif_uses_palettegen_then_paletteuse() {
        let plan = plan_frames(1.0, 3.0, 30, 10.0).unwrap();
        let pat = seq_pattern(Path::new("/tmp/kx"), "frame", plan.pad);
        assert!(pat.ends_with("frame_%04d.png"));
        let p1 = gif_palette_args(&pat, &plan, Path::new("/tmp/kx/palette.png"));
        assert!(value_after(&p1, "-vf").starts_with("palettegen="));
        assert_eq!(value_after(&p1, "-start_number"), "30");
        assert_eq!(value_after(&p1, "-framerate"), "30");
        assert_eq!(p1.last().unwrap(), "/tmp/kx/palette.png");
        let p2 = gif_encode_args(&pat, &plan, Path::new("/tmp/kx/palette.png"), Path::new("/tmp/o.gif.part"), true);
        assert!(value_after(&p2, "-lavfi").starts_with("paletteuse="));
        assert_eq!(p2.iter().filter(|x| *x == "-i").count(), 2, "frames + palette");
        assert_eq!(value_after(&p2, "-loop"), "0");
        assert_eq!(value_after(&gif_encode_args(&pat, &plan, Path::new("p"), Path::new("o"), false), "-loop"), "-1");
        assert_eq!(p2[p2.len() - 3..], ["-f".to_string(), "gif".to_string(), "/tmp/o.gif.part".to_string()]);
    }

    #[test]
    fn ffmpeg_discovery_order_is_env_sidecar_system() {
        let c = ffmpeg_candidates(Some(Path::new("/opt/kinetix")), Some("/custom/ffmpeg".into()));
        assert_eq!(c.iter().map(|x| x.1).collect::<Vec<_>>(), ["env", "sidecar", "system"]);
        assert_eq!(c[1].0, Path::new("/opt/kinetix").join(exe_name()));
        assert_eq!(c[2].0, PathBuf::from("ffmpeg"));
        assert_eq!(ffmpeg_candidates(None, Some("  ".into())).len(), 1, "blank override ignored, no exe dir");
    }

    /* ---- error mapping ---- */

    #[test]
    fn disk_full_and_permission_errors_are_explained() {
        let p = Path::new("/mnt/usb/out.mp4");
        for code in [28, 112, 39] {
            let e = io_error(&io::Error::from_raw_os_error(code), "writing", p);
            assert_eq!(e.code, "disk_full", "os error {code}");
            assert!(e.message.contains("Disk full") && e.message.contains("out.mp4"));
        }
        let e = io_error(&io::Error::from(io::ErrorKind::PermissionDenied), "creating", p);
        assert_eq!(e.code, "permission");
        assert!(e.message.contains("Permission denied"));
        assert_eq!(io_error(&io::Error::from(io::ErrorKind::NotFound), "creating", p).code, "io");
        assert_eq!(ffmpeg_failure("av_interleaved_write_frame(): No space left on device", Some(1)).code, "disk_full");
        assert_eq!(ffmpeg_failure("out.mp4: Permission denied", Some(1)).code, "permission");
        let e = ffmpeg_failure("a\n\nUnknown encoder 'libx264'\n", Some(1));
        assert_eq!(e.code, "ffmpeg_failed");
        assert!(e.message.contains("Unknown encoder") && e.message.contains("exit code 1"));
    }

    /* ---- real pipeline (skipped when ffmpeg is not installed) ---- */

    fn ffmpeg_for_tests() -> Option<PathBuf> {
        let p = PathBuf::from("ffmpeg");
        match probe_ffmpeg_at(&p) {
            Some((_, true)) => Some(p),
            _ => {
                eprintln!("SKIPPED: ffmpeg with libx264 not on PATH");
                None
            }
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("kinetix-test-{name}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn args(format: Format, out: &Path, frames_s: f64, fps: u32) -> StartArgs {
        StartArgs { format, width: 64, height: 48, fps, start: 0.0, end: frames_s, duration: 10.0, out_path: out.to_string_lossy().into(), crf: None, preset: None, prefix: None, loop_gif: Some(true) }
    }

    fn rgba(i: u32, w: u32, h: u32) -> Vec<u8> {
        let mut v = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            for x in 0..w {
                v.extend_from_slice(&[((x * 4 + i * 20) % 256) as u8, (y * 5) as u8, (i * 30 % 256) as u8, 255]);
            }
        }
        v
    }

    fn png(i: u32, w: u32, h: u32) -> Vec<u8> {
        let mut out = vec![];
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            enc.write_header().unwrap().write_image_data(&rgba(i, w, h)).unwrap();
        }
        out
    }

    fn probe_stream(file: &Path) -> Option<String> {
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,nb_read_frames,width,height", "-of", "csv=p=0"])
            .arg(file)
            .output()
            .ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    #[test]
    fn mp4_pipeline_streams_frames_and_produces_h264_yuv420p() {
        let Some(ff) = ffmpeg_for_tests() else { return };
        let dir = scratch("mp4");
        let out = dir.join("clip.mp4");
        let mgr = ExportManager::new();
        let info = mgr.start(args(Format::Mp4, &out, 0.5, 24), Some(ff)).unwrap();
        assert_eq!(info.plan.count, 12);
        for i in 0..info.plan.count {
            mgr.write_frame(&info.job_id, i, &rgba(i, 64, 48)).unwrap();
        }
        let mid = mgr.progress(&info.job_id).unwrap();
        assert_eq!((mid.state.as_str(), mid.frames_done, mid.total), ("running", 12, 12));
        let done = mgr.finish(&info.job_id).unwrap();
        assert_eq!(done.frames, 12);
        assert!(done.bytes > 0 && out.exists());
        assert!(!dir.join("clip.mp4.part").exists(), "the .part file is renamed on success");
        let head = fs::read(&out).unwrap();
        assert_eq!(&head[4..8], b"ftyp");
        if let Some(p) = probe_stream(&out) {
            assert_eq!(p, "h264,64,48,yuv420p,12", "codec,w,h,pix_fmt,frames");
        }
        assert_eq!(mgr.progress(&info.job_id).unwrap().state, "done");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn mp4_cancel_kills_ffmpeg_and_removes_the_partial_file() {
        let Some(ff) = ffmpeg_for_tests() else { return };
        let dir = scratch("mp4c");
        let out = dir.join("clip.mp4");
        let mgr = ExportManager::new();
        let info = mgr.start(args(Format::Mp4, &out, 2.0, 24), Some(ff)).unwrap();
        assert!(dir.join("clip.mp4.part").exists());
        for i in 0..3 {
            mgr.write_frame(&info.job_id, i, &rgba(i, 64, 48)).unwrap();
        }
        let pr = mgr.cancel(&info.job_id).unwrap();
        assert_eq!(pr.state, "cancelled");
        assert!(!dir.join("clip.mp4.part").exists() && !out.exists());
        assert_eq!(mgr.write_frame(&info.job_id, 3, &rgba(3, 64, 48)).unwrap_err().code, "cancelled");
        assert_eq!(mgr.finish(&info.job_id).unwrap_err().code, "cancelled");
        // a new export may start straight away
        assert!(mgr.start(args(Format::Png, &dir.join("seq"), 0.25, 24), None).is_ok());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn frames_must_have_the_right_size_and_order() {
        let Some(ff) = ffmpeg_for_tests() else { return };
        let dir = scratch("bad");
        let mgr = ExportManager::new();
        let info = mgr.start(args(Format::Mp4, &dir.join("c.mp4"), 0.25, 24), Some(ff.clone())).unwrap();
        assert_eq!(mgr.write_frame(&info.job_id, 1, &rgba(1, 64, 48)).unwrap_err().code, "invalid", "out of order");
        assert_eq!(mgr.progress(&info.job_id).unwrap().state, "failed");
        assert!(!dir.join("c.mp4.part").exists(), "failure cleans the partial file");

        let info = mgr.start(args(Format::Mp4, &dir.join("d.mp4"), 0.25, 24), Some(ff)).unwrap();
        assert_eq!(mgr.write_frame(&info.job_id, 0, &[1, 2, 3]).unwrap_err().code, "invalid", "wrong byte count");
        assert!(!dir.join("d.mp4.part").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_ffmpeg_blocks_video_but_png_sequence_still_works() {
        let dir = scratch("noff");
        let mgr = ExportManager::new();
        let e = mgr.start(args(Format::Mp4, &dir.join("c.mp4"), 0.25, 24), None).unwrap_err();
        assert_eq!(e.code, "ffmpeg_missing");
        assert!(!dir.join("c.mp4.part").exists());
        let e = mgr.start(args(Format::Gif, &dir.join("c.gif"), 0.25, 24), None).unwrap_err();
        assert_eq!(e.code, "ffmpeg_missing");

        let seq = dir.join("seq");
        let info = mgr.start(args(Format::Png, &seq, 0.25, 24), None).unwrap();
        assert_eq!(info.plan.count, 6);
        assert!(mgr.write_frame(&info.job_id, 0, b"not a png").is_err(), "non-PNG payload rejected");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn png_sequence_writes_zero_padded_files_and_cancel_cleans_up() {
        let dir = scratch("png");
        let seq = dir.join("frames");
        let mgr = ExportManager::new();
        let mut a = args(Format::Png, &seq, 0.5, 24);
        a.prefix = Some("shot".into());
        let info = mgr.start(a, None).unwrap();
        for i in 0..info.plan.count {
            mgr.write_frame(&info.job_id, i, &png(i, 32, 24)).unwrap();
        }
        let r = mgr.finish(&info.job_id).unwrap();
        assert_eq!(r.frames, 12);
        let mut names: Vec<String> = fs::read_dir(&seq).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into()).collect();
        names.sort();
        assert_eq!(names.len(), 12);
        assert_eq!((names[0].as_str(), names[11].as_str()), ("shot_0000.png", "shot_0011.png"));
        assert!(!seq.join(".kinetix-write-test").exists());

        // cancel mid-way: our frames are removed, and the folder too because this job created it
        let seq2 = dir.join("frames2");
        let info = mgr.start(args(Format::Png, &seq2, 0.5, 24), None).unwrap();
        for i in 0..4 {
            mgr.write_frame(&info.job_id, i, &png(i, 32, 24)).unwrap();
        }
        assert!(seq2.join("frame_0003.png").exists());
        mgr.cancel(&info.job_id).unwrap();
        assert!(!seq2.exists(), "temp output removed on cancel");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn gif_is_palette_optimised_and_temp_frames_are_removed() {
        let Some(ff) = ffmpeg_for_tests() else { return };
        let dir = scratch("gif");
        let out = dir.join("anim.gif");
        let mgr = ExportManager::new();
        let info = mgr.start(args(Format::Gif, &out, 0.5, 24), Some(ff)).unwrap();
        for i in 0..info.plan.count {
            mgr.write_frame(&info.job_id, i, &png(i, 64, 48)).unwrap();
        }
        let r = mgr.finish(&info.job_id).unwrap();
        assert!(r.bytes > 0);
        let head = fs::read(&out).unwrap();
        assert_eq!(&head[..6], b"GIF89a");
        assert!(!dir.join("anim.gif.part").exists());
        assert!(!std::env::temp_dir().join(format!("kinetix-export-{}-{}", std::process::id(), info.job_id)).exists(), "temp frames removed");
        if let Some(p) = probe_stream(&out) {
            assert!(p.starts_with("gif,64,48"), "{p}");
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn atomic_text_write_replaces_the_file_and_leaves_no_part_file() {
        let dir = scratch("text");
        let f = dir.join("scene.svg");
        assert_eq!(write_atomic(&f, b"<svg/>").unwrap(), 6);
        assert_eq!(fs::read_to_string(&f).unwrap(), "<svg/>");
        write_atomic(&f, b"<svg>2</svg>").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "<svg>2</svg>");
        assert!(!dir.join("scene.svg.part").exists());
        let e = write_atomic(&dir.join("no/such/dir/x.svg"), b"x").unwrap_err();
        assert_eq!(e.code, "io");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unwritable_destination_is_reported_as_a_permission_or_io_error() {
        let mgr = ExportManager::new();
        let e = mgr.start(args(Format::Png, Path::new("/proc/kinetix-denied"), 0.25, 24), None).unwrap_err();
        assert!(["permission", "io"].contains(&e.code.as_str()), "{e}");
        let e = mgr.start(args(Format::Gif, Path::new("/definitely/not/here/x.gif"), 0.25, 24), Some(PathBuf::from("ffmpeg"))).unwrap_err();
        assert_eq!(e.code, "io");
    }
}
