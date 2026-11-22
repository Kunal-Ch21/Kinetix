import { useSyncExternalStore } from "react";
import type { MenuItem } from "../components/ui";

/** Global context-menu + hidden file-input registry (Canvas / Outliner / Dope Sheet / header menus share one host). */
interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}
let menu: MenuState | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function openMenu(x: number, y: number, items: MenuItem[]) {
  menu = { x, y, items };
  emit();
}
export function closeMenu() {
  if (!menu) return;
  menu = null;
  emit();
}
export function useMenu(): MenuState | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => menu,
    () => menu,
  );
}

let importInput: HTMLInputElement | null = null;
export const registerImportInput = (el: HTMLInputElement | null) => void (importInput = el);
export const triggerImport = () => importInput?.click();

let openInput: HTMLInputElement | null = null;
export const registerOpenInput = (el: HTMLInputElement | null) => void (openInput = el);
export const triggerOpen = () => openInput?.click();
