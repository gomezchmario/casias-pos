import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { logActorAudit, type Actor } from "./audit";
import { CAPABILITIES, can, roleAtLeast, type Capability, type PosRole } from "./roles";
import type { PosUser } from "./pos-session";

/**
 * Capabilities given to one person, over and above their role.
 *
 * The third and smallest layer of the permission model. The ladder says what a
 * job can do and the two role-wide lists carve the exceptions; this says
 * "Patricia specifically may see the management reports" — a sentence the other
 * two cannot express without promoting her, which would hand over voids,
 * refunds, receiving and the close-out on the way past.
 *
 * THREE RULES, and the whole design is in them:
 *
 *   A grant only ADDS. There is no personal denial, because a role is a job and
 *   a job somebody has to be individually stopped from doing parts of is the
 *   wrong job for them. Taking something away is still done by moving them.
 *
 *   WITHHELD beats it. A capability a role is denied outright stays denied
 *   however it is granted — a denial any grant could override would not be one.
 *
 *   Only an owner may grant. This is the control that decides who sees what the
 *   shop paid and what it makes, and it is not delegated.
 */

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

const actorOf = (user: PosUser): Actor => ({
  type: "employee",
  employeeId: user.employeeId,
  name: user.name,
  role: user.role,
});

/** Everything granted personally to one employee. Empty for nearly everybody. */
export function grantsFor(employeeId: number): Set<Capability> {
  const rows = getDb()
    .prepare("SELECT capability FROM employee_capabilities WHERE employee_id = ?")
    .all(employeeId) as { capability: string }[];
  // Filtered against the live list, so a capability renamed or removed in code
  // does not leave a stale row quietly granting something that no longer means
  // what it says.
  return new Set(
    rows.map((r) => r.capability).filter((c): c is Capability => c in CAPABILITIES),
  );
}

/** Everyone's grants at once, for the screen that shows the whole shop. */
export function allGrants(): Map<number, Capability[]> {
  const rows = getDb()
    .prepare("SELECT employee_id AS id, capability FROM employee_capabilities ORDER BY employee_id")
    .all() as { id: number; capability: string }[];
  const out = new Map<number, Capability[]>();
  for (const r of rows) {
    if (!(r.capability in CAPABILITIES)) continue;
    const list = out.get(r.id) ?? [];
    list.push(r.capability as Capability);
    out.set(r.id, list);
  }
  return out;
}

/**
 * The real answer for one person: their role, plus anything granted to them.
 *
 * THE ONE FUNCTION EVERY GATE SHOULD ASK. `can(role, capability)` is still
 * correct about roles and is what the permissions screen renders from, but it
 * cannot see a personal grant — so anything deciding whether THIS user may do
 * THIS thing has to come through here or the grant is invisible to it.
 */
export function userCan(
  user: { employeeId: number; role: PosRole },
  capability: Capability,
): boolean {
  // The role's answer first, which already applies WITHHELD and the role-wide
  // grants. A yes here costs no database read at all, which is the common case.
  if (can(user.role, capability)) return true;
  // A personal grant cannot revive something the role is denied by name.
  if (deniedOutright(user.role, capability)) return false;
  return grantsFor(user.employeeId).has(capability);
}

/**
 * Denied by name, as opposed to merely out of reach by rank.
 *
 * `can` applies WITHHELD before it looks at rank — so a role that CLEARS the
 * capability's minimum and is still refused has been refused deliberately, and
 * that refusal is the kind no grant may lift. A role that is simply too junior
 * fails the same `can` for a completely different reason, and that one a grant
 * exists to lift.
 *
 * Derived rather than reading the denial list, which `roles.ts` keeps private.
 * A second copy of it here is a second thing to keep in step, and the copy
 * would be the one that went stale.
 */
function deniedOutright(role: PosRole, capability: Capability): boolean {
  return roleAtLeast(role, CAPABILITIES[capability]) && !can(role, capability);
}

/**
 * Give somebody a capability their role does not carry.
 *
 * Refused where the role is denied it outright — see the rules at the top. The
 * refusal names the reason rather than failing quietly, because the person
 * ticking the box is deciding who can touch money and is entitled to know why
 * the answer is no.
 */
export function grantCapability(
  user: PosUser,
  employeeId: number,
  capability: string,
  note?: string,
): Result {
  if (user.role !== "owner")
    return { ok: false, error: "Only the owner can hand out a permission" };
  if (!(capability in CAPABILITIES)) return { ok: false, error: "No such permission" };
  const cap = capability as Capability;

  const db = getDb();
  const who = db
    .prepare("SELECT id, name, pos_role FROM employees WHERE id = ?")
    .get(employeeId) as { id: number; name: string; pos_role: PosRole } | undefined;
  if (!who) return { ok: false, error: "That person doesn't exist" };

  if (deniedOutright(who.pos_role, cap))
    return {
      ok: false,
      error: `A ${who.pos_role} is deliberately kept out of that, so it cannot be granted. Change their role instead.`,
    };
  if (can(who.pos_role, cap))
    return { ok: false, error: `A ${who.pos_role} already has that` };

  return inTx(() => {
    db.prepare(
      `INSERT INTO employee_capabilities (employee_id, capability, granted_by, granted_at, note)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (employee_id, capability) DO NOTHING`,
    ).run(employeeId, cap, user.employeeId, nowLocalIso(), note?.trim() || null);

    logActorAudit(actorOf(user), {
      action: "employee.capability_grant",
      targetType: "employee",
      targetId: employeeId,
      details: { name: who.name, role: who.pos_role, capability: cap, note: note?.trim() || null },
    });
    return { ok: true as const };
  });
}

/** Take one back. The row goes; the audit log keeps both halves of the story. */
export function revokeCapability(
  user: PosUser,
  employeeId: number,
  capability: string,
): Result {
  if (user.role !== "owner")
    return { ok: false, error: "Only the owner can take a permission back" };

  const db = getDb();
  const who = db.prepare("SELECT id, name FROM employees WHERE id = ?").get(employeeId) as
    | { id: number; name: string }
    | undefined;
  if (!who) return { ok: false, error: "That person doesn't exist" };

  return inTx(() => {
    const info = db
      .prepare("DELETE FROM employee_capabilities WHERE employee_id = ? AND capability = ?")
      .run(employeeId, capability);
    if (info.changes === 0) return { ok: false as const, error: "They did not have that" };

    logActorAudit(actorOf(user), {
      action: "employee.capability_revoke",
      targetType: "employee",
      targetId: employeeId,
      details: { name: who.name, capability },
    });
    return { ok: true as const };
  });
}
