import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { allGrants, grantCapability, revokeCapability } from "@/lib/grants";
import { getDb } from "@/lib/db";
import type { PosRole } from "@/lib/roles";

/**
 * Capabilities handed to one person, over and above their role.
 *
 * Behind `managePermissions`, which only an owner has and which is deliberately
 * NOT the same as being able to change somebody's role. Moving a person between
 * jobs is an ordinary act of running a shop; deciding that one named cashier may
 * read what the shop makes is not, and the two should not share a gate.
 *
 * A POS route rather than an admin one even though the permissions SCREEN lives
 * in the back office, because the thing being decided is a POS capability and
 * the person deciding is signed in with a PIN. The admin password gates the time
 * clock's own back office; it has never gated the register's permission model
 * and should not start here.
 */
export async function GET() {
  const auth = await requirePos("managePermissions");
  if (!auth.ok) return auth.response;

  const employees = getDb()
    .prepare(
      `SELECT id, name, pos_role AS posRole, active
         FROM employees
        WHERE deleted = 0
     ORDER BY active DESC, name`,
    )
    .all() as { id: number; name: string; posRole: PosRole; active: number }[];

  const grants = allGrants();
  return NextResponse.json({
    employees: employees.map((e) => ({ ...e, grants: grants.get(e.id) ?? [] })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("managePermissions");
  if (!auth.ok) return auth.response;

  let body: { employeeId?: number; capability?: string; grant?: boolean; note?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const employeeId = Number(body.employeeId);
  if (!Number.isInteger(employeeId)) return jsonError("Which person?");
  if (!body.capability) return jsonError("Which permission?");

  const done = body.grant
    ? grantCapability(auth.user, employeeId, body.capability, body.note)
    : revokeCapability(auth.user, employeeId, body.capability);
  if (!done.ok) return jsonError(done.error);

  const grants = allGrants();
  return NextResponse.json({ ok: true, grants: grants.get(employeeId) ?? [] });
}
