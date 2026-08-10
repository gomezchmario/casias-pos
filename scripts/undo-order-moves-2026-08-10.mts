/**
 * Undoes four order moves made by accident at 03:28–03:29 on 10 August.
 *
 * WHAT HAPPENED: four orders sitting at "Here — call them" were each walked
 * forward two stages, to "Called — no answer" and then to "Waiting for pickup".
 * Eight audit rows, four orders, two minutes.
 *
 * WHAT IT COST: nothing but the statuses. No inventory movement and no payment
 * was written in that window — checked before touching anything — so this is a
 * pure display correction and there is no money or stock to put back.
 *
 * WHAT IT RESTORES: the stage each order was on, AND the `fulfillment_at` it
 * carried before. That second half matters more than it looks. The board's
 * headline figure is how long an order has sat at its current stage, and it is
 * measured from that column — leaving it at today would reset four orders to
 * "arrived today" when two of them have been waiting since the 7th, and the
 * board would stop nagging about exactly the ones it should nag about.
 *
 * ONE AUDIT ROW PER ORDER rather than walking each back two stages through
 * `setFulfillment`. Two reasons: stepping back would stamp `fulfillment_at`
 * with now, which is the thing being repaired; and eight more rows saying
 * "waiting_pickup -> no_answer -> arrived" would describe a journey nobody
 * made. One row per order, naming it a correction, is what actually happened.
 *
 *   npx --yes tsx scripts/undo-order-moves-2026-08-10.mts [--apply]
 */

import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db.ts";
import { inTx } from "../src/lib/tx.ts";
import { logActorAudit } from "../src/lib/audit.ts";

const APPLY = process.argv.includes("--apply");
const db = getDb();

/** Sale id → the stage and timestamp it held before the accident. */
const RESTORE: { saleId: number; status: string; at: string }[] = [
  { saleId: 35, status: "arrived", at: "2026-08-07T22:41" },
  { saleId: 50, status: "arrived", at: "2026-08-07T09:41" },
  { saleId: 84, status: "arrived", at: "2026-08-07T09:41" },
  { saleId: 128, status: "arrived", at: "2026-08-07T09:42" },
];

// The exact minute is read back out of the audit log rather than trusted to the
// table above — the table is a summary, the log is the record.
for (const r of RESTORE) {
  const row = db
    .prepare(
      `SELECT timestamp FROM audit_log
        WHERE action = 'sale.fulfillment_change' AND target_id = ?
          AND json_extract(after_json, '$.fulfillment_status') = ?
          AND timestamp < '2026-08-10'
     ORDER BY id DESC LIMIT 1`,
    )
    .get(String(r.saleId), r.status) as { timestamp: string } | undefined;
  if (row) r.at = row.timestamp;
}

const owner = db
  .prepare("SELECT id, name FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id LIMIT 1")
  .get() as { id: number; name: string } | undefined;
if (!owner) throw new Error("No active owner to attribute this to");

console.log("Restoring:\n");
for (const r of RESTORE) {
  const s = db
    .prepare("SELECT sale_no, fulfillment_status, fulfillment_at FROM sales WHERE id = ?")
    .get(r.saleId) as { sale_no: string; fulfillment_status: string; fulfillment_at: string | null };
  console.log(
    `  ${s.sale_no}  ${s.fulfillment_status} (${(s.fulfillment_at ?? "").slice(0, 16)})` +
      `  ->  ${r.status} (${r.at.slice(0, 16)})`,
  );
}

// Nothing else moved in that window. Verified rather than assumed, because if
// it had, this script would be the wrong instrument entirely.
const moved = db
  .prepare(
    "SELECT COUNT(*) AS n FROM inventory_movements WHERE created_at >= '2026-08-10T03:20'",
  )
  .get() as { n: number };
const paid = db
  .prepare("SELECT COUNT(*) AS n FROM payments WHERE created_at >= '2026-08-10T03:20'")
  .get() as { n: number };
console.log(`\nstock movements in that window: ${moved.n} · payments: ${paid.n}`);
if (moved.n > 0 || paid.n > 0) {
  console.log("Something else moved. Stopping — this needs looking at by hand.");
  process.exit(1);
}

if (!APPLY) {
  console.log("\nDry run. Nothing changed. Re-run with --apply.");
  process.exit(0);
}

const now = (db.prepare("SELECT datetime('now','localtime') AS t").get() as { t: string }).t;
const dest = path.resolve(`backups/before-order-undo-${now.replace(/[: ]/g, "-")}.db`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
db.prepare("VACUUM INTO ?").run(dest);
console.log(`\nbacked up to ${dest} (${Math.round(fs.statSync(dest).size / 1024)} KB)`);

inTx(() => {
  for (const r of RESTORE) {
    const before = db
      .prepare("SELECT sale_no, fulfillment_status, fulfillment_at FROM sales WHERE id = ?")
      .get(r.saleId) as {
      sale_no: string;
      fulfillment_status: string;
      fulfillment_at: string | null;
    };

    db.prepare(
      "UPDATE sales SET fulfillment_status = ?, fulfillment_at = ?, updated_at = ? WHERE id = ?",
    ).run(r.status, r.at, now.replace(" ", "T"), r.saleId);

    logActorAudit(
      { type: "employee", employeeId: owner.id, name: owner.name, role: "owner" },
      {
        action: "sale.fulfillment_change",
        targetType: "sale",
        targetId: r.saleId,
        details: {
          sale_no: before.sale_no,
          correction: "moved by accident on 10 Aug 03:28-03:29, put back",
        },
        before: {
          fulfillment_status: before.fulfillment_status,
          fulfillment_at: before.fulfillment_at,
        },
        after: { fulfillment_status: r.status, fulfillment_at: r.at },
      },
    );
  }
});

console.log("\nAfter:");
for (const r of RESTORE) {
  const s = db
    .prepare("SELECT sale_no, fulfillment_status, fulfillment_at FROM sales WHERE id = ?")
    .get(r.saleId) as { sale_no: string; fulfillment_status: string; fulfillment_at: string };
  console.log(`  ${s.sale_no}  ${s.fulfillment_status}  ${s.fulfillment_at.slice(0, 16)}`);
}
