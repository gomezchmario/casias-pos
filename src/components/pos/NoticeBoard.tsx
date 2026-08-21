"use client";

import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";

type BoardNote = {
  id: number;
  employeeId: number | null;
  by: string;
  body: string;
  color: string;
  at: string;
  mine: boolean;
};

/**
 * The pastels, mapped from the key the row stores. Chosen as sets rather
 * than a bare background so the border and the ink stay readable on every
 * one — a color picker that could produce grey-on-grey would be a bug with
 * a palette. Amber first because amber is what the board has always been.
 */
const COLORS: Record<string, { bg: string; border: string; ink: string; foot: string }> = {
  amber: { bg: "#fffbeb", border: "#fcd34d", ink: "#78350f", foot: "rgba(180,83,9,0.8)" },
  mint: { bg: "#ecfdf5", border: "#6ee7b7", ink: "#064e3b", foot: "rgba(4,120,87,0.8)" },
  sky: { bg: "#eff6ff", border: "#93c5fd", ink: "#1e3a5f", foot: "rgba(29,78,116,0.8)" },
  rose: { bg: "#fff1f2", border: "#fda4af", ink: "#881337", foot: "rgba(159,18,57,0.8)" },
  lilac: { bg: "#f5f3ff", border: "#c4b5fd", ink: "#4c1d95", foot: "rgba(91,33,182,0.8)" },
  sand: { bg: "#fafaf9", border: "#d6d3d1", ink: "#44403c", foot: "rgba(87,83,78,0.8)" },
};
const PALETTE = Object.keys(COLORS);

/** "Aug 2, 3:40 PM" — enough to judge whether a note has gone stale. */
function whenWritten(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The corkboard above the register: one note per author, each signed, each
 * in its author's chosen pastel, up until somebody takes it down.
 *
 * Your own note gets Edit; every note gets ✕ for anyone allowed to write —
 * a board where only the author could remove a note is a board that fills
 * with notes from people on vacation. When there is nothing to say it
 * renders nothing for a cashier and only a quiet link for a writer: an
 * empty box is furniture, and furniture is invisible.
 */
export function NoticeBoard() {
  const { can, user } = usePosAuth();
  const mayWrite = can("writeNotice");

  const [notes, setNotes] = useState<BoardNote[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftColor, setDraftColor] = useState("amber");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/notice");
    if (!res.ok) return;
    setNotes(((await res.json()) as { notes: BoardNote[] }).notes);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = notes?.find((n) => n.mine) ?? null;

  // Takes the text rather than reading `draft`, so "Take it down" can send an
  // empty string without waiting a render for the state to catch up.
  async function save(text: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/notice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, color: draftColor }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? "Could not save");
        return;
      }
      setNotes(((await res.json()) as { notes: BoardNote[] }).notes);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function takeDown(id: number) {
    setSaving(true);
    try {
      const res = await fetch("/api/pos/notice", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) setNotes(((await res.json()) as { notes: BoardNote[] }).notes);
    } finally {
      setSaving(false);
    }
  }

  // Nothing loaded yet: draw nothing rather than a placeholder that shifts the
  // whole page down a line a moment later.
  if (!notes) return null;

  const editColors = COLORS[draftColor] ?? COLORS.amber;

  return (
    <div className="mb-6">
      {notes.map((n) => {
        const c = COLORS[n.color] ?? COLORS.amber;
        return (
          <div
            key={n.id}
            className="rounded-xl p-4 flex items-start gap-3 mb-3"
            style={{ background: c.bg, border: `1px solid ${c.border}` }}
          >
            <span aria-hidden style={{ fontSize: 18, lineHeight: "24px" }}>
              📌
            </span>
            <div className="flex-1 min-w-0">
              {/* Newlines the writer typed are newlines on the board. */}
              <div className="whitespace-pre-wrap" style={{ color: c.ink }}>
                {n.body}
              </div>
              <div className="text-xs mt-1" style={{ color: c.foot }}>
                {n.by}
                {n.at ? ` · ${whenWritten(n.at)}` : ""}
              </div>
            </div>
            {mayWrite && n.mine && !editing && (
              <button
                type="button"
                className="text-sm hover:underline shrink-0"
                style={{ color: c.ink }}
                onClick={() => {
                  setDraft(n.body);
                  setDraftColor(n.color);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )}
            {mayWrite && !n.mine && (
              /* Anyone who may write may take any note down — signed, kept,
                 audited. The confirm is the whole ceremony: it is somebody
                 else's note, and one press eats it. */
              <button
                type="button"
                className="shrink-0 px-1 text-sm"
                style={{ color: c.foot }}
                aria-label={`Take down ${n.by}'s note`}
                title={`Take down ${n.by}'s note`}
                disabled={saving}
                onClick={() => {
                  if (window.confirm(`Take down ${n.by}'s note?`)) void takeDown(n.id);
                }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}

      {editing && (
        <div
          className="rounded-xl p-4 mb-3"
          style={{ background: editColors.bg, border: `1px solid ${editColors.border}` }}
        >
          <label
            className="block text-xs uppercase tracking-wider mb-2 font-medium"
            style={{ color: editColors.ink }}
          >
            {mine ? "Your note" : `A note from ${user.name}`}
          </label>
          <textarea
            className="input w-full"
            rows={4}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tire truck comes Thursday. Don't take checks."
          />
          {/* The pastels. Dots rather than names, because the dot IS the
              information; the ring says which one the note is wearing. */}
          <div className="flex items-center gap-2 mt-3">
            {PALETTE.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={draftColor === key}
                className="rounded-full"
                style={{
                  width: 24,
                  height: 24,
                  background: COLORS[key].bg,
                  border: `2px solid ${draftColor === key ? COLORS[key].ink : COLORS[key].border}`,
                }}
                onClick={() => setDraftColor(key)}
              />
            ))}
          </div>
          {error && <div className="text-sm text-red-700 mt-2">{error}</div>}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save(draft)}
              disabled={saving || draft.trim() === ""}
            >
              {saving ? "Saving…" : "Save note"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {/* Clearing is deliberately its own button rather than "save an
                empty box", so taking the note down is a decision someone makes
                instead of something that happens by backspacing. */}
            {mine && (
              <button
                type="button"
                className="btn btn-ghost ml-auto text-red-700"
                onClick={() => {
                  setDraft("");
                  void save("");
                }}
                disabled={saving}
              >
                Take it down
              </button>
            )}
          </div>
        </div>
      )}

      {mayWrite && !mine && !editing && (
        <button
          type="button"
          className="text-sm text-brand-300 hover:text-brand-500 hover:underline"
          onClick={() => {
            setDraft("");
            setDraftColor("amber");
            setEditing(true);
          }}
        >
          + Leave a note for the counter
        </button>
      )}
    </div>
  );
}
