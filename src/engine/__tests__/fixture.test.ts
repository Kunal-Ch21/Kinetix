import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApexMorph } from "../sample";

// The Rust round-trip test (src-tauri/src/commands.rs) loads this exact document, so it must track sample.ts.
// Regenerate with:  UPDATE_FIXTURE=1 npx vitest run src/engine/__tests__/fixture.test.ts
// makeEmitter() draws a random particle seed each time the sample is built (the seed is then frozen inside the saved
// scene), so seeds are normalised before comparing.
const norm = (v: unknown) => {
  const sc = JSON.parse(JSON.stringify(v));
  for (const e of sc.emitters) e.seed = 0;
  return sc;
};
const FILE = resolve(__dirname, "../../../src-tauri/tests/fixtures/apex_scene.json");

describe("Rust round-trip fixture", () => {
  it("apex_scene.json is the current Apex Morph Scene", () => {
    const json = JSON.stringify(buildApexMorph());
    if (process.env.UPDATE_FIXTURE) writeFileSync(FILE, json);
    expect(norm(JSON.parse(readFileSync(FILE, "utf8")))).toEqual(norm(JSON.parse(json)));
  });
});
