/**
 * One imported ticket stamped 1:13 in the morning, moved to 1:13 in the
 * afternoon.
 *
 * The shop's day runs 7am to 7pm and every other one of 62,000 tickets falls
 * inside it. This single row — H-2025-041064, from the old workbook — landed at
 * 01:13 because a 12-hour clock time was read without its PM, and it put a lone
 * mark at 1am on the all-time hour grid, which is a chart saying the shop was
 * open in the middle of the night.
 *
 * The BUSINESS DATE is untouched, which is what matters for every figure in the
 * program: nothing about what was sold, when it counted, or which day's takings
 * it belongs to changes. Only the clock time moves, and only on the three
 * stamps that carry it.
 *
 *   npx tsx scripts/fix-1am-ticket.mts          (dry run)
 *   npx tsx scripts/fix-1am-ticket.mts --apply
 */
import fs from "node:fs";
import { getDb } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const db = getDb();

// Anything before the shop opens, and imported. A live POS ticket cannot have a
// wrong stamp — the register wrote it — so the fix is scoped to the import.
const rows = db
  .prepare(
    `SELECT id, sale_no, business_date, created_at, opened_at, completed_at
       FROM sales
      WHERE deleted = 0 AND kind = 'sale'
        AND sale_no LIKE 'H-%'
        AND CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 1 AND 5`,
  )
  .all() as {
  id: number;
  sale_no: string;
  business_date: string;
  created_at: string;
  opened_at: string | null;
  completed_at: string | null;
}[];

if (rows.length === 0) {
  console.log("Nothing stamped between 1am and 5am. Nothing to do.");
  process.exit(0);
}

/** 01:13 → 13:13. Twelve hours on, so the minutes and the date are kept. */
const toAfternoon = (iso: string | null): string | null => {
  if (!iso) return iso;
  const h = Number(iso.slice(11, 13));
  if (h < 1 || h > 5) return iso;
  return `${iso.slice(0, 11)}${String(h + 12).padStart(2, "0")}${iso.slice(13)}`;
};

for (const r of rows)
  console.log(
    `${r.sale_no}  ${r.business_date}  ${r.created_at} → ${toAfternoon(r.created_at)}`,
  );

if (!APPLY) {
  console.log(`\n${rows.length} ticket(s). Dry run — re-run with --apply.`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
fs.mkdirSync("backups", { recursive: true });
fs.copyFileSync("data/timeclock.db", `backups/before-1am-fix-${stamp}.db`);
console.log(`\nbacked up to backups/before-1am-fix-${stamp}.db`);

db.transaction(() => {
  const up = db.prepare(
    "UPDATE sales SET created_at = ?, opened_at = ?, completed_at = ? WHERE id = ?",
  );
  for (const r of rows)
    up.run(
      toAfternoon(r.created_at),
      toAfternoon(r.opened_at),
      toAfternoon(r.completed_at),
      r.id,
    );
})();

const left = db
  .prepare(
    `SELECT COUNT(*) n FROM sales
      WHERE deleted = 0 AND kind = 'sale'
        AND CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 1 AND 5`,
  )
  .get() as { n: number };
console.log(`moved ${rows.length}; tickets left before 6am: ${left.n}`);
