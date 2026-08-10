/**
 * Seeds the shop's two years of Excel history into the database, for reports.
 *
 * The workbook is the system this POS replaced: one flat row per service, on the
 * "Data" tab, running 15 August 2024 to 7 August 2026. The POS itself only has
 * the week it went live, which is not enough history for a single report on the
 * Reports tab to say anything. This puts the rest in.
 *
 * WHAT IT WILL NOT TOUCH, and these are the rules the whole script is built to
 * keep rather than promises made about it:
 *
 *   INVENTORY. Not one `inventory_movements` row is written. Stock on hand is
 *   derived entirely from that ledger, so forty thousand imported sales cannot
 *   move a single count. Sale lines still carry `product_id` where the tire can
 *   be identified — that column feeds the best-seller and restock reports and
 *   moves no stock — and the check at the end proves on-hand is unchanged.
 *
 *   THE DAYS ALREADY RUNG IN THE POS. Wednesday 5 and Thursday 6 August are
 *   skipped outright. Any other date that already has POS tickets is imported
 *   with those tickets de-duplicated out of it, line by line, so nothing is
 *   counted twice.
 *
 *   SPECIAL ORDERS AND THE OUTSTANDING PANEL. Every imported ticket is
 *   `is_special_order = 0`, `fulfillment_status = 'none'`, paid in full — and
 *   `work_status = NULL`.
 *
 *   That last one is not a detail. `outstandingTickets` treats a work status of
 *   NULL as "no car involved" and ANY other value as a car still on the
 *   premises, `picked_up` excepted. Writing the string 'none' there — which
 *   reads as neutral and is not — put all forty thousand imported tickets on
 *   the counter's Outstanding panel at once. The three "no special order" flags
 *   were all correct and the panel filled up anyway, because it asks a fourth
 *   question. Anything seeding this table has to answer all four.
 *
 *   CUSTOMERS. The workbook's customer column is deliberately ignored. No
 *   customer rows are created and no ticket is attached to one.
 *
 *   MONEY OWED. Every imported ticket is paid in full, so none of it appears as
 *   a debt. See the note on "Pending" below.
 *
 * WHAT IT DOES CREATE: technicians who no longer work here, as inactive
 * technician accounts, because the reports need somebody to attribute two years
 * of work to and a name on a line is not the same as a person on the payroll.
 *
 *   npx --yes tsx --tsconfig scripts/tsconfig.preview.json scripts/import-excel-history.mts [--apply]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "../src/lib/db.ts";
import { inTx } from "../src/lib/tx.ts";
import { normalizeTireSize } from "../src/lib/tire-size.ts";
import { readSharedStrings, readSheet, serialToDate, serialToTime } from "./lib-xlsx.mts";

const APPLY = process.argv.includes("--apply");

/**
 * Import only the days the database has nothing at all for.
 *
 * The mode for a BACKUP of the workbook rather than the workbook itself. The
 * shop keeps several copies taken at different moments, and one of them turned
 * out to hold a month the main file had lost — 20 October to 20 November 2025.
 * Run over the whole file that month would arrive alongside two years that are
 * already in; restricted to the empty days it arrives alone.
 *
 * "Empty" means not one completed ticket on that date. A day the register has
 * even one ticket on is a day somebody was using the system, and a backup's
 * version of it is a second telling rather than a missing one.
 */
const ONLY_MISSING = process.argv.includes("--only-missing");

const XL = process.argv.find((a) => /\.xlsm$|\.xlsx$/i.test(a));

/** A workbook is a zip. ExcelJS refuses these ones — see `lib-xlsx.mts`. */
function unzip(file: string): string {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "wb-"));
  const zip = path.join(out, "book.zip");
  fs.copyFileSync(file, zip);
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}/x' -Force`,
    ],
    { stdio: "pipe" },
  );
  return path.join(out, "x");
}

/** The sheet named Data, whatever file it lives in. */
function dataSheetOf(dir: string): string {
  const rels = fs.readFileSync(`${dir}/xl/_rels/workbook.xml.rels`, "utf8");
  const map: Record<string, string> = {};
  for (const m of rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g))
    map[m[1]] = m[2];
  const wb = fs.readFileSync(`${dir}/xl/workbook.xml`, "utf8");
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g))
    if (m[1].trim().toLowerCase() === "data") return map[m[2]];
  throw new Error("no sheet called Data in that workbook");
}

const DIR = XL
  ? unzip(XL)
  : "C:/Users/Casia/AppData/Local/Temp/claude/C--Users-Casia-Check-In/5e2d0312-8f7f-4e7f-ac47-3ac0745641a3/scratchpad/xlsx/x";
const SHEET = XL ? dataSheetOf(DIR) : "worksheets/sheet2.xml";

const db = getDb();
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const notes: string[] = [];

/** Dollars in the sheet → integer cents, the only representation of money here. */
const cents = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

// ── The days that are off limits ───────────────────────────────────────────
//
// Wednesday and Thursday were rung properly in the POS and are the shop's own
// record of those days. Friday was started in the POS and abandoned halfway —
// the workbook is the complete record of it — so Friday IS imported, with the
// twenty-three tickets that did get rung taken out of it line by line.
const FROZEN = new Set(["2026-08-05", "2026-08-06"]);

// ── Vocabulary ─────────────────────────────────────────────────────────────

const CATEGORY: Record<string, string> = {
  "new tire": "new_tire",
  "used tire": "used_tire",
  "oil change": "oil_change",
  disposal: "disposal",
  // An inspection is labour, and the register's own closed list of five buckets
  // has no inspection in it — see `CATEGORY_BUCKET`. Other Service is where it
  // reports today, so that is where the history goes.
  ins: "other",
  "other service": "other",
  service: "other",
  "tire check": "other",
  "new sensor": "other",
  "used rim": "other",
};

const TENDER: Record<string, string> = {
  cc: "cc",
  cc3: "cc",
  cash: "cash",
  clover: "clover",
  snap: "snap",
  aff: "aff",
  "po shop": "po_shop",
  // Charged as Other on instruction. A house account in the POS is a running
  // balance somebody has to settle, and importing two years of them would
  // invent debts nobody owes and put strangers on the accountant's screen.
  "credit acc": "other",
  "credit account": "other",
  // Unpaid in the old sheet. Imported as Other rather than left unpaid, because
  // an unpaid ticket becomes money owed — it would land on the Outstanding panel
  // at the register and in the receivables report, as a debt from 2024 that
  // nobody is going to collect.
  pending: "other",
  other: "other",
};

const tenderOf = (raw: string): string => {
  const k = raw.trim().toLowerCase();
  return TENDER[k] ?? "other";
};

/**
 * The workbook's spelling of a technician's name → the person.
 *
 * Case and typos are folded first, so JOSE, jose and Jose are one man. `Javi` is
 * Javier, which is the one substantive judgement in this table: it is the only
 * short form in two years of data and the shop has exactly one Javier.
 */
const MECHANIC_ALIAS: Record<string, string> = {
  javi: "Javier",
  franc: "Francisco",
  fransisco: "Francisco",
  maragaret: "Margaret",
  "danny`": "Danny",
  rey: "Rey",
};

/**
 * How many lines a name needs before it becomes a staff account.
 *
 * Two years of hand-typing leaves debris in the mechanic column: "Cc" where a
 * payment method was tabbed into the wrong cell, "Oil Tech", "Fr", a name
 * spelled once and never again. An account for each would put a dozen people
 * who never worked here on the payroll screen and in every per-technician
 * report, permanently.
 *
 * Below the bar the name is kept as free text on the line — `mechanic_name`
 * exists for exactly this — so the work is still attributed and still adds up;
 * it simply does not invent a person. Five is deliberately low: a real
 * technician who lasted a single week clears it easily.
 */
const MIN_LINES_FOR_ACCOUNT = 5;

// ── Read the sheet ─────────────────────────────────────────────────────────

const shared = readSharedStrings(DIR);
const rows = readSheet(DIR, SHEET, shared)
  .slice(1)
  .filter((r) => r[0] != null && r[9] != null);

type Line = {
  date: string;
  time: string;
  desc: string;
  qty: number;
  unitCents: number;
  totalCents: number;
  tipCents: number;
  commCents: number;
  mechanic: string;
  tender: string;
  category: string;
};

/** Days the database has not one completed ticket for. See `ONLY_MISSING`. */
const emptyDays = new Set<string>();
if (ONLY_MISSING) {
  const have = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT business_date d FROM sales
             WHERE deleted = 0 AND kind = 'sale' AND status = 'completed'`,
        )
        .all() as { d: string }[]
    ).map((r) => r.d),
  );
  for (const r of rows) {
    const d = serialToDate(Number(r[9]));
    if (d && !have.has(d)) emptyDays.add(d);
  }
  const list = [...emptyDays].sort();
  console.log(
    `only-missing: ${emptyDays.size} days the database has nothing for` +
      (list.length ? ` (${list[0]} → ${list.at(-1)})` : ""),
  );
}

const lines: Line[] = [];
let skippedFrozen = 0;
let skippedUndated = 0;
let skippedPresent = 0;

for (const r of rows) {
  const date = serialToDate(Number(r[9]));
  if (!date) {
    skippedUndated++;
    continue;
  }
  if (FROZEN.has(date)) {
    skippedFrozen++;
    continue;
  }
  if (ONLY_MISSING && !emptyDays.has(date)) {
    skippedPresent++;
    continue;
  }
  const qty = Math.max(1, Math.round(Number(r[1]) || 1));
  const tip = cents(r[5]);
  const comm = cents(r[6]);
  /*
    The line is worth what the sheet's own Sub-total column says, not TOTAL
    minus the tip and the charge.

    Arithmetically those agree on nearly every row — TOTAL is sub + tip + comm —
    and they part company on the rows that matter most to get right. A service
    given away with a tip left on it has TOTAL 0 and a tip of six dollars, and
    the subtraction turns that into a line worth MINUS six. Fifty-five of them
    on flats alone. Reading the column the shop actually filled in avoids
    inventing a negative out of a free repair.
  */
  const lineTotal = cents(r[4]);
  lines.push({
    date,
    time: serialToTime(Number(r[10])) ?? "12:00",
    desc: String(r[0]).trim().replace(/\s+/g, " "),
    qty,
    unitCents: qty > 0 ? Math.round(lineTotal / qty) : lineTotal,
    totalCents: lineTotal,
    tipCents: tip,
    commCents: comm,
    mechanic: String(r[3] ?? "").trim(),
    tender: tenderOf(String(r[8] ?? "")),
    category: CATEGORY[String(r[11] ?? "").trim().toLowerCase()] ?? "other",
  });
}

console.log(`workbook: ${rows.length} rows · usable ${lines.length}`);
console.log(
  `  skipped: ${skippedFrozen} on frozen days (5–6 Aug), ${skippedUndated} undated` +
    (ONLY_MISSING ? `, ${skippedPresent} on days already in the database` : ""),
);

// ── De-duplicate against what the POS already has ──────────────────────────
//
// Matched on amount and quantity within the same day, consuming each POS line
// once. Descriptions cannot be matched — the workbook writes "NEW 225/70/19.5
// LANDFLEET A/P" where the register writes "LANDFLEET LS201 A/P 225-70-19.5" —
// and amount plus quantity on the same day is a good enough key when the
// alternative is counting Friday twice.

const posDays = new Set(
  (
    db
      .prepare(
        "SELECT DISTINCT business_date d FROM sales WHERE deleted = 0 AND kind = 'sale'",
      )
      .all() as { d: string }[]
  ).map((r) => r.d),
);

let deduped = 0;
const kept: Line[] = [];
const pool = new Map<string, number>();
for (const d of posDays) {
  if (FROZEN.has(d)) continue;
  const posLines = db
    .prepare(
      `SELECT i.qty, i.line_total_cents AS c
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE s.business_date = ? AND s.deleted = 0 AND s.status <> 'voided' AND i.voided = 0`,
    )
    .all(d) as { qty: number; c: number }[];
  for (const p of posLines) {
    const k = `${d}|${p.qty}|${p.c}`;
    pool.set(k, (pool.get(k) ?? 0) + 1);
  }
}
for (const l of lines) {
  const k = `${l.date}|${l.qty}|${l.totalCents}`;
  const n = pool.get(k) ?? 0;
  if (n > 0) {
    pool.set(k, n - 1);
    deduped++;
    continue;
  }
  kept.push(l);
}
console.log(`  de-duplicated against POS days: ${deduped} lines dropped`);
if (deduped > 0) {
  notes.push(
    `${deduped} workbook lines were dropped because the same amount and quantity was already rung in the POS on that day — almost all of them Friday 7 August, which was started in the register and finished in the sheet.`,
  );
}

// ── People ─────────────────────────────────────────────────────────────────

const properName = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const employees = db
  .prepare("SELECT id, name, pos_role, active FROM employees")
  .all() as { id: number; name: string; pos_role: string; active: number }[];
const byName = new Map(employees.map((e) => [e.name.toLowerCase(), e]));

const wanted = new Map<string, number>();
for (const l of kept) {
  const raw = l.mechanic.toLowerCase().replace(/[^a-z` ]/g, "");
  if (!raw || raw === "other" || raw === "???") continue;
  const name = MECHANIC_ALIAS[raw] ?? properName(raw);
  wanted.set(name, (wanted.get(name) ?? 0) + 1);
}
const missing = [...wanted.entries()].filter(
  ([n, count]) => !byName.has(n.toLowerCase()) && count >= MIN_LINES_FOR_ACCOUNT,
);
const debris = [...wanted.entries()].filter(
  ([n, count]) => !byName.has(n.toLowerCase()) && count < MIN_LINES_FOR_ACCOUNT,
);
if (debris.length)
  notes.push(
    `${debris.length} names appeared fewer than ${MIN_LINES_FOR_ACCOUNT} times and were kept as free text rather than turned into staff accounts: ${debris
      .map(([n, c]) => `${n}(${c})`)
      .join(", ")}. Their work still counts; it reports under Other.`,
  );
console.log(`\ntechnicians in the sheet: ${wanted.size} · already on the staff list: ${wanted.size - missing.length}`);
if (missing.length)
  console.log("  to create as inactive technicians: " + missing.map(([n, c]) => `${n}(${c})`).join(", "));

// ── Products, for the tire lines ───────────────────────────────────────────
//
// `product_id` moves NO stock — that is done entirely by `inventory_movements`,
// and this script writes none. What it does is let the best-seller, dead-stock
// and restock reports see two years of what actually sold.

const products = db
  .prepare(
    "SELECT id, name, tire_size, brand FROM products WHERE deleted = 0 AND tire_size IS NOT NULL",
  )
  .all() as { id: number; name: string; tire_size: string; brand: string | null }[];

const bySize = new Map<string, typeof products>();
for (const p of products) {
  const list = bySize.get(p.tire_size) ?? [];
  list.push(p);
  bySize.set(p.tire_size, list);
}

/** "NEW 205/55/16 VANTAGE" → the product it most likely was. */
const matchKind = { one: 0, brand: 0, size: 0, none: 0 };

function matchProduct(desc: string, count = false): number | null {
  // The workbook writes 205/55/16, 205-55-16, 225/70/19.5 and occasionally
  // 11R22.5 — the separator before the rim is optional because of the last one.
  const m = desc.match(
    /(\d{2,3})\s*[/\-x]\s*(\d{2,3}(?:\.\d)?)\s*[/\-Rr]?\s*(\d{2}(?:\.\d)?)/,
  );
  if (!m) {
    if (count) matchKind.none++;
    return null;
  }
  const size = normalizeTireSize(`${m[1]}/${m[2]}/${m[3]}`);
  const candidates = bySize.get(size);
  if (!candidates?.length) {
    if (count) matchKind.none++;
    return null;
  }
  if (candidates.length === 1) {
    if (count) matchKind.one++;
    return candidates[0].id;
  }
  // Several products share the size. A brand named in the description settles
  // it: the workbook writes "NEW 205/55/16 VANTAGE" and the product carries
  // VANTAGE.
  const upper = desc.toUpperCase();
  const branded = candidates.find((p) => p.brand && upper.includes(p.brand.toUpperCase()));
  if (branded) {
    if (count) matchKind.brand++;
    return branded.id;
  }
  /*
    No brand in the text, so the line goes to the first tire in that size — and
    that is a judgement worth stating rather than burying.

    What is certainly right is the SIZE, and the size is what these reports are
    for: what sells, what to reorder, what walked out unsold. What is a guess is
    which of two or three tires in that size it was. Leaving it unmatched would
    keep the brand honest at the price of dropping the line out of every
    per-product report — losing the size as well as the brand, to protect a
    detail the old sheet never recorded.

    So it is matched, and every guess is counted and reported at the end.
  */
  if (count) matchKind.size++;
  return candidates[0].id;
}

let matchedTires = 0;
let unmatchedTires = 0;
for (const l of kept) {
  if (l.category !== "new_tire") continue;
  if (matchProduct(l.desc, true)) matchedTires++;
  else unmatchedTires++;
}
console.log(
  `\nnew-tire lines: ${matchedTires + unmatchedTires} · matched to a product: ${matchedTires} (${Math.round((matchedTires / Math.max(1, matchedTires + unmatchedTires)) * 100)}%)`,
);
console.log(
  `  one product in that size: ${matchKind.one} · brand named: ${matchKind.brand} · size only, brand guessed: ${matchKind.size}`,
);
if (matchKind.size)
  notes.push(
    `${matchKind.size} new-tire lines named a size the shop stocks in more than one brand, without saying which. They are attached to the first tire in that size — the SIZE is right and the brand is a guess, which matters for "best sellers" and for nothing the size drives.`,
  );
notes.push(
  `${unmatchedTires} new-tire lines could not be matched to a product — mostly "NEW SENSOR", "NEW RIM", "NEW WHEEL" and bare "NEW" with no size. They import as ordinary lines with the right money and category; they simply do not appear in the per-product reports.`,
);

// ── Group into tickets ─────────────────────────────────────────────────────
//
// The old form stamped one time per entry, so rows sharing a date and a time
// are one ticket. Measured, not assumed: 44,628 rows collapse to 43,152 groups,
// and the multi-row ones read exactly like real tickets — four tires split
// across four fitters, a rotation done twice.

const groups = new Map<string, Line[]>();
for (const l of kept) {
  const k = `${l.date}|${l.time}`;
  const g = groups.get(k) ?? [];
  g.push(l);
  groups.set(k, g);
}

// A handful of groups are enormous — a hundred rows sharing one timestamp,
// which is somebody pasting a block in rather than a ticket. Split those back
// into one ticket per row; a hundred-line ticket would distort every average
// on the page.
const tickets: Line[][] = [];
for (const g of groups.values()) {
  if (g.length > 12) for (const l of g) tickets.push([l]);
  else tickets.push(g);
}
tickets.sort((a, b) => (a[0].date + a[0].time < b[0].date + b[0].time ? -1 : 1));

const grand = tickets.reduce(
  (n, t) => n + t.reduce((m, l) => m + l.totalCents + l.tipCents + l.commCents, 0),
  0,
);
console.log(`\ntickets to create: ${tickets.length} · lines: ${kept.length} · ${money(grand)}`);
const days = new Set(kept.map((l) => l.date));
console.log(`covering ${days.size} days, ${[...days].sort()[0]} → ${[...days].sort().at(-1)}`);

if (!APPLY) {
  console.log("\nNOTES FOR TOMORROW:");
  for (const n of notes) console.log("  · " + n);
  console.log("\nDry run. Nothing written. Re-run with --apply.");
  process.exit(0);
}

// ── Write ──────────────────────────────────────────────────────────────────

const before = {
  sales: (db.prepare("SELECT COUNT(*) n FROM sales").get() as { n: number }).n,
  movements: (db.prepare("SELECT COUNT(*) n FROM inventory_movements").get() as { n: number }).n,
  stock: db
    .prepare(
      "SELECT product_id, SUM(qty_delta) q FROM inventory_movements GROUP BY product_id",
    )
    .all() as { product_id: number; q: number }[],
};

const stamp = (db.prepare("SELECT datetime('now','localtime') t").get() as { t: string }).t;
const dest = path.resolve(`backups/before-excel-import-${stamp.replace(/[: ]/g, "-")}.db`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
db.prepare("VACUUM INTO ?").run(dest);
console.log(`\nbacked up to ${dest}`);

const methodId = new Map(
  (db.prepare("SELECT id, code FROM payment_methods").all() as { id: number; code: string }[]).map(
    (m) => [m.code, m.id],
  ),
);
const categoryId = new Map(
  (
    db.prepare("SELECT id, code FROM service_categories").all() as {
      id: number;
      code: string;
    }[]
  ).map((c) => [c.code, c.id]),
);
const taxBp = Number(
  (db.prepare("SELECT value FROM settings WHERE key = 'tax_rate_bp'").get() as
    | { value: string }
    | undefined)?.value ?? 825,
);

inTx(() => {
  // The technicians who have left. Inactive, so they cannot sign in and do not
  // appear in a picker, but their name carries two years of work on the reports.
  // No soft-delete column on `employees` — a person who leaves is deactivated
  // rather than deleted, which is what `active = 0` does here. They cannot sign
  // in (the PIN hash is empty and matches nothing) and they do not appear in the
  // picker, but their name still carries two years of work on the reports.
  const insertEmp = db.prepare(
    `INSERT INTO employees (name, pin_hash, active, pos_role, created_at, updated_at)
     VALUES (?, '', 0, 'technician', ?, ?)`,
  );
  for (const [name] of missing) {
    const id = Number(insertEmp.run(name, stamp, stamp).lastInsertRowid);
    byName.set(name.toLowerCase(), { id, name, pos_role: "technician", active: 0 });
  }

  const insertSale = db.prepare(
    `INSERT INTO sales
       (sale_no, business_date, opened_at, completed_at, status, fulfillment_status,
        is_special_order, cashier_id, subtotal_cents, tip_cents, comm_cents,
        total_cents, paid_cents, balance_cents, discount_cents, tax_rate_bp,
        kind, work_status, created_at, updated_at, deleted, notes)
     VALUES (?, ?, ?, ?, 'completed', 'none', 0, ?, ?, ?, ?, ?, ?, 0, 0, ?,
             'sale', NULL, ?, ?, 0, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO sale_items
       (sale_id, line_no, product_id, description, category_id, mechanic_id, mechanic_name,
        qty, unit_price_cents, line_total_cents, voided, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  );
  const insertPay = db.prepare(
    `INSERT INTO payments
       (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents, mechanic_id,
        taken_by, business_date, created_at, note)
     VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, 'Imported from the 2024-26 workbook')`,
  );
  // Money going back out. Negative, on the same tender, against a sale that
  // stands — the shape `refund` in `payments.ts` writes, so every report that
  // already understands a refund understands these too.
  const insertRefund = db.prepare(
    `INSERT INTO payments
       (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents,
        taken_by, business_date, created_at, note)
     VALUES (?, ?, 'refund', ?, 0, 0, ?, ?, ?, 'Refund, imported from the 2024-26 workbook')`,
  );

  const owner = (db
    .prepare("SELECT id FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id LIMIT 1")
    .get() as { id: number }).id;

  // Continues wherever the last import stopped. A second run — a backup
  // filling a gap the main workbook lost — must not re-issue numbers the first
  // one already used.
  let seq =
    1 +
    ((
      db
        .prepare("SELECT COUNT(*) n FROM sales WHERE sale_no LIKE 'H-%'")
        .get() as { n: number }
    ).n);
  /** The negative rows, kept so the note can say what they were. */
  const outgoing: Line[] = [];
  let refundOnly = 0;
  let refundedTickets = 0;
  let refundCents = 0;

  for (const t of tickets) {
    const first = t[0];
    const at = `${first.date}T${first.time}:00`;

    /*
      Negative lines are refunds, and the database will not take them as items —
      `sale_items` requires a line total of zero or more, and `sales` requires a
      subtotal of zero or more.

      That is not an obstacle to work around; it is the schema saying that money
      going back out is a payment and not a line. So the ticket is split the way
      the register itself would have written it: the positive lines become the
      sale, and the negative ones become a single `refund` payment against it.
      The money comes out identical and the shape is the one every report on the
      other side already understands.
    */
    // Zero counts as a line. A tire check done for nothing, or a repair
    // comped with a tip left on it, is work that happened — it belongs in the
    // count of what the shop did even though it moved no money. Only genuinely
    // negative rows are held back.
    const items = t.filter((l) => l.totalCents >= 0);
    const backOut = t.filter((l) => l.totalCents < 0).reduce((n, l) => n + l.totalCents, 0);

    // A refund with no sale on the same stamp has nothing to hang on. Rare, and
    // counted rather than silently dropped.
    if (items.length === 0) {
      refundOnly++;
      refundCents += backOut;
      for (const l of t) outgoing.push(l);
      continue;
    }

    const goods = items.reduce((n, l) => n + l.totalCents, 0);
    // Clamped at zero: a handful of rows carry a negative tip, which the schema
    // refuses and which is not a thing that can happen at a counter.
    const tip = Math.max(0, t.reduce((n, l) => n + l.tipCents, 0));
    const comm = Math.max(0, t.reduce((n, l) => n + l.commCents, 0));
    const total = goods + tip + comm;

    // A distinct series, so an imported ticket is recognisable at a glance and
    // can never collide with the register's own numbering.
    const saleNo = `H-${first.date.slice(0, 4)}-${String(seq++).padStart(6, "0")}`;

    const saleId = Number(
      insertSale.run(
        saleNo,
        first.date,
        at,
        at,
        owner,
        goods,
        tip,
        comm,
        total,
        // paid_cents equals the total: every imported ticket is settled, so
        // none of two years of history turns up as money somebody still owes.
        // `balance_cents` and `discount_cents` are literal zeroes in the SQL.
        total,
        taxBp,
        at,
        at,
        null,
      ).lastInsertRowid,
    );

    let lineNo = 1;
    const mechFor = (raw: string) => {
      const k = raw.toLowerCase().replace(/[^a-z` ]/g, "");
      if (!k || k === "other" || k === "???") return { id: null, name: raw || "Other" };
      const name = MECHANIC_ALIAS[k] ?? properName(k);
      const e = byName.get(name.toLowerCase());
      return e ? { id: e.id, name: null } : { id: null, name };
    };

    for (const l of items) {
      const m = mechFor(l.mechanic);
      insertItem.run(
        saleId,
        lineNo++,
        l.category === "new_tire" ? matchProduct(l.desc) : null,
        l.desc,
        categoryId.get(l.category) ?? categoryId.get("other")!,
        m.id,
        m.name,
        l.qty,
        l.unitCents,
        l.totalCents,
        at,
        at,
      );
    }

    // One payment, in full, so nothing imported reads as owed. The tip rides on
    // it with the technician from the first line, which is where the old sheet
    // recorded it.
    const m = mechFor(first.mechanic);
    const tenderId = methodId.get(first.tender) ?? methodId.get("other")!;
    insertPay.run(saleId, tenderId, total, tip, comm, m.id, owner, first.date, at);

    // Money that went back out on the same ticket, as the register would have
    // written it: a negative payment of kind `refund` against a sale that
    // stands. The sale stays completed, because it happened.
    if (backOut < 0) {
      refundedTickets++;
      refundCents += backOut;
      insertRefund.run(saleId, tenderId, backOut, owner, first.date, at);
    }
  }

  console.log(
    `\nrefunds: ${refundedTickets} tickets carried one · ${refundOnly} entries were a refund with no sale on the same stamp and were skipped · ${money(refundCents)} in total`,
  );
  if (outgoing.length) {
    /*
      Money the old sheet recorded as a negative sale, which is three different
      things wearing one coat: petty cash (GAS, HIELO, WATHER), staff bonuses
      (BONO), used tires bought over the counter, and genuine refunds.

      None of them is a sale, and the register models each differently — a
      drawer withdrawal, a purchase ticket, a refund payment. Guessing which
      from a description typed two years ago would put made-up rows in three
      different ledgers, so they are left out and listed here instead.
    */
    const kinds = new Map<string, { n: number; cents: number }>();
    for (const l of outgoing) {
      const k = l.desc.toUpperCase().split(/\s+/)[0].slice(0, 14);
      const e = kinds.get(k) ?? { n: 0, cents: 0 };
      e.n++;
      e.cents += l.totalCents;
      kinds.set(k, e);
    }
    const top = [...kinds.entries()]
      .sort((a, b) => a[1].cents - b[1].cents)
      .slice(0, 8)
      .map(([k, e]) => `${k} ${e.n}×${money(e.cents)}`)
      .join(", ");
    notes.push(
      `${outgoing.length} workbook rows were money going OUT, written as a negative sale — ${money(outgoing.reduce((n, l) => n + l.totalCents, 0))} over two years. They are not imported, because they are not sales: the commonest are ${top}. In the register these would be a drawer withdrawal (petty cash, bonuses), a purchase ticket (used tires bought in) or a refund, and which one each was cannot be told from the description. Worth a decision if you want them in the reports.`,
    );
  }
});

// ── Prove the promises ─────────────────────────────────────────────────────

const after = {
  sales: (db.prepare("SELECT COUNT(*) n FROM sales").get() as { n: number }).n,
  movements: (db.prepare("SELECT COUNT(*) n FROM inventory_movements").get() as { n: number }).n,
  stock: db
    .prepare("SELECT product_id, SUM(qty_delta) q FROM inventory_movements GROUP BY product_id")
    .all() as { product_id: number; q: number }[],
};

const stockBefore = new Map(before.stock.map((r) => [r.product_id, r.q]));
const stockAfter = new Map(after.stock.map((r) => [r.product_id, r.q]));
let drift = 0;
for (const [p, q] of stockAfter) if (stockBefore.get(p) !== q) drift++;
for (const [p, q] of stockBefore) if (stockAfter.get(p) !== q) drift++;

console.log(`\nsales ${before.sales} → ${after.sales} (+${after.sales - before.sales})`);
console.log(`inventory movements ${before.movements} → ${after.movements}  ${after.movements === before.movements ? "UNCHANGED" : "*** CHANGED ***"}`);
console.log(`products whose on-hand moved: ${drift}  ${drift === 0 ? "— none, as promised" : "*** CHECK THIS ***"}`);
console.log(
  "special orders created:",
  (db.prepare("SELECT COUNT(*) n FROM sales WHERE sale_no LIKE 'H-%' AND is_special_order = 1").get() as { n: number }).n,
);
console.log(
  "imported tickets with a balance owing:",
  (db.prepare("SELECT COUNT(*) n FROM sales WHERE sale_no LIKE 'H-%' AND balance_cents <> 0").get() as { n: number }).n,
);
// The check that would have caught the one thing this script got wrong. Every
// imported ticket must be invisible to the counter's Outstanding panel, and
// that panel asks four questions rather than three — see the header.
console.log(
  "on the Outstanding panel because of the import:",
  (
    db
      .prepare(
        `SELECT COUNT(*) n FROM sales
          WHERE sale_no LIKE 'H-%'
            AND (balance_cents > 0
                 OR (is_special_order = 1
                     AND fulfillment_status NOT IN ('none', 'delivered', 'cancelled'))
                 OR (work_status IS NOT NULL AND work_status <> 'picked_up'))`,
      )
      .get() as { n: number }
  ).n,
  "— must be 0",
);
console.log(
  "customers created:",
  (db.prepare("SELECT COUNT(*) n FROM customers").get() as { n: number }).n,
  "(was 20)",
);

console.log("\nNOTES FOR TOMORROW:");
for (const n of notes) console.log("  · " + n);
