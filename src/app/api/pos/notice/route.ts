import { NextRequest, NextResponse } from "next/server";
import { requirePos, jsonError } from "@/lib/api-helpers";
import { getSetting, setSetting } from "@/lib/settings";
import { logActorAudit } from "@/lib/audit";
import { nowLocalIso } from "@/lib/time";
import { inTx } from "@/lib/tx";

/**
 * The standing note above the register — "tire truck comes Thursday", "don't
 * take checks from the blue van". One note, not a feed: it stays up until
 * somebody changes it, which is the whole point. A list of dated messages
 * becomes a thing to scroll past, whereas one line that is always the current
 * line gets read.
 */
export type Notice = { text: string; by: string; at: string };

function readNotice(): Notice {
  return {
    text: getSetting("pos_notice"),
    by: getSetting("pos_notice_by"),
    at: getSetting("pos_notice_at"),
  };
}

export async function GET() {
  // Anyone who can open the main screen can read it. It is written *for* them.
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;
  return NextResponse.json(readNotice());
}

export async function PUT(req: NextRequest) {
  const auth = await requirePos("writeNotice");
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as { text?: unknown };
  if (typeof body.text !== "string") return jsonError("Text is required");

  // Trimmed, and capped at something that still fits on the screen it is drawn
  // on. A notice long enough to need scrolling is a conversation, not a notice.
  const text = body.text.trim().slice(0, 500);
  const before = readNotice();

  inTx(() => {
    setSetting("pos_notice", text);
    // Cleared along with the text so an empty board doesn't carry a stale
    // signature waiting to be attached to whatever gets written next.
    setSetting("pos_notice_by", text ? auth.user.name : "");
    setSetting("pos_notice_at", text ? nowLocalIso() : "");
    logActorAudit(auth.actor, {
      action: "settings.update",
      targetType: "setting",
      targetId: "pos_notice",
      before,
      after: readNotice(),
    });
  });

  return NextResponse.json(readNotice());
}
