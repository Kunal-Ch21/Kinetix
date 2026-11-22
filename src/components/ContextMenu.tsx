import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  sep?: boolean;
  onClick?: () => void;
  children?: MenuItem[];
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

let menu: MenuState | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function openMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation?.();
  menu = { x: e.clientX, y: e.clientY, items };
  emit();
}

export function closeMenu() {
  if (menu) {
    menu = null;
    emit();
  }
}

function MenuList({ items, x, y, depth = 0 }: { items: MenuItem[]; x: number; y: number; depth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<number | null>(null);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 8) nx = depth ? x - r.width - 190 : window.innerWidth - r.width - 8;
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x: nx, y: ny });
  }, [x, y, depth]);
  return (
    <div ref={ref} className="ctx glass anim-fade" style={{ left: pos.x, top: pos.y, zIndex: 200 + depth }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <div
            key={i}
            className="ctx-item"
            data-disabled={it.disabled ? "true" : undefined}
            style={it.danger ? { color: "#fca5a5" } : undefined}
            onMouseEnter={() => setOpen(it.children ? i : null)}
            onClick={(e) => {
              e.stopPropagation();
              if (it.children) return;
              closeMenu();
              it.onClick?.();
            }}
          >
            <span className="w-4 flex justify-center text-[#9aa4b8]">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="mono text-[10px] text-[#7b8497]">{it.shortcut}</span>}
            {it.children && <ChevronRight size={13} className="text-[#7b8497]" />}
            {it.children && open === i && (
              <div style={{ position: "absolute", left: "100%", top: -5 }}>
                <SubMenu items={it.children} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

function SubMenu({ items }: { items: MenuItem[] }) {
  return (
    <div className="glass rounded-[10px] p-[5px] min-w-[180px] max-h-[320px] overflow-auto shadow-2xl">
      {items.map((it, i) => (
        <div
          key={i}
          className="ctx-item"
          data-disabled={it.disabled ? "true" : undefined}
          onClick={(e) => {
            e.stopPropagation();
            closeMenu();
            it.onClick?.();
          }}
        >
          <span className="w-4 flex justify-center text-[#9aa4b8]">{it.icon}</span>
          <span className="flex-1 truncate">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function ContextMenuHost() {
  const m = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => menu,
  );
  useEffect(() => {
    if (!m) return;
    const close = () => closeMenu();
    const key = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("wheel", close);
    };
  }, [m]);
  if (!m) return null;
  return (
    <div onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={m.items} x={m.x} y={m.y} />
    </div>
  );
}
