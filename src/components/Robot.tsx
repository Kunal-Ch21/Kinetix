export type BotMode = "idle" | "point" | "scan" | "think" | "talk";

/** Vector robot mascot. All motion is CSS transform/opacity so it stays on the compositor at 60 FPS. */
export function Robot({ size = 40, mode = "idle", look = { x: 0, y: 0 } }: { size?: number; mode?: BotMode; look?: { x: number; y: number } }) {
  const arm = look.x < -0.2 ? "-130deg" : look.x > 0.2 ? "-40deg" : "-85deg";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="bot-float" style={{ overflow: "visible" }} aria-label="Kinetix helper robot">
      <defs>
        <linearGradient id="rb-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f8fc" />
          <stop offset="1" stopColor="#aab9cc" />
        </linearGradient>
        <linearGradient id="rb-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9e3ee" />
          <stop offset="1" stopColor="#7f90a8" />
        </linearGradient>
        <radialGradient id="rb-glow">
          <stop offset="0" stopColor="#67e8f9" stopOpacity="0.95" />
          <stop offset="1" stopColor="#06b6d4" stopOpacity="0" />
        </radialGradient>
        <clipPath id="rb-visor">
          <rect x="28" y="26" width="44" height="26" rx="11" />
        </clipPath>
      </defs>

      {/* antenna */}
      <g className="bot-antenna">
        <line x1="50" y1="19" x2="50" y2="8" stroke="#8da0b8" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="50" cy="6" r="9" fill="url(#rb-glow)" className="bot-glow" />
        <circle cx="50" cy="6" r="3.4" fill="#67e8f9" />
      </g>

      <g className="bot-breathe">
        {/* arms */}
        <g>
          <rect x="22" y="64" width="7" height="17" rx="3.5" fill="#9fb0c6" />
        </g>
        <g transform="translate(72 66)">
          <g
            className={mode === "point" ? "bot-arm" : undefined}
            style={{ ["--arm" as string]: arm, transform: mode === "point" ? undefined : "rotate(-8deg)", transformOrigin: "0 0", transformBox: "fill-box" }}
          >
            <rect x="-2" y="-2" width="7" height="17" rx="3.5" fill="#9fb0c6" transform="rotate(180 1.5 6.5)" />
            {mode === "point" && <circle cx="1.5" cy="-8" r="3" fill="#67e8f9" className="bot-glow" />}
          </g>
        </g>
        {/* body */}
        <rect x="31" y="60" width="38" height="28" rx="13" fill="url(#rb-body)" stroke="#fff" strokeOpacity="0.35" />
        <circle cx="50" cy="73" r="8" fill="url(#rb-glow)" className="bot-glow" />
        <circle cx="50" cy="73" r="3.2" fill="#a5f3fc" />

        {/* head */}
        <g style={{ transform: `rotate(${look.x * 5}deg)`, transformOrigin: "50% 60%", transformBox: "fill-box", transition: "transform .25s ease" }}>
          <rect x="21" y="18" width="58" height="42" rx="18" fill="url(#rb-head)" stroke="#fff" strokeOpacity="0.5" />
          <circle cx="17" cy="40" r="4.5" fill="#22d3ee" />
          <circle cx="83" cy="40" r="4.5" fill="#22d3ee" />
          <rect x="28" y="26" width="44" height="26" rx="11" fill="#08101c" stroke="#06b6d4" strokeOpacity="0.55" strokeWidth="1.2" />
          {/* eyes */}
          <g style={{ transform: `translate(${look.x * 3.5}px, ${look.y * 2.5}px)`, transition: "transform .2s ease" }}>
            <g className="bot-eye">
              <ellipse cx="41" cy="38" rx="5" ry="6" fill="#67e8f9" />
              <ellipse cx="41" cy="38" rx="9" ry="10" fill="url(#rb-glow)" opacity="0.5" />
            </g>
            <g className="bot-eye">
              <ellipse cx="59" cy="38" rx="5" ry="6" fill="#67e8f9" />
              <ellipse cx="59" cy="38" rx="9" ry="10" fill="url(#rb-glow)" opacity="0.5" />
            </g>
            <circle cx="42.5" cy="36" r="1.5" fill="#fff" />
            <circle cx="60.5" cy="36" r="1.5" fill="#fff" />
          </g>
          {/* mouth */}
          <path
            d={mode === "talk" ? "M45 47.5q5 4 10 0" : "M45 47q5 3 10 0"}
            stroke="#22d3ee"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            className={mode === "talk" ? "bot-glow" : undefined}
          />
          {mode === "scan" && (
            <g clipPath="url(#rb-visor)">
              <rect x="49" y="24" width="3" height="30" fill="#a5f3fc" opacity="0.85" className="bot-scan" />
            </g>
          )}
        </g>
      </g>

      {mode === "think" && (
        <g fill="#67e8f9">
          <circle cx="76" cy="12" r="2.4" className="bot-dot" />
          <circle cx="84" cy="12" r="2.4" className="bot-dot" style={{ animationDelay: "0.15s" }} />
          <circle cx="92" cy="12" r="2.4" className="bot-dot" style={{ animationDelay: "0.3s" }} />
        </g>
      )}
    </svg>
  );
}
