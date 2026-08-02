"use client";

import type { EntryType } from "@/lib/entries";

type Props = {
  actions: EntryType[];
  onPick: (a: EntryType) => void;
  busy?: boolean;
};

const LABELS: Record<EntryType, { label: string; emoji: string; tone: "primary" | "accent" | "danger" | "ghost" }> = {
  check_in: { label: "Check In", emoji: "🟢", tone: "accent" },
  check_out: { label: "Check Out", emoji: "🔵", tone: "primary" },
  break_start: { label: "Take a Break", emoji: "☕", tone: "ghost" },
  break_end: { label: "End Break", emoji: "🟡", tone: "accent" },
};

export function ActionButtons({ actions, onPick, busy }: Props) {
  return (
    <div className="flex gap-3 justify-center flex-wrap animate-pop-in">
      {actions.map((a) => {
        const { label, emoji, tone } = LABELS[a];
        const cls =
          tone === "accent"
            ? "btn btn-accent"
            : tone === "primary"
              ? "btn btn-primary"
              : tone === "danger"
                ? "btn btn-danger"
                : "btn btn-ghost";
        return (
          <button
            key={a}
            type="button"
            onClick={() => onPick(a)}
            disabled={busy}
            className={`${cls} reveal`}
            style={{ minWidth: 160, padding: "0.85rem 1.2rem", fontSize: "1.05rem" }}
          >
            <span style={{ fontSize: "1.2rem" }}>{emoji}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
