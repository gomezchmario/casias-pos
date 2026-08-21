import { NextRequest, NextResponse } from "next/server";
import { requirePos, jsonError } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { logActorAudit } from "@/lib/audit";
import { nowLocalIso } from "@/lib/time";
import { inTx } from "@/lib/tx";

/**
 * The corkboard above the register.
 *
 * It was one standing note in a pair of settings keys, and the shop outgrew
 * it: the owner wants his note and a manager's note up at once. So — ONE
 * ACTIVE NOTE PER AUTHOR, which is what keeps a board from becoming a feed:
 * writing again replaces your note rather than piling a new one on, and the
 * board can never hold more notes than the shop holds people who may write.
 *
 * NO LENGTH CAP, by the owner's instruction. The old 500-character ceiling
 * assumed a notice long enough to scroll was a conversation; the owner's
 * actual morning note was four sentences of checklist and the cap was
 * cutting the fourth.
 *
 * Taking a note down is soft and signed — anyone who may write may take any
 * note down, and the row keeps who did it. "Who removed my note" is exactly
 * the question a shared board gets asked.
 */

const PALETTE = ["amber", "mint", "sky", "rose", "lilac", "sand"] as const;
type NoteColor = (typeof PALETTE)[number];

export type BoardNote = {
  id: number;
  employeeId: number | null;
  by: string;
  body: string;
  color: NoteColor;
  at: string;
  /** Whether the caller wrote it — shaped here so the board needn't guess. */
  mine: boolean;
};

function listActive(meId: number): BoardNote[] {
  return (
    getDb()
      .prepare(
        `SELECT id, employee_id AS employeeId, author_name AS by, body, color,
                updated_at AS at
           FROM pos_notices
          WHERE taken_down_at IS NULL
          ORDER BY created_at`,
      )
      .all() as Omit<BoardNote, "mine">[]
  ).map((n) => ({
    ...n,
    color: (PALETTE as readonly string[]).includes(n.color) ? (n.color as NoteColor) : "amber",
    mine: n.employeeId === meId,
  }));
}

export async function GET() {
  // Anyone who can open the main screen can read it. It is written *for* them.
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ notes: listActive(auth.user.employeeId) });
}

/** Write or rewrite YOUR note. An empty body takes your own note down. */
export async function PUT(req: NextRequest) {
  const auth = await requirePos("writeNotice");
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as { text?: unknown; color?: unknown };
  if (typeof body.text !== "string") return jsonError("Text is required");
  const text = body.text.trim();
  const color: NoteColor = (PALETTE as readonly string[]).includes(String(body.color))
    ? (body.color as NoteColor)
    : "amber";

  const db = getDb();
  const now = nowLocalIso();
  const mine = db
    .prepare(
      "SELECT id, body, color FROM pos_notices WHERE employee_id = ? AND taken_down_at IS NULL",
    )
    .get(auth.user.employeeId) as { id: number; body: string; color: string } | undefined;

  inTx(() => {
    if (text === "") {
      if (mine) {
        db.prepare(
          `UPDATE pos_notices SET taken_down_by = ?, taken_down_by_name = ?, taken_down_at = ?
            WHERE id = ?`,
        ).run(auth.user.employeeId, auth.user.name, now, mine.id);
      }
    } else if (mine) {
      db.prepare("UPDATE pos_notices SET body = ?, color = ?, updated_at = ? WHERE id = ?").run(
        text,
        color,
        now,
        mine.id,
      );
    } else {
      db.prepare(
        `INSERT INTO pos_notices (employee_id, author_name, body, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(auth.user.employeeId, auth.user.name, text, color, now, now);
    }
    logActorAudit(auth.actor, {
      action: "settings.update",
      targetType: "setting",
      targetId: "pos_notice",
      before: mine ? { body: mine.body, color: mine.color } : null,
      after: text === "" ? null : { body: text, color },
    });
  });

  return NextResponse.json({ notes: listActive(auth.user.employeeId) });
}

/** Take ANY note down — signed, kept, audited. */
export async function DELETE(req: NextRequest) {
  const auth = await requirePos("writeNotice");
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return jsonError("Which note?");

  const db = getDb();
  const note = db
    .prepare("SELECT id, author_name, body FROM pos_notices WHERE id = ? AND taken_down_at IS NULL")
    .get(id) as { id: number; author_name: string; body: string } | undefined;
  if (!note) return jsonError("That note is already down", 409);

  inTx(() => {
    db.prepare(
      `UPDATE pos_notices SET taken_down_by = ?, taken_down_by_name = ?, taken_down_at = ?
        WHERE id = ?`,
    ).run(auth.user.employeeId, auth.user.name, nowLocalIso(), id);
    logActorAudit(auth.actor, {
      action: "settings.update",
      targetType: "setting",
      targetId: "pos_notice",
      before: { author: note.author_name, body: note.body },
      after: null,
    });
  });

  return NextResponse.json({ notes: listActive(auth.user.employeeId) });
}
