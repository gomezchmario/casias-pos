import { NextResponse } from "next/server";
import { getSession } from "./session";
import { autoCloseStaleShifts } from "./auto-close";
import { getPosUser, type PosUser } from "./pos-session";
import { VIEWER_MAY, type Capability } from "./roles";
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
    return {
      ok: false,
      response: jsonError(
        /*
          A viewer is told what kind of account they are on, not that they lack
          a permission. "You don't have permission" invites somebody to go and
          ask for it; this account is not short of a permission, it is the wrong
          shape for the request, and saying so is the difference between a
          person understanding the screen and a person filing a ticket.
        */
        user.role === "viewer"
          ? "Not saved — this account can look at everything and change nothing."
          : "You don't have permission to do that",
        403,
      ),
    };
  }

  /*
    THE SECOND LOCK, and it is deliberately not the same key as the first.

    Above, a viewer is refused because the capability is not on its list. Here
    it is refused because a read-only account has no business behind a capability
    that writes, whatever the list says. Two independent reasons, so a mistake in
    either one — a write capability added to VIEWER_MAY by accident, a new route
    guarded by a read capability it should not be — is caught by the other.

    The rule is the capability's own minimum rank: anything a technician may do
    is a lookup, and everything this account is allowed already sits in
    VIEWER_MAY. So rather than classify fifty capabilities twice, the allowlist
    IS the classification, and this asserts it a second time at the door.
  */
  if (user.role === "viewer" && !VIEWER_MAY.has(capability)) {
    return {
      ok: false,
      response: jsonError(
        "Not saved — this account can look at everything and change nothing.",
        403,
      ),
    };
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
