// Minimal DOM canvas shim so the real `Renderer` (src/engine/render.ts) can run under Node.
import { Image, Path2D, createCanvas } from "@napi-rs/canvas";

const g = globalThis as unknown as Record<string, unknown>;
g.Path2D = Path2D;
g.Image = Image;
g.document = {
  createElement: (tag: string) => {
    if (tag !== "canvas") throw new Error(`test shim only supports <canvas>, got <${tag}>`);
    return createCanvas(300, 150);
  },
};
