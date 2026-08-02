import { getDb } from "./db";
import { inTx } from "./tx";
import { diffRows, logActorAudit, type Actor } from "./audit";
import type { PosUser } from "./pos-session";

export type QuickButtonKind = "amount" | "service" | "product";

export type QuickButton = {
  id: number;
  label: string;
  kind: QuickButtonKind;
  amount_cents: number | null;
  description: string | null;
  category_id: number | null;
  product_id: number | null;
  sort_order: number;
  active: number;
};

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

const actorOf = (user: PosUser): Actor => ({
  type: "employee",
  employeeId: user.employeeId,
  name: user.name,
  role: user.role,
});

/** What the register shows. */
export function listQuickButtons(): QuickButton[] {
  return getDb()
    .prepare("SELECT * FROM quick_buttons WHERE active = 1 ORDER BY sort_order")
    .all() as QuickButton[];
}

/** What the editor shows — retired buttons included, so they can be brought back. */
export function listAllQuickButtons(): QuickButton[] {
  return getDb()
    .prepare("SELECT * FROM quick_buttons ORDER BY active DESC, sort_order")
    .all() as QuickButton[];
}

export function getQuickButton(id: number): QuickButton | undefined {
  return getDb().prepare("SELECT * FROM quick_buttons WHERE id = ?").get(id) as
    | QuickButton
    | undefined;
}

/**
 * The schema requires an amount on an 'amount' button and a description on a
 * 'service' one, so reject those here with a readable message rather than
 * letting the CHECK constraint surface as a 500.
 */
function validate(args: {
  label: string;
  kind: QuickButtonKind;
  amountCents: number | null;
  description: string | null;
}): string | null {
  if (!args.label.trim()) return "Give the button a label";
  if (args.kind === "amount") {
    if (args.amountCents === null) return "An amount button needs a price";
    if (!Number.isInteger(args.amountCents) || args.amountCents < 0)
      return "That price is not valid";
  }
  if (args.kind === "service" && !args.description?.trim())
    return "A service button needs the line text it puts on the ticket";
  if (args.kind === "product") return "Product buttons are set up from the product list";
  return null;
}

export function createQuickButton(
  user: PosUser,
  args: {
    label: string;
    kind: QuickButtonKind;
    amountCents?: number | null;
    description?: string | null;
    sortOrder?: number;
  },
): Result<{ button: QuickButton }> {
  const amountCents = args.amountCents ?? null;
  const description = args.description?.trim() || null;
  const invalid = validate({
    label: args.label,
    kind: args.kind,
    amountCents,
    description,
  });
  if (invalid) return { ok: false, error: invalid };

  return inTx(() => {
    const db = getDb();
    // Land new buttons at the end of the grid unless a slot was asked for.
    const sortOrder =
      args.sortOrder ??
      ((
        db
          .prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM quick_buttons")
          .get() as { n: number }
      ).n);

    const info = db
      .prepare(
        `INSERT INTO quick_buttons (label, kind, amount_cents, description, sort_order, active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(args.label.trim(), args.kind, amountCents, description, sortOrder);

    const id = Number(info.lastInsertRowid);
    const button = getQuickButton(id)!;
    logActorAudit(actorOf(user), {
      action: "quick_button.create",
      targetType: "setting",
      targetId: id,
      details: { label: button.label, kind: button.kind },
      after: { ...button },
    });
    return { ok: true as const, button };
  });
}

export function updateQuickButton(
  user: PosUser,
  id: number,
  args: {
    label?: string;
    amountCents?: number | null;
    description?: string | null;
    sortOrder?: number;
    active?: boolean;
  },
): Result<{ button: QuickButton }> {
  const before = getQuickButton(id);
  if (!before) return { ok: false, error: "Button not found" };

  const next = {
    label: args.label !== undefined ? args.label.trim() : before.label,
    amountCents:
      args.amountCents !== undefined ? args.amountCents : before.amount_cents,
    description:
      args.description !== undefined
        ? args.description?.trim() || null
        : before.description,
    sortOrder: args.sortOrder !== undefined ? args.sortOrder : before.sort_order,
    active: args.active !== undefined ? (args.active ? 1 : 0) : before.active,
  };

  const invalid = validate({
    label: next.label,
    kind: before.kind,
    amountCents: next.amountCents,
    description: next.description,
  });
  if (invalid) return { ok: false, error: invalid };

  return inTx(() => {
    getDb()
      .prepare(
        `UPDATE quick_buttons
            SET label = ?, amount_cents = ?, description = ?, sort_order = ?, active = ?
          WHERE id = ?`,
      )
      .run(
        next.label,
        next.amountCents,
        next.description,
        next.sortOrder,
        next.active,
        id,
      );

    const button = getQuickButton(id)!;
    const diff = diffRows(before, button);
    logActorAudit(actorOf(user), {
      action:
        next.active === 0 && before.active === 1
          ? "quick_button.deactivate"
          : "quick_button.update",
      targetType: "setting",
      targetId: id,
      details: { label: button.label },
      before: diff?.before ?? null,
      after: diff?.after ?? null,
    });
    return { ok: true as const, button };
  });
}
