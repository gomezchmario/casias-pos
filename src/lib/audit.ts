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
  | "pos.login"
  | "pos.login_failed"
  | "pos.logout"
  | "sale.create"
  | "sale.update"
  | "sale.complete"
  | "sale.void"
  | "sale.seq_update"
  | "sale.po_update"
  | "sale.delete"
  | "sale.fulfillment_change"
  | "sale_item.create"
  | "sale_item.update"
  | "sale_item.void"
  | "payment.create"
  | "payment.tip_adjustment"
  | "payment.refund"
  | "payment.purchase_payout"
  | "payment.reversal"
  | "payment.comm_override"
  | "shift.open"
  | "shift.close"
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
  | "vehicle.create"
  | "vehicle.update"
  | "vehicle.delete"
  | "payroll.lock"
  | "payroll.unlock";

/** Who did it. Snapshotted into the log so a later rename can't rewrite history. */
export type Actor =
  | { type: "admin"; adminId: number; username: string }
  | { type: "employee"; employeeId: number; name: string; role: PosRole }
  | { type: "system" };

export function logAudit(args: {
  adminId?: number | null;
  adminUsername?: string | null;
  actorType?: "admin" | "employee" | "system";
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
    employeeName: actor.type === "employee" ? actor.name : null,
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
