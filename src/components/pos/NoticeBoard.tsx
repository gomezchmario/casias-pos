"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";

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
 * The board's three faces of emphasis: **bold**, __underline__, _italic_.
 *
 * A markup this small is parsed into REACT NODES, never into HTML — the text
 * between the markers stays a text node whatever is typed in it, so the one
 * field on this screen that everybody may read can never carry a script. No
 * nesting, on purpose: a corkboard note that needs bold italic underline is
 * a note that needs rewriting.
 */
function rich(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|__[^_]+__|_[^_]+_)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
    if (part.startsWith("__") && part.endsWith("__")) return <u key={i}>{part.slice(2, -2)}</u>;
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2)
      return <i key={i}>{part.slice(1, -1)}</i>;
    return part;
  });
}

/**
 * The corkboard above the register: as many notes as the shop has things to
 * say, each signed, each in its author's chosen pastel, up until somebody
 * takes it down.
 *
 * Your own notes get Edit; everybody else's get ✕ for anyone allowed to
 * write — a board where only the author could remove a note is a board that
 * fills with notes from people on vacation. Only the author may REWRITE a
 * note, though: changing somebody's words under their signature would put
 * words in their mouth. When there is nothing to say the board renders
 * nothing for a cashier and only a quiet link for a writer — an empty box is
 * furniture, and furniture is invisible.
 */
export function NoticeBoard() {
  const { can, user } = usePosAuth();
  const mayWrite = can("writeNotice");

  const [notes, setNotes] = useState<BoardNote[] | null>(null);
  /** null = editor closed; 0 = writing a new note; an id = rewriting that one. */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [draftColor, setDraftColor] = useState("amber");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Somebody else's note, one press from coming down — the app's own dialog
      asks, not the browser's, so it looks like every other confirm here. */
  const [confirmTake, setConfirmTake] = useState<BoardNote | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/notice");
    if (!res.ok) return;
    setNotes(((await res.json()) as { notes: BoardNote[] }).notes);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/notice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId && editingId > 0 ? editingId : undefined,
          text: draft,
          color: draftColor,
        }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? "Could not save");
        return;
      }
      setNotes(((await res.json()) as { notes: BoardNote[] }).notes);
      setEditingId(null);
      setDraft("");
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
      if (res.ok) {
        setNotes(((await res.json()) as { notes: BoardNote[] }).notes);
        setEditingId(null);
        setDraft("");
      }
    } finally {
      setSaving(false);
    }
  }

  /** Wrap the textarea's selection in markers, or drop a pair to type into. */
  function wrapSelection(mark: string) {
    const box = boxRef.current;
    if (!box) return;
    const a = box.selectionStart ?? 0;
    const b = box.selectionEnd ?? 0;
    const next = draft.slice(0, a) + mark + draft.slice(a, b) + mark + draft.slice(b);
    setDraft(next);
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(a + mark.length, b + mark.length);
    });
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
                {rich(n.body)}
              </div>
              <div className="text-xs mt-1" style={{ color: c.foot }}>
                {n.by}
                {n.at ? ` · ${whenWritten(n.at)}` : ""}
              </div>
            </div>
            {mayWrite && n.mine && editingId === null && (
              <button
                type="button"
                className="text-sm hover:underline shrink-0"
                style={{ color: c.ink }}
                onClick={() => {
                  setDraft(n.body);
                  setDraftColor(n.color);
                  setEditingId(n.id);
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
                onClick={() => setConfirmTake(n)}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}

      {editingId !== null && (
        <div
          className="rounded-xl p-4 mb-3"
          style={{ background: editColors.bg, border: `1px solid ${editColors.border}` }}
        >
          <label
            className="block text-xs uppercase tracking-wider mb-2 font-medium"
            style={{ color: editColors.ink }}
          >
            {editingId > 0 ? "Your note" : `A note from ${user.name}`}
          </label>
          {/* B, I, U wrap whatever is selected — the markers are visible in
              the box and become the styling on the board. Honest about being
              markup: what you see typed is what the note stores. */}
          <div className="flex items-center gap-1 mb-2">
            <button type="button" className="btn btn-outline font-bold" style={{ height: 30, width: 34, fontSize: 13 }} title="Bold" onClick={() => wrapSelection("**")}>
              B
            </button>
            <button type="button" className="btn btn-outline italic" style={{ height: 30, width: 34, fontSize: 13 }} title="Italic" onClick={() => wrapSelection("_")}>
              I
            </button>
            <button type="button" className="btn btn-outline underline" style={{ height: 30, width: 34, fontSize: 13 }} title="Underline" onClick={() => wrapSelection("__")}>
              U
            </button>
          </div>
          <textarea
            ref={boxRef}
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
          {draft.trim() && (
            <div
              className="mt-3 rounded-lg p-2 text-sm whitespace-pre-wrap"
              style={{ background: "rgba(255,255,255,0.55)", color: editColors.ink }}
            >
              {rich(draft)}
            </div>
          )}
          {error && <div className="text-sm text-red-700 mt-2">{error}</div>}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving || draft.trim() === ""}
            >
              {saving ? "Saving…" : editingId > 0 ? "Save changes" : "Pin it up"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditingId(null);
                setDraft("");
              }}
            >
              Cancel
            </button>
            {/* Clearing is deliberately its own button rather than "save an
                empty box", so taking the note down is a decision someone makes
                instead of something that happens by backspacing. */}
            {editingId > 0 && (
              <button
                type="button"
                className="btn btn-ghost ml-auto text-red-700"
                onClick={() => void takeDown(editingId)}
                disabled={saving}
              >
                Take it down
              </button>
            )}
          </div>
        </div>
      )}

      {mayWrite && editingId === null && (
        <button
          type="button"
          className="text-sm text-brand-300 hover:text-brand-500 hover:underline"
          onClick={() => {
            setDraft("");
            setDraftColor("amber");
            setEditingId(0);
          }}
        >
          + Leave a note for the counter
        </button>
      )}

      <ConfirmModal
        open={confirmTake !== null}
        danger
        busy={saving}
        title="Take this note down?"
        confirmLabel="Take it down"
        onCancel={() => setConfirmTake(null)}
        onConfirm={() => {
          if (confirmTake) void takeDown(confirmTake.id).then(() => setConfirmTake(null));
        }}
      >
        <p className="text-sm text-brand-400">
          {confirmTake ? `It is ${confirmTake.by}'s note. It comes down signed with your name.` : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}

/**
 * The corkboard's story as a modal, for the 🗒️ square on Main. The same
 * fifty rows the Settings card reads, fetched when opened — the history is
 * looked at when something is missed, not on every visit to the board.
 */
export function NotesStoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [story, setStory] = useState<
    | {
        id: number;
        by: string;
        body: string;
        putUp: string;
        takenDownBy: string | null;
        takenDownAt: string | null;
      }[]
    | null
  >(null);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    void (async () => {
      const res = await fetch("/api/pos/notice/history");
      if (res.ok && !stale)
        setStory(((await res.json()) as { story: NonNullable<typeof story> }).story ?? []);
    })();
    return () => {
      stale = true;
    };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="The notes that came down" width={560}>
      {story === null ? (
        <div className="text-brand-300 py-6 text-center">Reading the story…</div>
      ) : story.length === 0 ? (
        <div className="text-brand-300 py-6 text-center">Nothing has been taken down yet.</div>
      ) : (
        <div className="divide-y divide-brand-100">
          {story.map((s) => (
            <div key={s.id} className="py-2 text-sm">
              <div className="text-brand-500 whitespace-pre-wrap">{rich(s.body)}</div>
              <div className="text-xs text-brand-300 mt-0.5">
                {s.by} · {whenWritten(s.putUp)} — taken down
                {s.takenDownBy ? ` by ${s.takenDownBy}` : ""} {s.takenDownAt ? whenWritten(s.takenDownAt) : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
