/**
 * The counter's own lost-demand study, kept on paper for a month, fed into
 * `tire_demand` — the table the in-app study button writes.
 *
 * One row per line of the paper, exactly as tallied: the same size appearing
 * twice was two tally marks in two places, and collapsing them would be
 * editing his study rather than importing it. The report groups by size
 * anyway.
 *
 * Dates are spread evenly across the last thirty days, by instruction
 * ("average them through the month"). The paper does not say which day each
 * ask happened, and a single spike today would age out of the thirty-day
 * window all at once a month from now instead of draining gradually the way
 * it was collected.
 *
 *   npx tsx scripts/import-counter-study.mts          (dry run)
 *   npx tsx scripts/import-counter-study.mts --apply
 */
import fs from "node:fs";
import { getDb } from "../src/lib/db";
import { currentBusinessDate } from "../src/lib/business-date";
import { normalizeTireSize } from "../src/lib/tire-size";

const APPLY = process.argv.includes("--apply");

/** The paper, verbatim — size and tally, in the order he wrote them. */
const ROWS: [string, number][] = [
  ["11/22.5", 14], ["11/24.5", 5], ["175/80/13", 2], ["185/65/15", 2],
  ["205/65/16", 1], ["215/45/17", 3], ["215/55/16", 7], ["215/55/17", 2],
  ["215/55/18", 2], ["215/60/16", 4], ["215/60/16", 3], ["215/60/17", 1],
  ["215/65/17", 2], ["225/45/17", 1], ["225/50/17", 3], ["225/50/17", 5],
  ["225/55/17", 4], ["225/55/18", 3], ["225/60/17", 2], ["225/75/15", 1],
  ["235/40/18", 4], ["235/45/18", 4], ["235/50/17", 1], ["235/50/18", 3],
  ["235/65/18", 2], ["235/80/17", 1], ["245/35/19", 3], ["245/35/20", 2],
  ["245/40/18", 2], ["245/40/19", 4], ["245/45/18", 3], ["245/50/20", 1],
  ["245/60/18", 1], ["245/65/17", 3], ["255/40/19", 2], ["255/45/20", 2],
  ["255/50/20", 2], ["255/70/22.5", 2], ["265/60/18", 4], ["265/70/16", 5],
  ["265/70/17", 6], ["275/55/20", 6], ["275/60/20", 15], ["295/75/22.5", 6],
  ["LT235/80/17", 2], ["LT235/85/18", 2], ["LT245/70/17", 3], ["LT245/75/16", 1],
  ["LT245/75/17", 2], ["LT265/70/17", 8], ["LT275/70/18", 2], ["LT285/75/16", 1],
  ["235/65/16C", 2], ["255/50/20", 1], ["255/50/19", 1], ["235/85/16 (16)", 1],
  ["245/40/20", 3], ["285/65/22", 1], ["235/40/18", 2], ["265/50/20", 4],
  ["235/75/15", 1], ["245/40/17", 1], ["235/80/16", 4], ["LT285/60/20", 5],
  ["255/65/18", 1], ["275/40/20", 2], ["255/70/16", 2], ["235/55/17", 1],
  ["235/50/19", 2], ["235/75/15", 1], ["225/55/19", 1], ["235/65/16", 1],
  ["215/85/16", 1], ["35X12.50R20", 1], ["215/70/16", 2], ["LT225/65/16", 1],
];

const db = getDb();
const today = currentBusinessDate();
const DAYS = 30;
const shiftDay = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// The cashier who kept the study. Named, because his tallies are his.
const antonio = db
  .prepare("SELECT id, name, pos_role FROM employees WHERE name = 'Antonio' AND active = 1")
  .get() as { id: number; name: string; pos_role: string } | undefined;
if (!antonio) throw new Error("Antonio not found on the staff list");

const total = ROWS.reduce((n, [, q]) => n + q, 0);
console.log(`${ROWS.length} lines · ${total} tires · spread over ${shiftDay(DAYS - 1)} → ${today}`);
console.log(`attributed to ${antonio.name} (#${antonio.id})\n`);

// One pass to show what each raw size becomes, flagging anything the
// normaliser could not resolve to a full width-aspect-rim size.
const whole = /^\d{2,3}-\d{2,3}(\.\d{1,2})?-\d{2}(\.\d)?$/;
const entries = ROWS.map(([raw, qty], i) => {
  // "235/85/16 (16)" — the parenthetical is the rim written a second time, and
  // it would keep the size from grouping with plain 235/85/16 asks. The paper's
  // own text is kept in size_raw either way.
  const norm = normalizeTireSize(raw.replace(/\s*\(.*\)\s*$/, ""));
  // Oldest first, in paper order: line i lands floor(i * DAYS / N) days ago,
  // counted from the far end so the last lines written are the most recent.
  const daysAgo = DAYS - 1 - Math.floor((i * DAYS) / ROWS.length);
  return { raw, norm, qty, businessDate: shiftDay(daysAgo), odd: !whole.test(norm) };
});
for (const e of entries)
  console.log(
    `${e.businessDate}  ${e.raw.padEnd(16)} → ${e.norm.padEnd(14)} x${String(e.qty).padStart(2)}${e.odd ? "   [odd size — stored as normalised text]" : ""}`,
  );

if (!APPLY) {
  console.log("\nDry run. Nothing written. Re-run with --apply.");
  process.exit(0);
}

// Backup, then write — the same discipline as every other import.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
fs.mkdirSync("backups", { recursive: true });
fs.copyFileSync("data/timeclock.db", `backups/before-counter-study-${stamp}.db`);
console.log(`\nbacked up to backups/before-counter-study-${stamp}.db`);

const before = (db.prepare("SELECT COUNT(*) n FROM tire_demand").get() as { n: number }).n;

db.transaction(() => {
  const insert = db.prepare(
    `INSERT INTO tire_demand
       (size_raw, size_norm, qty, note, business_date, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const audit = db.prepare(
    `INSERT INTO audit_log
       (actor_type, employee_id, employee_name, employee_role, action,
        target_type, target_id, details, timestamp)
     VALUES ('employee', ?, ?, ?, 'tire_demand.record', 'tire_demand', ?, ?, ?)`,
  );
  for (const e of entries) {
    const at = `${e.businessDate}T12:00:00`;
    const info = insert.run(
      e.raw,
      e.norm,
      e.qty,
      "Counter study, imported from paper",
      e.businessDate,
      antonio.id,
      at,
    );
    audit.run(
      antonio.id,
      antonio.name,
      antonio.pos_role,
      Number(info.lastInsertRowid),
      JSON.stringify({
        size: e.raw,
        normalized: e.norm,
        qty: e.qty,
        note: "Counter study, imported from paper",
        imported: true,
      }),
      at,
    );
  }
})();

const after = (db.prepare("SELECT COUNT(*) n FROM tire_demand").get() as { n: number }).n;
console.log(`tire_demand ${before} → ${after} (+${after - before})`);
