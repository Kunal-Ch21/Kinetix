// Generates the standalone public/docs/guide.html from the same chapters.json the in-app Docs hub renders.
// Usage: node scripts/build-guide.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chapters = JSON.parse(readFileSync(resolve(root, "src/docs/chapters.json"), "utf8"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

const block = (b) => {
  switch (b.type) {
    case "p":
      return `<p>${inline(b.text)}</p>`;
    case "h":
      return `<h3>${inline(b.text)}</h3>`;
    case "ul":
      return `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
    case "code":
      return `<pre><code>${esc(b.text)}</code></pre>`;
    case "tip":
      return `<aside class="tip"><span>Tip</span>${inline(b.text)}</aside>`;
    case "recipe":
      return `<div class="recipe" id="recipe-${b.id}">
  <div class="rhead"><h4>${esc(b.title)}</h4><a class="try" href="/?try=${b.id}">Try in Canvas</a></div>
  <p class="prompt"><span>Prompt</span>${esc(b.prompt)}</p>
  <details><summary>Show the ${b.ops.length} ops the model emits</summary><pre><code>${esc(JSON.stringify(b.ops, null, 2))}</code></pre></details>
</div>`;
    default:
      return "";
  }
};

const nav = chapters.map((c) => `<a href="#${c.id}">${esc(c.title)}</a>`).join("\n");
const body = chapters
  .map(
    (c) => `<section id="${c.id}">
  <h2>${esc(c.title)}</h2>
  ${c.badge ? `<div class="badge">${esc(c.badge)}</div>` : ""}
  ${c.blocks.map(block).join("\n  ")}
</section>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Kinetix Studio — User Guide</title>
<style>
  :root { --canvas:#07090E; --panel:#0E1118; --glass:#161B26; --line:rgba(255,255,255,.08); --blue:#3B82F6; --amber:#F59E0B; --cyan:#06B6D4; --text:#E6E9F0; --muted:#8B93A7; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin:0; background:var(--canvas); color:var(--text); font:15px/1.65 Inter, ui-sans-serif, system-ui, sans-serif; display:grid; grid-template-columns: 280px minmax(0,1fr); min-height:100vh; }
  nav { position:sticky; top:0; align-self:start; height:100vh; padding:28px 20px; background:var(--panel); border-right:1px solid var(--line); overflow:auto; }
  nav .brand { display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:.02em; margin-bottom:24px; }
  nav .brand i { width:26px; height:26px; border-radius:8px; background:linear-gradient(135deg,var(--blue),var(--cyan)); box-shadow:0 0 18px rgba(6,182,212,.45); }
  nav a { display:block; padding:7px 10px; border-radius:8px; color:var(--muted); text-decoration:none; font-size:13.5px; }
  nav a:hover { background:var(--glass); color:var(--text); }
  main { padding:56px clamp(24px,6vw,84px) 120px; max-width:940px; }
  h1 { font-size:40px; line-height:1.1; margin:0 0 10px; letter-spacing:-.02em; }
  .lead { color:var(--muted); font-size:17px; margin:0 0 36px; }
  section { padding-top:36px; margin-top:20px; border-top:1px solid var(--line); }
  h2 { font-size:26px; margin:0 0 8px; letter-spacing:-.01em; }
  h3 { font-size:16px; margin:26px 0 6px; color:var(--cyan); }
  .badge { display:inline-block; font:500 11px/1 'JetBrains Mono', ui-monospace, monospace; color:var(--amber); border:1px solid rgba(245,158,11,.35); background:rgba(245,158,11,.08); padding:5px 9px; border-radius:99px; margin-bottom:14px; }
  code { font:12.5px 'JetBrains Mono', ui-monospace, monospace; background:var(--glass); border:1px solid var(--line); padding:1px 6px; border-radius:6px; color:#CFE8FF; }
  pre { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; overflow:auto; }
  pre code { background:none; border:0; padding:0; color:#CFE8FF; }
  li { margin:4px 0; }
  .tip { margin:18px 0; padding:12px 16px; border-left:3px solid var(--blue); background:rgba(59,130,246,.07); border-radius:0 10px 10px 0; }
  .tip span { display:block; font:600 10.5px 'JetBrains Mono', monospace; letter-spacing:.12em; text-transform:uppercase; color:var(--blue); margin-bottom:2px; }
  .recipe { margin:18px 0; padding:16px 18px; background:var(--glass); border:1px solid var(--line); border-radius:14px; }
  .rhead { display:flex; justify-content:space-between; align-items:center; gap:12px; }
  .rhead h4 { margin:0; font-size:16px; }
  .try { background:var(--blue); color:#fff; text-decoration:none; font-weight:600; font-size:12.5px; padding:7px 12px; border-radius:9px; white-space:nowrap; box-shadow:0 0 20px rgba(59,130,246,.35); }
  .try:hover { filter:brightness(1.1); }
  .prompt { margin:10px 0; color:#CBD2E1; }
  .prompt span { font:600 10.5px 'JetBrains Mono', monospace; letter-spacing:.12em; text-transform:uppercase; color:var(--amber); margin-right:8px; }
  summary { cursor:pointer; color:var(--muted); font-size:13px; }
  @media (max-width: 860px) { body { grid-template-columns: 1fr; } nav { position:static; height:auto; } }
</style>
</head>
<body>
<nav>
  <div class="brand"><i></i> Kinetix Studio</div>
${nav}
</nav>
<main>
  <h1>Kinetix Studio User Guide</h1>
  <p class="lead">Native 2D AI motion, vector &amp; character animation — 100% offline. This guide is generated from the same source as the in-app Docs hub.</p>
${body}
</main>
</body>
</html>
`;

// Single source of truth: public/docs/guide.html. Vite copies `public/` verbatim into `dist/` (and Tauri bundles
// `dist/`), so the in-app link `/docs/guide.html` and the standalone page are the SAME file. There is intentionally
// no second copy under docs/ — it used to be byte-identical and had to be kept in sync by hand.
const out = resolve(root, "public/docs/guide.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log("wrote", out, `(${html.length} bytes)`);
