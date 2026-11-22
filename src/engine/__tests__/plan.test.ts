import { describe, expect, it } from "vitest";
import { aspectDiffers, frameName, frameTime, even, padWidth, planFrames, resolutionFor, safeName } from "../../export/plan";

// These vectors are the same ones asserted by the Rust tests in src-tauri/src/export.rs.
describe("export plan (mirror of Rust plan_frames)", () => {
  it("full project is end-exclusive at 24/30/60 fps", () => {
    expect(planFrames(0, 10, 24, 10)).toEqual({ first: 0, count: 240, pad: 4, fps: 24 });
    expect(planFrames(0, 10, 30, 10)).toEqual({ first: 0, count: 300, pad: 4, fps: 30 });
    expect(planFrames(0, 10, 60, 10)).toEqual({ first: 0, count: 600, pad: 4, fps: 60 });
  });
  it("sub-range keeps absolute frame numbers and clamps to the duration", () => {
    const p = planFrames(2.5, 4, 30, 10)!;
    expect([p.first, p.count]).toEqual([75, 45]);
    expect(frameTime(p.first + p.count - 1, 30)).toBeLessThan(4);
    expect(frameTime(p.first, 30)).toBe(2.5);
    expect(planFrames(-3, 99, 24, 10)).toMatchObject({ first: 0, count: 240 });
  });
  it("rejects empty / invalid ranges", () => {
    expect(planFrames(3, 3, 30, 10)).toBeNull();
    expect(planFrames(5, 4, 30, 10)).toBeNull();
    expect(planFrames(12, 20, 30, 10)).toBeNull();
    expect(planFrames(0, 1, 0, 10)).toBeNull();
    expect(planFrames(0, 1, 500, 10)).toBeNull();
    expect(planFrames(NaN, 1, 30, 10)).toBeNull();
  });
  it("names are zero padded and widen with the sequence", () => {
    expect(frameName("frame", 0, 4)).toBe("frame_0000.png");
    expect(frameName("shot", 119, 4)).toBe("shot_0119.png");
    expect(padWidth(9999)).toBe(4);
    expect(padWidth(10000)).toBe(5);
    const p = planFrames(0, 200, 60, 200)!;
    expect([p.count, p.pad]).toEqual([12000, 5]);
    expect(frameName("frame", p.first + p.count - 1, p.pad)).toBe("frame_11999.png");
  });
  it("720p / 1080p keep the scene aspect, even dimensions; custom is clamped to even", () => {
    const sc = { width: 1920, height: 1080 };
    expect(resolutionFor("720p", sc, { width: 0, height: 0 })).toEqual({ width: 1280, height: 720 });
    expect(resolutionFor("1080p", sc, { width: 0, height: 0 })).toEqual({ width: 1920, height: 1080 });
    expect(resolutionFor("720p", { width: 1000, height: 1000 }, { width: 0, height: 0 })).toEqual({ width: 720, height: 720 });
    expect(resolutionFor("custom", sc, { width: 853, height: 479 })).toEqual({ width: 854, height: 480 });
    expect(resolutionFor("custom", sc, { width: 99999, height: 3 })).toEqual({ width: 7680, height: 16 });
    expect(even(7)).toBe(8);
    expect(aspectDiffers({ width: 1280, height: 720 }, { width: 720, height: 720 })).toBe(true);
    expect(aspectDiffers({ width: 1280, height: 720 }, { width: 1920, height: 1080 })).toBe(false);
  });
  it("safeName strips path characters", () => {
    expect(safeName("My Project: v2/final")).toBe("My_Project_v2_final");
    expect(safeName("///")).toBe("kinetix");
  });
});
