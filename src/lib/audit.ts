import { getDb } from "./db";
import { nowLocalIso } from "./time";
import type { PosRole } from "./roles";

export type AuditAction =
  // time clock (existing)
  | "admin.login"
  | "admin.logout"
  | "admin.password_change"
  | "employee.create"
  | "employee.update"
  | "employee.deactivate"
  | "employee.activate"
  | "employee.delete"
  | "employee.pin_reset"
  | "entry.create"
  | "entry.update"
  | "entry.delete"
  | "entry.unflag"
  | "entry.flag"
  | "settings.update"
  | "system.auto_close"
  // POS
  | "employee.pos_role_change"
  // The roster: who was put on a day, taken off one, or a week copied
  // forward. Worth logging for the same reason a pay change is — one person
  // changes it from a form, and "who moved me off Saturday" is a question that
  // gets asked.
  | "schedule.set"
  | "schedule.clear"
  | "schedule.copy"
  // One capability handed to one person, over and above their role — see
  // grants.ts. Its own pair of actions because "who gave Patricia the reports"
  // is a question somebody will ask, and a role change is a different event.
  | "employee.capability_grant"
  | "employee.capability_revoke"
  | "pos.login"
  | "pos.login_failed"
  | "pos.logout"
  | "sale.create"
  | "sale.update"
  | "sale.complete"
  // A finished ticket put back into the open state so it can be added to. Its
  // own action because "who reopened this" is the first question asked when a
  // day's takings change after it was counted.
  | "sale.reopen"
  | "sale.void"
  | "sale.discount"
  | "sale.seq_update"
  | "sale.po_update"
  | "sale.delete"
  | "sale.fulfillment_change"
  | "sale.work_status_change"
  | "sale_item.create"
  | "sale_item.update"
  | "sale_item.void"
  | "payment.create"
  | "payment.tip_adjustment"
  | "payment.refund"
  | "payment.purchase_payout"
  | "payment.reversal"
  | "payment.correct"
  | "payment.comm_override"
  | "payment.seq_update"
  // A tip taken back off a ticket. Its own action rather than payment.correct:
  // "who removed a tip" is a question somebody will ask about their own money.
  | "payment.tip_removed"
  // A tip credited to the wrong technician and moved to the right one. Its
  // own action because "who moved my tip" is a question about somebody's pay,
  // and it must not be answered by searching for a removal that never happened.
  | "payment.tip_reassigned"
  // Which cashier a payment is credited to, corrected after the fact. Its own
  // action because it moves no money at all — only the name on the takings —
  // and a log searched for a money correction must not return it.
  | "payment.cashier_reassign"
  | "shift.open"
  | "shift.close"
  | "drawer.withdraw"
  | "drawer.deposit"
  | "drawer.reversal"
  // A cash-in/out row taken off the day entirely, rather than reversed. For
  // test rows that never moved money: a reversal would leave two entries on a
  // sheet somebody reads, both describing something that did not happen.
  | "drawer.delete"
  // The words on a cash-in/out row corrected, with the amount untouched. Its
  // own action so that a log searched for money moving does not return a
  // relabelling, and vice versa.
  | "drawer.update"
  | "register_check.create"
  | "register_check.delete"
  | "register_check.replace"
  | "product.create"
  | "product.update"
  | "product.delete"
  | "quick_button.create"
  | "quick_button.update"
  | "quick_button.deactivate"
  | "inventory.receive"
  | "inventory.adjust"
  | "inventory.count"
  | "inventory.oversell"
  | "inventory.review"
  | "customer.create"
  | "customer.update"
  | "customer.delete"
  // Money against a house account, which is not a payment against a ticket and
  // must not be searched for as one.
  | "account.payment"
  | "account.reversal"
  // A dead row taken off the day's log, and put back. Deliberately NOT
  // `entry.delete` — that one belongs to the time clock and means a shift was
  // removed, and a log searched for "who deleted an entry" must not return both.
  | "pos_entry.strike"
  | "pos_entry.restore"
  // A tire the shop was asked for and could not sell.
  | "tire_demand.record"
  // The company directory: a fleet's own window on its own account. Setting
  // and clearing the code are the shop's acts; the logins are the company's.
  | "dir.pin_set"
  | "dir.pin_clear"
  | "dir.login"
  | "dir.login_failed"
  | "dir.session_revoke"
  | "vehicle.create"
  | "vehicle.update"
  | "vehicle.delete"
  | "payroll.lock"
  | "payroll.unlock";

/** Who did it. Snapshotted into the log so a later rename can't rewrite history. */
export type Actor =
  | { type: "admin"; adminId: number; username: string }
  | { type: "employee"; employeeId: number; name: string; role: PosRole }
  /**
   * A company, signed into its own directory page with its own code.
   *
   * The fourth kind of actor, and the first that does not work here. A fleet
   * keeping its drivers and trucks straight is doing real work on real rows,
   * and the log has to be able to say so: "Williams Insulation corrected the
   * VIN" is the truth, where attributing it to whichever employee's session
   * happened to be handy would be a lie written into the one record kept
   * precisely so nobody has to take somebody's word for it.
   *
   * `customerId` rather than a name because names get corrected — including,
   * now, by the company itself.
   */
  | { type: "customer"; customerId: number; name: string }
  | { type: "system" };

export function logAudit(args: {
  adminId?: number | null;
  adminUsername?: string | null;
  actorType?: "admin" | "employee" | "customer" | "system";
  employeeId?: number | null;
  employeeName?: string | null;
  employeeRole?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string | number | null;
  details?: string | object | null;
  before?: object | null;
  after?: object | null;
}): void {
  const db = getDb();
  const asText = (v: string | object | null | undefined) =>
    v == null ? null : typeof v === "string" ? v : JSON.stringify(v);

  const actorType =
    args.actorType ??
    (args.employeeId != null ? "employee" : args.adminId != null ? "admin" : "system");

  db.prepare(
    `INSERT INTO audit_log (
       admin_id, admin_username, actor_type, employee_id, employee_name, employee_role,
       action, target_type, target_id, details, before_json, after_json, timestamp
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.adminId ?? null,
    args.adminUsername ?? null,
    actorType,
    args.employeeId ?? null,
    args.employeeName ?? null,
    args.employeeRole ?? null,
    args.action,
    args.targetType ?? null,
    args.targetId == null ? null : String(args.targetId),
    asText(args.details),
    asText(args.before),
    asText(args.after),
    nowLocalIso(),
  );
}

/**
 * The POS entry point. Every mutation goes through here, inside the same
 * transaction as the change itself, with the actor's role as it was at the
 * moment they acted.
 */
export function logActorAudit(
  actor: Actor,
  args: {
    action: AuditAction;
    targetType?: string;
    targetId?: string | number | null;
    details?: string | object | null;
    before?: object | null;
    after?: object | null;
  },
): void {
  logAudit({
    ...args,
    actorType: actor.type,
    adminId: actor.type === "admin" ? actor.adminId : null,
    adminUsername: actor.type === "admin" ? actor.username : null,
    employeeId: actor.type === "employee" ? actor.employeeId : null,
    /*
      A company writes its name into employee_name and nothing into
      employee_id. The column is misnamed for this actor and the row is still
      honest, because actor_type says 'customer' beside it and the log screen
      reads the pair — where inventing an employee id, or leaving the name
      blank, would each produce a row that cannot be read back to anybody.
      Renaming the column would rewrite every audit row the shop has ever
      written in order to fix a word, which is the worse trade.
    */
    employeeName:
      actor.type === "employee" || actor.type === "customer" ? actor.name : null,
    employeeRole: actor.type === "employee" ? actor.role : null,
  });
}

/** Field-level diff of two rows — only what actually changed reaches the log. */
export function diffRows<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  let changed = false;
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] === undefined) continue;
    if (before[key] !== after[key]) {
      b[key] = before[key];
      a[key] = after[key] as T[keyof T];
      changed = true;
    }
  }
  return changed ? { before: b, after: a } : null;
}

export type AuditEntry = {
  id: number;
  admin_id: number | null;
  admin_username: string | null;
  actor_type: string | null;
  employee_id: number | null;
  employee_name: string | null;
  employee_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  before_json: string | null;
  after_json: string | null;
  timestamp: string;
};

export function listAudit(limit = 200): AuditEntry[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(limit) as AuditEntry[];
}

/**
 * Full change history for one record — powers the "edited" trail on a sale.
 *
 * The String() is load-bearing, not decoration. target_id holds text, and
 * binding a number here matches NOTHING -- silently, with no error, returning
 * an empty history for a record that has plenty. Removing it would look like a
 * harmless cleanup and would quietly blank out every audit trail in the app.
 */
export function listAuditForTarget(targetType: string, targetId: string | number): AuditEntry[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM audit_log WHERE target_type = ? AND target_id = ? ORDER BY id DESC",
    )
    .all(targetType, String(targetId)) as AuditEntry[];
}
