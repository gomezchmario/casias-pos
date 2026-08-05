"use client";

import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";

type Notice = { text: string; by: string; at: string };

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
 * The notice board above the register: one standing note a manager leaves for
 * whoever is on the counter, which stays up until it is changed.
 *
 * When there is nothing to say it renders *nothing* for a cashier, and only a
 * quiet link for a manager. A permanently visible empty box is furniture, and
 * furniture is invisible — the value of this strip is that a cashier walking up
 * to a cold register can tell at a glance whether there is something to know.
 */
export function NoticeBoard() {
  const { can } = usePosAuth();
  const mayWrite = can("writeNotice");

  const [notice, setNotice] = useState<Notice | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/notice");
    if (!res.ok) return;
    setNotice((await res.json()) as Notice);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Takes the text rather than reading `draft`, so "Take it down" can send an
  // empty string without waiting a render for the state to catch up.
  async function save(text: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/notice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? "Could not save");
        return;
      }
      setNotice((await res.json()) as Notice);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  // Nothing loaded yet: draw nothing rather than a placeholder that shifts the
  // whole page down a line a moment later.
  if (!notice) return null;

  if (editing) {
    return (
      <div className="mb-6 rounded-xl p-4" style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}>
        <label className="block text-xs uppercase tracking-wider text-amber-800 mb-2 font-medium">
          Note for the counter
        </label>
        <textarea
          className="input w-full"
          rows={3}
          maxLength={500}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tire truck comes Thursday. Don't take checks."
        />
        {error && <div className="text-sm text-red-700 mt-2">{error}</div>}
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save(draft)}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save note"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
          {/* Clearing is deliberately its own button rather than "save an empty
              box", so taking the note down is a decision someone makes instead
              of something that happens by backspacing. */}
          {notice.text && (
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
    );
  }

  if (!notice.text) {
    if (!mayWrite) return null;
    return (
      <div className="mb-6">
        <button
          type="button"
          className="text-sm text-brand-300 hover:text-brand-500 hover:underline"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          + Leave a note for the counter
        </button>
      </div>
    );
  }

  return (
    <div
      className="mb-6 rounded-xl p-4 flex items-start gap-3"
      style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}
    >
      <span aria-hidden style={{ fontSize: 18, lineHeight: "24px" }}>
        📌
      </span>
      <div className="flex-1 min-w-0">
        {/* Newlines the manager typed are newlines on the board. */}
        <div className="text-amber-900 whitespace-pre-wrap">{notice.text}</div>
        {notice.by && (
          <div className="text-xs text-amber-700/80 mt-1">
            {notice.by}
            {notice.at ? ` · ${whenWritten(notice.at)}` : ""}
          </div>
        )}
      </div>
      {mayWrite && (
        <button
          type="button"
          className="text-sm text-amber-800 hover:underline shrink-0"
          onClick={() => {
            setDraft(notice.text);
            setEditing(true);
          }}
        >
          Edit
        </button>
      )}
    </div>
  );
}
