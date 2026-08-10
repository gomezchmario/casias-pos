import { NextResponse } from "next/server";
import { getSession } from "./session";
import { autoCloseStaleShifts } from "./auto-close";
import { getPosUser, type PosUser } from "./pos-session";
import { type Capability } from "./roles";
import { userCan } from "./grants";
import type { Actor } from "./audit";

export type ApiAdmin = { adminId: number; username: string };

export async function requireAdminApi(): Promise<
  { ok: true; admin: ApiAdmin } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session.adminId) {
    return { ok: false, response: jsonError("Not signed in", 401) };
  }
  return {
    ok: true,
    admin: { adminId: session.adminId, username: session.username ?? "" },
  };
}

/**
 * Guard every POS route by capability rather than by role name, so the
 * permission model lives in one place (src/lib/roles.ts) instead of being
 * scattered across handlers.
 */
export async function requirePos(
  capability: Capability,
): Promise<{ ok: true; user: PosUser; actor: Actor } | { ok: false; response: NextResponse }> {
  const user = await getPosUser();
  if (!user) {
    return { ok: false, response: jsonError("Not signed in", 401) };
  }
  // `userCan`, not `can`: the second knows about roles and cannot see a
  // capability granted to one person. Every gate in the app comes through here,
  // so this one line is what makes a personal grant real.
  if (!userCan(user, capability)) {
    return { ok: false, response: jsonError("You don't have permission to do that", 403) };
  }
  return {
    ok: true,
    user,
    actor: {
      type: "employee",
      employeeId: user.employeeId,
      name: user.name,
      role: user.role,
    },
  };
}

let lastAutoCloseAt = 0;
const AUTO_CLOSE_INTERVAL_MS = 60_000; // at most once per minute

/**
 * Run auto-close opportunistically. Throttled so we don't pay the query cost
 * on every single request.
 */
export function maybeAutoClose(): void {
  const now = Date.now();
  if (now - lastAutoCloseAt < AUTO_CLOSE_INTERVAL_MS) return;
  lastAutoCloseAt = now;
  try {
    autoCloseStaleShifts();
  } catch (e) {
    console.error("[auto-close]", e);
  }
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
