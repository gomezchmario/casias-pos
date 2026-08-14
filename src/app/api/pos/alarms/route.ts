import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { actOnAlarm, alarmBook } from "@/lib/alarms";
import { currentBusinessDate } from "@/lib/business-date";

/**
 * The alarm book over a range of days: one day, up to a week.
 *
 * The cap is refused rather than trimmed. Every day in the range is a full day
 * report re-judged from scratch — see `alarmBook`, which measured at about a
 * quarter of a second per day — so a week is the most that answers inside the
 * time a person will wait, and it is enough to see whether a thing that fired
 * this morning has been firing all week. Silently trimming would hand back an
 * answer about a shorter period than the one on screen, which is worse than
 * saying no.
 */
const MAX_DAYS = 7;

export async function GET(req: NextRequest) {
  const auth = await requirePos("reviewAlarms");
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams;
  const today = currentBusinessDate();
  const to = q.get("to") || today;
  const from = q.get("from") || to;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return jsonError("Those are not dates");
  if (from > to) return jsonError("That range runs backwards");

  const span =
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000 + 1;
  if (span > MAX_DAYS)
    return jsonError(`That is ${Math.round(span)} days. ${MAX_DAYS} is the most at once.`);

  // The same withholding as the close-out payload: an alarm the owner keeps
  // to themselves must not arrive in the log a manager can open.
  return NextResponse.json({ ...alarmBook(from, to, auth.user.role), today });
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("reviewAlarms");
  if (!auth.ok) return auth.response;

  let body: {
    businessDate?: string;
    code?: string;
    kind?: "dismiss" | "reopen";
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (body.kind !== "dismiss" && body.kind !== "reopen")
    return jsonError("A dismissal or a reopening, nothing else");

  const result = actOnAlarm(
    auth.user,
    body.businessDate ?? "",
    body.code ?? "",
    body.kind,
    body.note ?? "",
  );
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ ok: true });
}
