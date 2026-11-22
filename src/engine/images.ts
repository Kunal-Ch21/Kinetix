// Sprite cache: imported image assets are decoded once and drawn by the Renderer (kind "image").
const cache = new Map<string, HTMLImageElement>();
const pending = new Set<string>();
let onReady: (() => void) | null = null;

export function setImageReadyHandler(fn: (() => void) | null) {
  onReady = fn;
}

export function registerImage(id: string, src: string) {
  if (!src || cache.has(id) || pending.has(id)) return;
  pending.add(id);
  const im = new Image();
  im.onload = () => {
    pending.delete(id);
    cache.set(id, im);
    onReady?.();
  };
  im.onerror = () => pending.delete(id);
  im.src = src;
}

export const getImage = (id: string): HTMLImageElement | null => cache.get(id) ?? null;
export const forgetImages = () => {
  cache.clear();
  pending.clear();
};

/**
 * Decodes `src` (a data: URL) and swaps it into the cache. Used by the exporter so sprites never come from
 * cross-origin `asset:` URLs, which would taint the export canvas and make getImageData / toBlob throw.
 */
export function replaceImage(id: string, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      cache.set(id, im);
      pending.delete(id);
      resolve();
    };
    im.onerror = () => reject(new Error(`Could not decode image asset "${id}"`));
    im.src = src;
  });
}
