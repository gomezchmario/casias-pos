/**
 * Example data, transcribed from a real day off the shop's spreadsheet
 * (2 August 2026) plus a synthetic prior week so the dashboard's
 * week-over-week comparison has something to compare against.
 *
 * This is demo data, not books. Every ticket it writes is stamped with a
 * marker in `notes` so `--remove` can take them all back out again by hand --
 * which is a hard delete, and is only defensible because these rows never
 * described real money. Nothing else in the system is allowed to delete a
 * ledger row.
 *
 *   node scripts/seed-example-day.mjs           add
 *   node scripts/seed-example-day.mjs --remove  take it all back out
 */

import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new Database(path.join(root, "data", "timeclock.db"));
db.pragma("foreign_keys = ON");

const MARK = "[example-data]";
const DAY = "2026-08-02";

/** Who was on the floor. `null` is the spreadsheet's "Other" -- work nobody
 *  claimed, which the schema models as no mechanic rather than a fake one. */
const JERRY = 6;
const FRANK = 8;
const JOSE = 7;
const CASHIER = 5; // Ivan, at the counter

const CAT = { new_tire: 1, used_tire: 2, other: 5 };
const PM = { cash: 1, cc: 2, snap: 3, other: 8 };

/**
 * The day, line for line off the sheet.
 *
 * [time, description, qty, unit cents, mechanic, tip cents, fee cents,
 *  method, category, { seq, po, note }]
 *
 * `method: null` means the row was left unpaid -- row 12 on the sheet has a
 * blank tender. It is kept exactly as it is, because a completed ticket
 * carrying a balance is a real thing that happens and the dashboard needs to
 * show it.
 */
const LINES = [
  ["08:11:14", "CHECK TIRE", 1, 500, FRANK, 0, 0, "cash", "other", { note: "DOMINGO" }],
  ["08:16:28", "NEW 215-55-17 VANTAGE", 1, 12000, JERRY, 800, 200, "cc", "new_tire", { seq: "1", po: "8401" }],
  ["08:26:24", "FLAT", 1, 1500, FRANK, 0, 0, "cash", "other", {}],
  ["08:40:43", "FLAT", 1, 1500, JERRY, 0, 0, "cash", "other", {}],
  ["08:55:07", "FLAT", 1, 1600, JERRY, 0, 0, "cc", "other", { seq: "2" }],
  ["08:56:59", "MOUNT & BALANCE", 7, 3500, JERRY, 2000, 500, "cc", "other", { seq: "3", note: "Y FRANK" }],
  ["09:38:48", "FLAT", 1, 1600, FRANK, 500, 100, "cc", "other", { seq: "4" }],
  ["09:42:55", "MOUNT & BALANCE Y ROTACION", 1, 6000, FRANK, 0, 0, "cc", "other", { seq: "10", note: "ROTACION" }],
  ["09:52:07", "FLAT", 1, 1500, JERRY, 0, 0, "cash", "other", {}],
  ["09:56:14", "CHECK TIRE", 1, 500, FRANK, 0, 0, "cash", "other", {}],
  ["10:06:34", "FLAT", 1, 1600, JERRY, 500, 100, "cc", "other", { seq: "5" }],
  ["10:13:13", "FLAT", 1, 1500, FRANK, 0, 0, null, "other", {}],
  ["10:37:47", "CHECK TIRE", 1, 500, FRANK, 0, 0, "cash", "other", {}],
  ["10:50:23", "FLAT", 1, 1600, JERRY, 0, 0, "cc", "other", { seq: "6" }],
  ["10:54:19", "CHECK TIRE", 1, 500, FRANK, 0, 0, "cc", "other", { seq: "7" }],
  ["11:18:37", "NEW VANTAGE 245-70-17", 2, 15000, FRANK, 0, 0, "cc", "new_tire", { seq: "8" }],
  ["11:22:28", "FLAT", 1, 1700, JERRY, 0, 0, "cc", "other", { seq: "9" }],
  ["11:35:37", "USED", 1, 5000, JERRY, 1000, 200, "cc", "used_tire", { seq: "11" }],
  ["11:42:39", "MOUNT & BALANCE", 2, 3500, FRANK, 0, 0, "cash", "other", {}],
  ["11:54:49", "CHECK TIRE", 1, 500, JERRY, 0, 0, "cash", "other", {}],
  ["12:01:59", "FLAT", 1, 1600, JERRY, 300, 100, "cc", "other", { seq: "12" }],
  ["12:06:15", "FLAT", 1, 1500, JERRY, 0, 0, "cash", "other", {}],
  ["12:13:26", "FLAT", 1, 1600, JERRY, 0, 0, "cc", "other", { seq: "13" }],
  ["12:23:11", "CHECK TIRE", 1, 500, FRANK, 0, 0, "cash", "other", {}],
  ["12:26:03", "FLAT", 1, 1600, JERRY, 0, 0, "cc", "other", { seq: "14" }],
  ["12:54:27", "FLAT", 1, 2000, FRANK, 0, 0, "cash", "other", {}],
  ["13:15:32", "FLAT", 1, 1500, FRANK, 0, 0, "cash", "other", {}],
  ["13:29:11", "FLAT", 1, 1500, FRANK, 0, 0, "cash", "other", {}],
  ["13:50:48", "NEW TOYO PEDIDO", 1, 26000, JERRY, 0, 0, "cash", "new_tire", { po: "15" }],
  ["13:55:04", "NEW SNAP", 4, 11000, FRANK, 0, 0, "snap", "new_tire", {}],
  ["13:55:24", "MOUNT & BALANCE", 3, 1500, FRANK, 0, 0, "cash", "other", { po: "16" }],
  ["14:06:42", "FLAT", 1, 1200, JERRY, 0, 0, "cash", "other", {}],
  ["14:08:24", "MOUNT & BALANCE", 1, 1500, JERRY, 0, 0, "cash", "other", { po: "17" }],
  ["14:28:33", "FLAT", 1, 1600, JERRY, 500, 100, "cc", "other", { seq: "18", note: "18 Y 19" }],
  ["14:41:45", "FLAT", 1, 1600, FRANK, 800, 200, "cc", "other", { seq: "20" }],
  ["14:56:52", "MOUNT & BALANCE", 1, 2000, FRANK, 0, 0, "cash", "other", {}],
  ["15:39:14", "USED 225-40-18 VANTAGE", 1, 11000, FRANK, 0, 0, "cc", "used_tire", { seq: "21" }],
  ["15:53:39", "NEW PEDIDO", 1, 20000, null, 0, 0, "cash", "new_tire", { po: "8406" }],
  ["16:15:13", "FLAT", 1, 2000, JERRY, 0, 0, "cash", "other", {}],
  ["16:15:49", "MOUNT & BALANCE", 1, 2000, FRANK, 0, 0, "other", "other", { po: "8407" }],
];

/**
 * The one row on the sheet that is money going the other way: a dollar out of
 * the drawer for a Coke. It is a purchase ticket, not a negative sale, because
 * the schema has no room for a negative line and this is genuinely the shop
 * spending rather than selling.
 */
const PURCHASE = ["14:38:56", "Coke", 1, 100];

/**
 * The weeks before, invented. Only the shape matters -- it exists so the
 * improvement column has a denominator. Deliberately uneven across the three
 * technicians so the chart shows a gain, a loss and a flat rather than three
 * identical bars that prove nothing.
 *
 * The dates are not arbitrary. The shop's week runs Thursday to Thursday
 * (`week_start_day = 4`), so around 2 August 2026 that makes the current week
 * Thu 30 Jul - Wed 5 Aug and the prior week Thu 23 Jul - Wed 29 Jul. Both are
 * filled here. Seeding only Mon-Sat, as an earlier version of this file did,
 * left the prior week three days long and made every technician's improvement
 * look like a collapse for reasons that had nothing to do with their work.
 */
const PRIOR = [
  // [date, mechanic, new tires, used tires, other lines, other cents each]
  // --- prior week: Thursday 23 July to Wednesday 29 July ---
  ["2026-07-23", JERRY, 1, 1, 5, 1500],
  ["2026-07-23", FRANK, 2, 0, 6, 1600],
  ["2026-07-24", JERRY, 2, 0, 7, 1600],
  ["2026-07-24", FRANK, 1, 1, 5, 1500],
  ["2026-07-24", JOSE, 1, 0, 4, 1500],
  ["2026-07-25", JERRY, 3, 1, 8, 1500],
  ["2026-07-25", FRANK, 2, 1, 7, 1600],
  ["2026-07-25", JOSE, 0, 2, 5, 1500],
  ["2026-07-26", FRANK, 1, 0, 4, 1500],
  ["2026-07-26", JOSE, 1, 1, 3, 1600],
  ["2026-07-27", JERRY, 2, 1, 6, 1600],
  ["2026-07-27", FRANK, 1, 0, 5, 1500],
  ["2026-07-28", JERRY, 1, 0, 7, 1500],
  ["2026-07-28", FRANK, 2, 1, 4, 1600],
  ["2026-07-28", JOSE, 1, 0, 3, 1500],
  ["2026-07-29", JERRY, 0, 2, 5, 1600],
  ["2026-07-29", FRANK, 3, 0, 6, 1500],
  // --- current week so far: Thursday 30 July onward, ahead of the real day ---
  ["2026-07-30", JERRY, 2, 0, 8, 1500],
  ["2026-07-30", FRANK, 1, 1, 5, 1600],
  ["2026-07-30", JOSE, 0, 1, 4, 1500],
  ["2026-07-31", JERRY, 1, 1, 9, 1600],
  ["2026-07-31", FRANK, 2, 0, 7, 1500],
  ["2026-08-01", JERRY, 3, 0, 6, 1500],
  ["2026-08-01", FRANK, 1, 2, 8, 1600],
  ["2026-08-01", JOSE, 1, 0, 5, 1500],
];

const NEW_TIRE_CENTS = 13500;
const USED_TIRE_CENTS = 6500;

// ---------------------------------------------------------------------------

function nextSaleNo() {
  const row = db.prepare("SELECT next_value FROM counters WHERE name = 'sale_no'").get();
  db.prepare("UPDATE counters SET next_value = next_value + 1 WHERE name = 'sale_no'").run();
  return `S-2026-${String(row.next_value).padStart(6, "0")}`;
}

/** Mirrors `recalcMoney` in src/lib/sales.ts, including its purchase sign flip. */
function recalc(saleId) {
  const s = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents),0) paid, COALESCE(SUM(tip_cents),0) tip,
              COALESCE(SUM(comm_cents),0) comm FROM payments WHERE sale_id = ?`,
    )
    .get(saleId);
  const h = db.prepare("SELECT subtotal_cents, kind FROM sales WHERE id = ?").get(saleId);
  const total = h.subtotal_cents + s.tip + s.comm;
  const settled = h.kind === "purchase" ? -s.paid : s.paid;
  db.prepare(
    `UPDATE sales SET tip_cents=?, comm_cents=?, total_cents=?, paid_cents=?, balance_cents=?
     WHERE id = ?`,
  ).run(s.tip, s.comm, total, s.paid, total - settled, saleId);
}

/** One ticket, one line, optionally settled. Returns the sale id. */
function ticket({
  date,
  at,
  desc,
  qty,
  unitCents,
  mechanicId,
  categoryId,
  tipCents = 0,
  commCents = 0,
  methodId = null,
  seq = null,
  po = null,
  note = null,
  kind = "sale",
  shiftId = null,
}) {
  const ts = `${date}T${at}`;
  const subtotal = qty * unitCents;
  const saleId = Number(
    db
      .prepare(
        `INSERT INTO sales (sale_no, business_date, opened_at, completed_at, status,
                            cashier_id, seq, po, notes, subtotal_cents, tax_rate_bp,
                            created_at, updated_at, kind)
         VALUES (?,?,?,?,'completed',?,?,?,?,?,825,?,?,?)`,
      )
      .run(
        nextSaleNo(),
        date,
        ts,
        ts,
        CASHIER,
        seq,
        po,
        note ? `${note} ${MARK}` : MARK,
        subtotal,
        ts,
        ts,
        kind,
      ).lastInsertRowid,
  );

  db.prepare(
    `INSERT INTO sale_items (sale_id, line_no, description, category_id, mechanic_id,
                             qty, unit_price_cents, line_total_cents, created_at, updated_at)
     VALUES (?,1,?,?,?,?,?,?,?,?)`,
  ).run(saleId, desc, categoryId, mechanicId, qty, unitCents, subtotal, ts, ts);

  if (methodId !== null) {
    const amount = kind === "purchase" ? -subtotal : subtotal + tipCents + commCents;
    db.prepare(
      `INSERT INTO payments (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents,
                             seq, taken_by, business_date, created_at, shift_id, mechanic_id)
       VALUES (?,?,'payment',?,?,?,?,?,?,?,?,?)`,
    ).run(
      saleId,
      methodId,
      amount,
      tipCents,
      commCents,
      seq,
      CASHIER,
      date,
      ts,
      shiftId,
      tipCents > 0 ? mechanicId : null,
    );
  }

  recalc(saleId);
  return saleId;
}

/**
 * Business dates that already carry example tickets.
 *
 * Seeding is per date rather than all-or-nothing so that adding a day to PRIOR
 * -- which happened when the week moved to Thursday-to-Thursday and the prior
 * week turned out to be three days long -- can be topped up by re-running,
 * instead of forcing a --remove that would take out the whole demo and
 * renumber every ticket in it.
 */
function seededDates() {
  return new Set(
    db
      .prepare("SELECT DISTINCT business_date d FROM sales WHERE notes LIKE ?")
      .all(`%${MARK}%`)
      .map((r) => r.d),
  );
}

function add() {
  const done = seededDates();

  const float = Number(
    db.prepare("SELECT value FROM settings WHERE key = 'register_float_cents'").get()?.value ??
      10000,
  );
  let dayCount = 0;
  if (!done.has(DAY)) {
    const shiftNo = db.prepare("SELECT next_value FROM counters WHERE name = 'shift_no'").get()
      .next_value;
    db.prepare("UPDATE counters SET next_value = next_value + 1 WHERE name = 'shift_no'").run();
    const shiftId = Number(
      db
        .prepare(
          `INSERT INTO shifts (shift_no, business_date, opened_at, opened_by,
                               opening_float_cents, is_open, created_at, updated_at)
           VALUES (?,?,?,?,?,1,?,?)`,
        )
        .run(
          `SH-2026-${String(shiftNo).padStart(6, "0")}`,
          DAY,
          `${DAY}T08:00:00`,
          CASHIER,
          float,
          `${DAY}T08:00:00`,
          `${DAY}T08:00:00`,
        ).lastInsertRowid,
    );

    for (const [at, desc, qty, unit, mech, tip, comm, method, cat, extra] of LINES) {
      ticket({
        date: DAY,
        at,
        desc,
        qty,
        unitCents: unit,
        mechanicId: mech,
        categoryId: CAT[cat],
        tipCents: tip,
        commCents: comm,
        methodId: method ? PM[method] : null,
        seq: extra.seq ?? null,
        po: extra.po ?? null,
        note: extra.note ?? null,
        shiftId,
      });
      dayCount++;
    }

    const [pAt, pDesc, pQty, pUnit] = PURCHASE;
    ticket({
      date: DAY,
      at: pAt,
      desc: pDesc,
      qty: pQty,
      unitCents: pUnit,
      mechanicId: null,
      categoryId: CAT.other,
      methodId: PM.cash,
      kind: "purchase",
      shiftId,
    });
    console.log(`Added ${dayCount} tickets + 1 purchase for ${DAY}.`);
    console.log(`Opened shift with a ${(float / 100).toFixed(2)} float.`);
  } else {
    console.log(`${DAY} is already seeded — left alone.`);
  }

  let priorCount = 0;
  const priorDays = new Set();
  for (const [date, mech, newT, usedT, otherN, otherCents] of PRIOR) {
    if (done.has(date)) continue;
    priorDays.add(date);
    let minute = 0;
    const stamp = () => {
      const m = minute++;
      return `${String(8 + Math.floor(m / 6)).padStart(2, "0")}:${String((m % 6) * 10).padStart(2, "0")}:00`;
    };
    if (newT > 0) {
      ticket({
        date,
        at: stamp(),
        desc: "NEW TIRE",
        qty: newT,
        unitCents: NEW_TIRE_CENTS,
        mechanicId: mech,
        categoryId: CAT.new_tire,
        methodId: PM.cc,
      });
      priorCount++;
    }
    if (usedT > 0) {
      ticket({
        date,
        at: stamp(),
        desc: "USED TIRE",
        qty: usedT,
        unitCents: USED_TIRE_CENTS,
        mechanicId: mech,
        categoryId: CAT.used_tire,
        methodId: PM.cash,
      });
      priorCount++;
    }
    for (let i = 0; i < otherN; i++) {
      ticket({
        date,
        at: stamp(),
        desc: i % 3 === 0 ? "FLAT" : i % 3 === 1 ? "MOUNT & BALANCE" : "CHECK TIRE",
        qty: 1,
        unitCents: otherCents,
        mechanicId: mech,
        categoryId: CAT.other,
        methodId: i % 2 === 0 ? PM.cash : PM.cc,
      });
      priorCount++;
    }
  }

  if (priorCount === 0) console.log("No earlier days to add.");
  else {
    const days = [...priorDays].sort();
    console.log(
      `Added ${priorCount} tickets across ${days.length} earlier days (${days[0]} – ${days[days.length - 1]}).`,
    );
  }
}

function remove() {
  const ids = db
    .prepare("SELECT id FROM sales WHERE notes LIKE ?")
    .all(`%${MARK}%`)
    .map((r) => r.id);
  if (ids.length === 0) {
    console.log("No example tickets found.");
    return;
  }
  const list = ids.join(",");
  db.prepare(`DELETE FROM payments WHERE sale_id IN (${list})`).run();
  db.prepare(`DELETE FROM sale_items WHERE sale_id IN (${list})`).run();
  db.prepare(`DELETE FROM sales WHERE id IN (${list})`).run();

  // Only drop the demo shift if nothing real is hanging off it. Real work does
  // land on this shift once someone starts using the app -- a drawer
  // withdrawal, a counted tender -- and deleting it out from under those rows
  // fails the foreign key and rolls the whole removal back, which reads as the
  // script being broken rather than as it protecting something.
  const shift = db
    .prepare("SELECT id FROM shifts WHERE business_date = ? AND closed_at IS NULL")
    .get(DAY);
  if (shift) {
    const held =
      db.prepare("SELECT COUNT(*) n FROM payments WHERE shift_id = ?").get(shift.id).n +
      db.prepare("SELECT COUNT(*) n FROM drawer_movements WHERE shift_id = ?").get(shift.id).n +
      db.prepare("SELECT COUNT(*) n FROM shift_counts WHERE shift_id = ?").get(shift.id).n;
    if (held === 0) db.prepare("DELETE FROM shifts WHERE id = ?").run(shift.id);
    else console.log(`Left shift ${shift.id} in place — ${held} real rows still point at it.`);
  }
  console.log(`Removed ${ids.length} example tickets.`);
}

const tx = db.transaction(process.argv.includes("--remove") ? remove : add);
tx();
db.close();
