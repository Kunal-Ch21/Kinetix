import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeFrameRenderer } from "../../export/exporter";
import { frameTime } from "../../export/plan";
import { buildApexMorph } from "../sample";

// The exporter's contract: frame i is a pure function of (scene, i / fps). If the Renderer kept hidden state between
// frames (particle history, easing caches, leftover canvas state) the same t would not produce the same pixels.
const W = 320;
const H = 180;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("Renderer determinism (what the exporter relies on)", () => {
  const scene = buildApexMorph();
  const before = JSON.stringify(scene);

  it("rendering the same t twice gives byte-identical pixels", () => {
    const fr = makeFrameRenderer(W, H);
    fr.render(scene, 2.5);
    const a = sha(fr.rgba());
    fr.render(scene, 2.5);
    expect(sha(fr.rgba())).toBe(a);
  });

  it("a brand-new renderer on a new canvas produces the same pixels as a warmed-up one", () => {
    const warm = makeFrameRenderer(W, H);
    for (const t of [0, 1.1, 4.2, 9.9]) warm.render(scene, t);
    warm.render(scene, 5.5);
    const fresh = makeFrameRenderer(W, H);
    fresh.render(scene, 5.5);
    expect(sha(fresh.rgba())).toBe(sha(warm.rgba()));
  });

  it("is independent of the order frames are rendered in (t1, t2, t1)", () => {
    const fr = makeFrameRenderer(W, H);
    fr.render(scene, 4.0);
    const a = sha(fr.rgba());
    fr.render(scene, 7.25);
    const b = sha(fr.rgba());
    fr.render(scene, 4.0);
    expect(sha(fr.rgba())).toBe(a);
    expect(b).not.toBe(a); // and time really changes the picture
  });

  it("export frame indices map to t = i / fps and re-rendering a frame index is identical", () => {
    const fps = 30;
    const fr = makeFrameRenderer(W, H);
    const t = frameTime(150, fps);
    expect(t).toBe(5);
    fr.render(scene, t);
    const a = sha(fr.rgba());
    fr.render(scene, frameTime(151, fps));
    fr.render(scene, frameTime(150, fps));
    expect(sha(fr.rgba())).toBe(a);
  });

  it("is deterministic with particles, morphing and lights active (Apex Morph mid-morph)", () => {
    expect(scene.emitters.length).toBeGreaterThan(0);
    expect(scene.lights.length).toBeGreaterThan(0);
    const t = 4.4; // inside the "Mid-Air Morph" story event
    const a = makeFrameRenderer(W, H);
    const b = makeFrameRenderer(W, H);
    a.render(scene, t);
    b.render(scene, t);
    expect(sha(a.rgba())).toBe(sha(b.rgba()));
  });

  it("never mutates the scene", () => {
    const fr = makeFrameRenderer(W, H);
    for (let i = 0; i < 5; i++) fr.render(scene, i * 1.7);
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("does not render a blank frame (guards against a silently failing canvas)", () => {
    const fr = makeFrameRenderer(W, H);
    fr.render(scene, 3);
    const px = fr.rgba();
    const colours = new Set<number>();
    for (let i = 0; i < px.length; i += 4 * 97) colours.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    expect(colours.size).toBeGreaterThan(20);
  });
});
