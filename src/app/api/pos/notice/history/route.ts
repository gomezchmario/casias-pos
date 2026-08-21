import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";

/**
 * The notes that came down — the corkboard's story.
 *
 * Owner-level, on the settings screen rather than the board itself: the
 * board is for what stands, and a public archive under it would tempt
 * people to write for the record instead of for the counter. But "who took
 * my note down, and when" is a real question, and the rows have kept the
 * answer since the day the board learned to keep them.
 */
export async function GET() {
  const auth = await requirePos("manageSettings");
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    story: getDb()
      .prepare(
        `SELECT id, author_name AS by, body, color,
                created_at AS putUp,
                taken_down_by_name AS takenDownBy,
                taken_down_at AS takenDownAt
           FROM pos_notices
          WHERE taken_down_at IS NOT NULL
          ORDER BY taken_down_at DESC
          LIMIT 50`,
      )
      .all(),
  });
}
