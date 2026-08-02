"use client";

import { useEffect, useState } from "react";

export function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    return (
      <div className="text-right text-white/80">
        <div className="text-sm font-medium opacity-60">&nbsp;</div>
        <div className="text-3xl font-semibold tabular-nums">&nbsp;</div>
      </div>
    );
  }

  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const timeStr = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  return (
    <div className="text-right text-white">
      <div className="text-sm font-medium opacity-70">{dateStr}</div>
      <div
        className="text-4xl font-semibold tabular-nums"
        style={{ letterSpacing: "-0.02em" }}
      >
        {timeStr}
      </div>
    </div>
  );
}
