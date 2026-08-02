type Props = { size?: number; className?: string; spin?: boolean };

export function TireMark({ size = 48, className, spin }: Props) {
  // Tire SVG: outer rubber + tread + rim + spokes + hub.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={spin ? { animation: "spin 8s linear infinite" } : undefined}
      aria-hidden
    >
      <defs>
        <radialGradient id="rubber" cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="#1a1a1f" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
        <radialGradient id="rim" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e8edf2" />
          <stop offset="80%" stopColor="#8ea4be" />
          <stop offset="100%" stopColor="#4f6e8e" />
        </radialGradient>
      </defs>

      {/* Outer tire */}
      <circle cx="50" cy="50" r="48" fill="url(#rubber)" />

      {/* Tread blocks (rotated rectangles around the rim) */}
      {Array.from({ length: 24 }).map((_, i) => {
        const angle = (i * 360) / 24;
        return (
          <rect
            key={i}
            x="48"
            y="2"
            width="4"
            height="8"
            fill="#2c2c34"
            transform={`rotate(${angle} 50 50)`}
          />
        );
      })}

      {/* Inner sidewall ring */}
      <circle
        cx="50"
        cy="50"
        r="38"
        fill="none"
        stroke="#0a0a0d"
        strokeWidth="2"
      />

      {/* Rim */}
      <circle cx="50" cy="50" r="32" fill="url(#rim)" />

      {/* Spokes (5) */}
      {Array.from({ length: 5 }).map((_, i) => {
        const angle = (i * 360) / 5;
        return (
          <rect
            key={i}
            x="48"
            y="22"
            width="4"
            height="22"
            rx="1.5"
            fill="#0a2540"
            transform={`rotate(${angle} 50 50)`}
          />
        );
      })}

      {/* Hub */}
      <circle cx="50" cy="50" r="8" fill="#0a2540" />
      <circle cx="50" cy="50" r="3" fill="#ffc83d" />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
