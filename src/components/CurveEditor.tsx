import { useRef } from "react";
import { Ease, PRESET_BEZIER, cubicBezierFn, easeAsBezier } from "@/engine/math";

const S = 168; // plot size
const PAD = 22;
const VB = S + PAD * 2;
const RANGE = [-0.6, 1.6]; // y range shown so overshoot is visible

const X = (v: number) => PAD + v * S;
const Y = (v: number) => PAD + S - ((v - RANGE[0]) / (RANGE[1] - RANGE[0])) * S;
const unX = (px: number) => (px - PAD) / S;
const unY = (py: number) => RANGE[0] + ((PAD + S - py) / S) * (RANGE[1] - RANGE[0]);

export function CurveEditor({ ease, onChange }: { ease: Ease | undefined; onChange: (e: Ease) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const b = easeAsBezier(ease);
  const [x1, y1, x2, y2] = b;
  const fn = cubicBezierFn(x1, y1, x2, y2);

  const pts: string[] = [];
  for (let i = 0; i <= 64; i++) pts.push(`${X(i / 64).toFixed(1)},${Y(fn(i / 64)).toFixed(1)}`);

  const drag = (which: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = svg.current!;
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const k = VB / r.width;
      const px = (ev.clientX - r.left) * k;
      const py = (ev.clientY - r.top) * k;
      const nx = Math.min(1, Math.max(0, unX(px)));
      const ny = Math.min(RANGE[1], Math.max(RANGE[0], unY(py)));
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const next: [number, number, number, number] = which === 0 ? [r2(nx), r2(ny), x2, y2] : [x1, y1, r2(nx), r2(ny)];
      onChange(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div>
      <svg ref={svg} viewBox={`0 0 ${VB} ${VB}`} className="w-full rounded-lg border border-white/10 bg-[#090C13] select-none touch-none">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={X(g)} x2={X(g)} y1={Y(RANGE[0])} y2={Y(RANGE[1])} stroke="rgba(255,255,255,.05)" />
            <line x1={X(0)} x2={X(1)} y1={Y(g)} y2={Y(g)} stroke="rgba(255,255,255,.05)" />
          </g>
        ))}
        <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="rgba(255,255,255,.12)" strokeDasharray="3 4" />
        <rect x={X(0)} y={Y(1)} width={S} height={Y(0) - Y(1)} fill="none" stroke="rgba(59,130,246,.35)" />
        <line x1={X(0)} y1={Y(0)} x2={X(x1)} y2={Y(y1)} stroke="#F59E0B" strokeOpacity=".7" />
        <line x1={X(1)} y1={Y(1)} x2={X(x2)} y2={Y(y2)} stroke="#06B6D4" strokeOpacity=".7" />
        <polyline points={pts.join(" ")} fill="none" stroke="#3B82F6" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx={X(0)} cy={Y(0)} r="3" fill="#7F889D" />
        <circle cx={X(1)} cy={Y(1)} r="3" fill="#7F889D" />
        <circle cx={X(x1)} cy={Y(y1)} r="7" fill="#F59E0B" stroke="#07090E" strokeWidth="2" onPointerDown={drag(0)} className="cursor-grab" />
        <circle cx={X(x2)} cy={Y(y2)} r="7" fill="#06B6D4" stroke="#07090E" strokeWidth="2" onPointerDown={drag(1)} className="cursor-grab" />
      </svg>
      <div className="mt-2 font-mono text-[11px] text-[#9AA3B8]">cubic-bezier({x1}, {y1}, {x2}, {y2})</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {Object.keys(PRESET_BEZIER).map((k) => (
          <button key={k} type="button" onClick={() => onChange(PRESET_BEZIER[k])} className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] text-[#C9D0E0] hover:bg-white/10">
            {k.replace(/_/g, " ")}
          </button>
        ))}
        <button type="button" onClick={() => onChange("spring_bounce")} className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] text-[#C9D0E0] hover:bg-white/10">
          spring
        </button>
        <button type="button" onClick={() => onChange("bounce")} className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] text-[#C9D0E0] hover:bg-white/10">
          bounce
        </button>
      </div>
      {typeof ease === "string" && (ease === "spring_bounce" || ease === "bounce" || ease === "arc_jump") ? (
        <p className="mt-2 text-[10.5px] text-[#7F889D]">Procedural ease “{ease}” is active. Drag a handle to replace it with a custom Bézier.</p>
      ) : null}
    </div>
  );
}
