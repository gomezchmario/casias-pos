import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { getSetting, setSetting } from "@/lib/settings";
import { logActorAudit } from "@/lib/audit";
import { inTx } from "@/lib/tx";

/**
 * The handful of shop settings that belong to the register rather than to the
 * admin site.
 *
 * There is already a settings API at `/api/settings`, and this is not a
 * duplicate of it: that one is behind the admin password and edits everything,
 * including payroll and photo retention. This one is behind a POS session and
 * exposes exactly the knobs somebody standing at the counter has a reason to
 * turn. Whitelisting one at a time is the point — a generic "write any setting"
 * endpoint reachable with a PIN would put the tax rate one fetch away.
 */

type Payload = {
  settings: { posIdleLockSeconds: number };
};

function read(): Payload {
  return {
    settings: {
      posIdleLockSeconds: Number(getSetting("pos_idle_lock_seconds")) || 900,
    },
  };
}

export async function GET() {
  const auth = await requirePos("manageSettings");
  if (!auth.ok) return auth.response;
  return NextResponse.json(read());
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePos("manageSettings");
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { posIdleLockSeconds?: unknown };

  if (body.posIdleLockSeconds !== undefined) {
    const n = Number(body.posIdleLockSeconds);
    if (!Number.isInteger(n)) return jsonError("That is not a number of seconds");
    // A minute is the floor because anything less locks the register while
    // somebody is reading the screen in front of them, and the first thing a
    // shop does with a lock that fires mid-ticket is find a way to disable it.
    if (n < 60) return jsonError("The lock cannot be quicker than a minute");
    // Eight hours is a shift. Past that it is not a lock, it is a setting that
    // says "off" while looking like it says a number.
    if (n > 8 * 60 * 60) return jsonError("Use something under eight hours");

    const before = getSetting("pos_idle_lock_seconds");
    inTx(() => {
      setSetting("pos_idle_lock_seconds", String(n));
      logActorAudit(auth.actor, {
        action: "settings.update",
        targetType: "setting",
        targetId: "pos_idle_lock_seconds",
        before: { seconds: before },
        after: { seconds: String(n) },
      });
    });
  }

  return NextResponse.json(read());
}
