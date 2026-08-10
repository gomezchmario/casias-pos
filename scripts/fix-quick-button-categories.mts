/**
 * Put three repurposed buttons back in the column they belong to, and correct
 * the lines they mis-booked.
 *
 * A quick button carries two independent things: the label the counter reads
 * and the category the reports add it up under. Until today the editor could
 * change the first and not the second, so a button that was renamed kept on
 * meaning whatever it used to mean. The audit log has it exactly:
 *
 *   #1708  2026-08-07 16:44:20  btn 17  {"active":0} -> {"active":1}
 *   #1709  2026-08-07 16:44:25  btn 17  {"label":"NEW TIRE"} -> {"label":"AIR"}
 *
 * Button 17 is the one seeded as NEW TIRE with category `new_tire`. Reactivated,
 * relabelled AIR, and still booking new tires. MOUNT and BALANCE are the same
 * story on the seeded OIL FS and OIL M1 buttons, still booking oil changes.
 *
 * Two repairs, and they are separate. The buttons are wrong going forward; the
 * lines already rung are wrong in the books. Fixing only the first would leave
 * today's close-out claiming eight new tires that were air.
 *
 * The lines are matched on description AND the wrong category together, so a
 * line somebody rang correctly is never touched. It is deliberately narrow: it
 * leaves alone the AIR lines that are already `other` or uncategorised, because
 * an uncategorised line falls into Other in every report anyway and rewriting it
 * would be churn on a completed ticket for no change in any number.
 *
 * Every change writes its own audit row against the employee it is attributed
 * to. Nothing here is silent, because a script that quietly edits completed
 * tickets is indistinguishable from the bug it is fixing.
 *
 * DRY RUN unless given --commit.
 */

import { getDb } from "../src/lib/db.ts";
import { inTx } from "../src/lib/tx.ts";
import { logActorAudit, type Actor } from "../src/lib/audit.ts";
import { updateQuickButton } from "../src/lib/quick-buttons.ts";
import type { PosUser } from "../src/lib/pos-session.ts";

const commit = process.argv.includes("--commit");
const db = getDb();

/** The buttons, named with the label they must still carry for this to run. */
const BUTTONS = [
  { id: 17, label: "AIR", wrong: "new_tire" },
  { id: 14, label: "MOUNT", wrong: "oil_change" },
  { id: 16, label: "BALANCE", wrong: "oil_change" },
];

const cats = db.prepare("SELECT id, code, label FROM service_categories").all() as {
  id: number;
  code: string;
  label: string;
}[];
const byCode = new Map(cats.map((c) => [c.code, c]));
const other = byCode.get("other");
if (!other) throw new Error("No 'other' service category to move these to");

const owner = db
  .prepare("SELECT id, name FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id")
  .get() as { id: number; name: string } | undefined;
if (!owner) throw new Error("No active owner to attribute this to");
const user: PosUser = { employeeId: owner.id, name: owner.name, role: "owner" };
const actor: Actor = {
  type: "employee",
  employeeId: owner.id,
  name: owner.name,
  role: "owner",
};

console.log(commit ? "=== COMMIT ===" : "=== DRY RUN (pass --commit to apply) ===");
console.log(`Attributed to ${owner.name}\n`);

// ---------------------------------------------------------------- the buttons

console.log("Buttons");
let buttonsFixed = 0;
for (const b of BUTTONS) {
  const row = db
    .prepare(
      `SELECT q.id, q.label, q.category_id, c.code
         FROM quick_buttons q LEFT JOIN service_categories c ON c.id = q.category_id
        WHERE q.id = ?`,
    )
    .get(b.id) as { id: number; label: string; category_id: number | null; code: string | null } | undefined;

  if (!row) {
    console.log(`  ${b.label} (id ${b.id}): GONE — skipped`);
    continue;
  }
  // Refuse to touch a button that is no longer the one this was written for.
  if (row.label !== b.label || row.code !== b.wrong) {
    console.log(
      `  id ${b.id}: expected "${b.label}"/${b.wrong}, found "${row.label}"/${row.code ?? "(none)"} — skipped`,
    );
    continue;
  }

  console.log(`  ${row.label} (id ${row.id}): ${row.code} -> other`);
  buttonsFixed++;
  if (!commit) continue;

  const res = updateQuickButton(user, row.id, { categoryId: other.id });
  if (!res.ok) console.log(`    FAILED: ${res.error}`);
}

// ------------------------------------------------------------------ the lines

console.log("\nLines already rung");
const lines = db
  .prepare(
    `SELECT i.id, i.description, i.qty, i.category_id, c.code, s.sale_no, s.business_date
       FROM sale_items i
       JOIN sales s ON s.id = i.sale_id
       JOIN service_categories c ON c.id = i.category_id
      WHERE (i.description = 'AIR'     AND c.code = 'new_tire')
         OR (i.description = 'MOUNT'   AND c.code = 'oil_change')
         OR (i.description = 'BALANCE' AND c.code = 'oil_change')
      ORDER BY s.business_date, i.id`,
  )
  .all() as {
  id: number;
  description: string;
  qty: number;
  category_id: number;
  code: string;
  sale_no: string;
  business_date: string;
}[];

if (lines.length === 0) console.log("  none");
for (const l of lines)
  console.log(
    `  ${l.business_date}  ${l.sale_no}  ${l.description.padEnd(8)} qty ${l.qty}  ${l.code} -> other`,
  );

if (commit && lines.length > 0) {
  inTx(() => {
    const upd = db.prepare("UPDATE sale_items SET category_id = ? WHERE id = ?");
    for (const l of lines) {
      upd.run(other.id, l.id);
      logActorAudit(actor, {
        action: "sale_item.update",
        targetType: "sale_item",
        targetId: l.id,
        details: {
          reason: "Button was relabelled without its category; line booked under the old one",
          sale_no: l.sale_no,
          description: l.description,
        },
        before: { category_id: l.category_id, category: l.code },
        after: { category_id: other.id, category: other.code },
      });
    }
  });
}

const byDay = new Map<string, number>();
for (const l of lines) byDay.set(l.business_date, (byDay.get(l.business_date) ?? 0) + l.qty);

console.log(
  `\n${buttonsFixed} button(s), ${lines.length} line(s)${
    byDay.size ? ` — reports change for ${[...byDay].map(([d, q]) => `${d} (${q})`).join(", ")}` : ""
  }`,
);
if (!commit) console.log("Nothing written. Re-run with --commit.");
