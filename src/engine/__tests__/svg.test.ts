import { describe, expect, it } from "vitest";
import { sceneToSvg } from "../../export/svg";
import { buildApexMorph } from "../sample";

describe("SVG scene export", () => {
  const scene = buildApexMorph();
  const svg = sceneToSvg(scene, 4.4);

  it("is a well-formed, resolution-independent document", () => {
    expect(svg.startsWith("<?xml")).toBe(true);
    expect(svg).toContain('viewBox="0 0 100 56.25"');
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    // every opened tag is closed (self-closing tags excluded)
    const open = (svg.match(/<(g|defs|svg|text|clipPath|linearGradient|filter|title)[\s>]/g) ?? []).length;
    const close = (svg.match(/<\/(g|defs|svg|text|clipPath|linearGradient|filter|title)>/g) ?? []).length;
    expect(open).toBe(close);
  });

  it("contains each visible object with its resolved parent-child matrix", () => {
    for (const id of ["asset_03", "asset_04", "asset_05"]) expect(svg).toContain(`id="${id}"`);
    expect(svg).toMatch(/<g id="asset_03"[^>]*transform="matrix\(/);
  });

  it("morph is evaluated: the path at t=4.4 differs from the t=0 path", () => {
    const d0 = /<g id="asset_03"[^>]*><path d="([^"]+)"/.exec(sceneToSvg(scene, 0))![1];
    const d1 = /<g id="asset_03"[^>]*><path d="([^"]+)"/.exec(svg)![1];
    expect(d1).not.toBe(d0);
  });

  it("escapes text content and attributes", () => {
    const sc = structuredClone(scene);
    sc.objects.find((o) => o.kind === "text")!.text!.content = 'A<B> & "C"';
    expect(sceneToSvg(sc, 1)).toContain("A&lt;B&gt; &amp; &quot;C&quot;");
  });

  it("is deterministic", () => {
    expect(sceneToSvg(scene, 4.4)).toBe(svg);
  });
});
