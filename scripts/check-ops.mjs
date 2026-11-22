// Verifies ONE op vocabulary: every `case "<op>"` that ops.ts::applyOps interprets must be listed in
// src-tauri/src/ai/schema.rs::OPS (and vice-versa), and every model-visible op must be in MODEL_OPS ⊆ OPS.
import { readFileSync } from "node:fs";
const ts = readFileSync("src/engine/ops.ts", "utf8");
const rs = readFileSync("src-tauri/src/ai/schema.rs", "utf8");
const tsOps = [...ts.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]).filter((n) => n !== "default");
const block = (name) => [...rs.slice(rs.indexOf(`pub const ${name}`)).split("];")[0].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
const OPS = block("OPS");
const MODEL = block("MODEL_OPS");
const missingInRs = tsOps.filter((o) => !OPS.includes(o));
const missingInTs = OPS.filter((o) => !tsOps.includes(o));
const stray = MODEL.filter((o) => !OPS.includes(o));
if (missingInRs.length || missingInTs.length || stray.length) {
  console.error({ missingInRs, missingInTs, stray });
  process.exit(1);
}
console.log(`op vocabulary OK: ${tsOps.length} ops in applyOps == schema::OPS (${MODEL.length} model-visible)`);
