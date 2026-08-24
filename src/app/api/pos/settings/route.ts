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
  settings: {
    posIdleLockSeconds: number;
    tireDemandEnabled: boolean;
    leaderboardShowTips: boolean;
    onclockAlarmEnabled: boolean;
    /** Minutes from midnight; 1110 = 6:30 PM. */
    onclockAlarmMinute: number;
  };
};

function read(): Payload {
  return {
    settings: {
      posIdleLockSeconds: Number(getSetting("pos_idle_lock_seconds")) || 900,
      tireDemandEnabled: getSetting("tire_demand_enabled") === "1",
      leaderboardShowTips: getSetting("leaderboard_show_tips") !== "0",
      onclockAlarmEnabled: getSetting("onclock_alarm_enabled") !== "0",
      onclockAlarmMinute: Number(getSetting("onclock_alarm_minute")) || 1110,
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

  const body = (await req.json().catch(() => ({}))) as {
    posIdleLockSeconds?: unknown;
    tireDemandEnabled?: unknown;
    leaderboardShowTips?: unknown;
    onclockAlarmEnabled?: unknown;
    onclockAlarmMinute?: unknown;
  };

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

  if (body.tireDemandEnabled !== undefined) {
    const on = body.tireDemandEnabled === true || body.tireDemandEnabled === "1";
    const before = getSetting("tire_demand_enabled");
    inTx(() => {
      setSetting("tire_demand_enabled", on ? "1" : "0");
      // Audited like any other switch. Turning the study off stops data being
      // collected, and somebody reading the report in six months will want to
      // know why the numbers stop where they do.
      logActorAudit(auth.actor, {
        action: "settings.update",
        targetType: "setting",
        targetId: "tire_demand_enabled",
        before: { enabled: before },
        after: { enabled: on ? "1" : "0" },
      });
    });
  }

  if (body.onclockAlarmEnabled !== undefined) {
    const on = body.onclockAlarmEnabled === true || body.onclockAlarmEnabled === "1";
    const before = getSetting("onclock_alarm_enabled");
    inTx(() => {
      setSetting("onclock_alarm_enabled", on ? "1" : "0");
      logActorAudit(auth.actor, {
        action: "settings.update",
        targetType: "setting",
        targetId: "onclock_alarm_enabled",
        before: { enabled: before },
        after: { enabled: on ? "1" : "0" },
      });
    });
  }

  if (body.onclockAlarmMinute !== undefined) {
    const n = Number(body.onclockAlarmMinute);
    if (!Number.isInteger(n) || n < 0 || n > 1439)
      return jsonError("That is not a time of day");
    const before = getSetting("onclock_alarm_minute");
    inTx(() => {
      setSetting("onclock_alarm_minute", String(n));
      logActorAudit(auth.actor, {
        action: "settings.update",
        targetType: "setting",
        targetId: "onclock_alarm_minute",
        before: { minute: before },
        after: { minute: String(n) },
      });
    });
  }

  if (body.leaderboardShowTips !== undefined) {
    const on = body.leaderboardShowTips === true || body.leaderboardShowTips === "1";
    const before = getSetting("leaderboard_show_tips");
    inTx(() => {
      setSetting("leaderboard_show_tips", on ? "1" : "0");
      // Off means the public endpoint stops SENDING tip figures, not that a
      // screen stops drawing them — see the endpoint. Audited because a wall
      // that suddenly stops showing tips is a question somebody will ask.
      logActorAudit(auth.actor, {
        action: "settings.update",
        targetType: "setting",
        targetId: "leaderboard_show_tips",
        before: { enabled: before },
        after: { enabled: on ? "1" : "0" },
      });
    });
  }

  return NextResponse.json(read());
}
