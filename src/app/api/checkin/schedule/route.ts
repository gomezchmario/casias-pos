import { NextResponse } from "next/server";
import { verifyKioskPin } from "@/lib/pos-session";
import { mySchedule, phoneOf, phoneWords } from "@/lib/shift-desk";

/**
 * The employee's own window on the roster, opened with the PIN and nothing
 * else — no session, no fence. NOT FENCED ON PURPOSE: the fence proves a
 * PUNCH happened at the shop, and the whole point of this screen is the
 * person on their couch at six in the morning saying they cannot come in.
 * Reading your own week from home is the feature, not the leak.
 *
 * THE PHONE GATE LIVES HERE. Until the shop has a number for this person the
 * response carries `needsPhone` and none of the schedule, which is what makes
 * the rule real on every client at once: there is no screen to scroll past,
 * because there is nothing to scroll.
 */
export async function POST(req: Request) {
  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = verifyKioskPin(String(body.pin ?? ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
  if (result.user.role === "viewer")
    return NextResponse.json(
      { error: "This account looks at screens; it does not work shifts." },
      { status: 403 },
    );

  const phone = phoneOf(result.user.employeeId);
  if (!phone) {
    return NextResponse.json({ ok: true, needsPhone: true, name: result.user.name });
  }

  const panel = mySchedule(result.user.employeeId);
  return NextResponse.json({
    ok: true,
    needsPhone: false,
    name: result.user.name,
    phone: phoneWords(phone),
    ...panel,
  });
}
