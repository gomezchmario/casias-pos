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

/**
 * Pin a new note, or rewrite one of your own.
 *
 * As many notes as you like — the one-per-author rule lasted an afternoon
 * before the owner wanted his checklist AND a reminder up as two cards. With
 * an `id` this edits that note, and only its author may: rewriting somebody
 * else's words under their signature would put words in their mouth. Taking
 * a note down is DELETE's job, whoever wrote it.
 */
export async function PUT(req: NextRequest) {
  const auth = await requirePos("writeNotice");
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as { id?: unknown; text?: unknown; color?: unknown };
  if (typeof body.text !== "string" || body.text.trim() === "")
    return jsonError("Write something — taking a note down is its own button");
  const text = body.text.trim();
  const color: NoteColor = (PALETTE as readonly string[]).includes(String(body.color))
    ? (body.color as NoteColor)
    : "amber";

  const db = getDb();
  const now = nowLocalIso();

  if (body.id !== undefined) {
    const id = Number(body.id);
    const note = db
      .prepare(
        "SELECT id, employee_id AS by, body, color FROM pos_notices WHERE id = ? AND taken_down_at IS NULL",
      )
      .get(id) as { id: number; by: number | null; body: string; color: string } | undefined;
    if (!note) return jsonError("That note is already down", 409);
    if (note.by !== auth.user.employeeId)
      return jsonError("Only whoever wrote a note can rewrite it", 403);
    inTx(() => {
      db.prepare("UPDATE pos_notices SET body = ?, color = ?, updated_at = ? WHERE id = ?").run(
        text,
        color,
        now,
        id,
      );
      logActorAudit(auth.actor, {
        action: "settings.update",
        targetType: "setting",
        targetId: "pos_notice",
        before: { body: note.body, color: note.color },
        after: { body: text, color },
      });
    });
  } else {
    inTx(() => {
      db.prepare(
        `INSERT INTO pos_notices (employee_id, author_name, body, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(auth.user.employeeId, auth.user.name, text, color, now, now);
      logActorAudit(auth.actor, {
        action: "settings.update",
        targetType: "setting",
        targetId: "pos_notice",
        before: null,
        after: { body: text, color },
      });
    });
  }

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
