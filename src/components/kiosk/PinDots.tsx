"use client";

type Props = {
  filled: number; // 0-4
  invalid?: boolean;
};

export function PinDots({ filled, invalid }: Props) {
  return (
    <div className="flex gap-4 justify-center" aria-label={`PIN: ${filled} of 4 digits entered`}>
      {[0, 1, 2, 3].map((i) => {
        const isFilled = i < filled;
        return (
          <div
            key={i}
            className="w-5 h-5 rounded-full transition-all duration-200"
            style={{
              backgroundColor: invalid
                ? "#d8444c"
                : isFilled
                  ? "#ffc83d"
                  : "rgba(255,255,255,0.18)",
              boxShadow: isFilled && !invalid
                ? "0 0 16px rgba(255,200,61,0.55)"
                : "inset 0 0 0 1px rgba(255,255,255,0.22)",
              transform: isFilled ? "scale(1.0)" : "scale(0.85)",
            }}
          />
        );
      })}
    </div>
  );
}
