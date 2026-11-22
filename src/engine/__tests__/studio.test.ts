import { describe, expect, it } from "vitest";
import { ACTIONS, assignBinding, comboOf, findConflict, resetAllBindings } from "../../lib/keybinds";
import { parseLightPrompt } from "../../lib/lightPrompt";
import { TEMPLATES } from "../../lib/templates";
import { evalLights } from "../lighting";
import { applyOps } from "../ops";
import { Renderer } from "../render";
import { resolveScene } from "../rig";
import { emptyScene } from "../scene";
import { buildApexMorph } from "../sample";

describe("universal templates", () => {
  for (const t of TEMPLATES) {
    it(`${t.category} / ${t.name} applies cleanly`, () => {
      const s = emptyScene();
      const log = applyOps(s, t.build("tpl_test"));
      expect(log.filter((l) => l.startsWith("✗"))).toEqual([]);
      expect(s.objects.length).toBeGreaterThan(0);
    });
  }
  it("covers motion graphics, vector icons and characters", () => {
    expect(new Set(TEMPLATES.map((t) => t.category)).size).toBe(3);
  });
  it("a new project is completely blank", () => {
    const s = emptyScene();
    expect(s.objects.length + s.lights.length + s.emitters.length).toBe(0);
  });
});

describe("light director (invisible aimed lights)", () => {
  const scene = () => {
    const s = emptyScene();
    applyOps(s, [{ op: "create_shape", id: "asset_logo", label: "Logo", shape: "circle", r: 6, x: 60, y: 50 }, { op: "add_text", id: "txt_title", label: "Title", content: "Hello", x: 50, y: 20 }]);
    return s;
  };
  it("casts a cyan rim light from the top-left onto the logo", () => {
    const s = scene();
    const plan = parseLightPrompt("Cast a cool cyan rim light from top-left onto the logo", s, [], 0)!;
    expect(plan).toBeTruthy();
    applyOps(s, plan.ops);
    const l = s.lights[0];
    expect(l.type).toBe("sun");
    expect(l.x).toBeLessThan(15);
    expect(l.y).toBeLessThan(15);
    expect(l.tx).toBeCloseTo(60, 0);
    expect(l.ty).toBeCloseTo(50, 0);
    expect(l.color.toUpperCase()).toBe("#06B6D4");
    expect(l.affects).toEqual(["asset_logo"]);
    expect(s.objects.find((o) => o.id === "asset_logo")!.rim).toBeTruthy();
  });
  it("sweeps a warm spotlight beam across the title (animated target)", () => {
    const s = scene();
    const plan = parseLightPrompt("Sweep a warm spotlight beam across the title", s, [], 1)!;
    applyOps(s, plan.ops);
    const l = s.lights[0];
    expect(l.type).toBe("spot");
    const tx = l.tracks.find((t) => t.prop === "tx")!;
    expect(tx.keys.length).toBe(2);
    expect(tx.keys[1].v).toBeGreaterThan(tx.keys[0].v);
    const early = evalLights(s, 1, resolveScene(s, 1))[0];
    const late = evalLights(s, 4, resolveScene(s, 4))[0];
    expect(late.tx).toBeGreaterThan(early.tx);
    expect(late.angle).not.toBeCloseTo(early.angle, 1);
  });
  it("ignores non-lighting prompts", () => {
    expect(parseLightPrompt("make the logo bounce", scene(), [], 0)).toBeNull();
  });
  it("renders a scene with aimed lights without throwing (and with the sample's invisible lights)", () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 180;
    const r = new Renderer(c);
    r.render(buildApexMorph(), { t: 2, editor: true });
    const s = scene();
    applyOps(s, parseLightPrompt("cast a warm spotlight from the top onto the logo", s, [], 0)!.ops);
    r.render(s, { t: 0, editor: true });
    expect(r.lastLights.length).toBe(1);
  });
});

describe("keybinds", () => {
  it("ships 35+ actions with unique defaults", () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(35);
    const combos = ACTIONS.map((a) => a.combo).filter(Boolean);
    expect(new Set(combos).size).toBe(combos.length);
  });
  it("detects conflicts and swaps / overrides", () => {
    resetAllBindings();
    expect(findConflict("Ctrl+Z", "redo")?.id).toBe("undo");
    assignBinding("redo", "Ctrl+Z", "swap");
    expect(comboOf("redo")).toBe("Ctrl+Z");
    expect(comboOf("undo")).toBe("Ctrl+Y");
    assignBinding("redo", "Ctrl+Y", "override");
    expect(comboOf("undo")).toBe("");
    resetAllBindings();
    expect(comboOf("undo")).toBe("Ctrl+Z");
  });
});
