/**
 * Two weeks of made-up trading, so the screens have something to show.
 *
 * This WIPES every sale, sale line, payment, shift and drawer movement first
 * and renumbers tickets from S-2026-000001. That is only defensible because
 * this is a test box and none of those rows ever described real money -- the
 * shop's own rule is that ledgers are append-only, and nothing in the app
 * itself is allowed to do what this script does. Do not run it once the till
 * is live.
 *
 *   node scripts/seed-mock-fortnight.mjs           show what it would do
 *   node scripts/seed-mock-fortnight.mjs --apply   do it
 *
 * The day runs 07:00 to 12:00, which is what was asked for. Sundays are left
 * out on the assumption the shop is shut; say so and it is one line to change.
 */

import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new Database(path.join(root, "data", "timeclock.db"));
db.pragma("foreign_keys = ON");

const APPLY = process.argv.includes("--apply");

/** The last day seeded. Everything counts backwards from here. */
const LAST_DAY = "2026-08-04";
const DAYS = 14;
const OPEN_HOUR = 7;
const CLOSE_HOUR = 12;

const CASHIER = 5; // Ivan, at the counter
/** Who was in the bays. Ids off the live roster. */
const MECHANICS = [6, 7, 8, 10, 11, 12, 13];

const CAT = { new_tire: 1, used_tire: 2, oil_change: 3, disposal: 4, other: 5, battery: 6 };
const PM = { cash: 1, cc: 2, snap: 3, credit_account: 7 };

/**
 * A fixed seed, so re-running produces the same fortnight.
 *
 * Mock data that reshuffles itself every run is worse than useless for
 * eyeballing a screen change: you cannot tell whether the number moved because
 * of your edit or because the dice did. Mulberry32 -- small, and its only job
 * is to look unplanned.
 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260804);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

/** Sizes as the shop writes them: 205-55-16, never 205/55R16. */
const SIZES = [
  "175-70-13", "185-65-14", "195-65-15", "205-55-16", "215-60-16",
  "225-65-17", "235-75-15", "245-70-17", "265-70-17",
];
const BRANDS = ["GOODYEAR", "MICHELIN", "VANTAGE", "TOYO", "COOPER", "FIRESTONE"];

/**
 * What gets rung, and how often.
 *
 * Weighted, because a real day is mostly flats and check-tires with the
 * occasional set of new tires -- and a flat distribution would make the
 * leaderboard and the category split both look nothing like the shop. Weights
 * are relative; they do not need to add to anything.
 */
const MENU = [
  { w: 26, cat: "other", desc: () => "FLAT", qty: () => 1, price: () => between(15, 20) * 100 },
  { w: 14, cat: "other", desc: () => "CHECK TIRE", qty: () => 1, price: () => 500 },
  {
    w: 16, cat: "other", desc: () => "MOUNT & BALANCE",
    qty: () => between(1, 4), price: () => between(15, 25) * 100,
  },
  { w: 6, cat: "other", desc: () => "ROTACION", qty: () => 1, price: () => 2000 },
  {
    w: 10, cat: "used_tire", desc: () => `USED ${pick(SIZES)}`,
    qty: () => between(1, 2), price: () => between(45, 70) * 100,
  },
  {
    w: 12, cat: "new_tire", desc: () => `NEW ${pick(BRANDS)} ${pick(SIZES)}`,
    qty: () => between(1, 4), price: () => between(95, 175) * 100,
  },
  {
    // Grade and price picked together, not independently. Drawing them
    // separately put a $95 synthetic-blend on the board, which is the sort of
    // detail that makes somebody stop trusting the whole screen.
    w: 6, cat: "oil_change",
    pair: () => pick([["OIL CHANGE SB", 4500], ["OIL CHANGE FS", 7500], ["OIL CHANGE M1", 9500]]),
    qty: () => 1,
  },
  { w: 5, cat: "disposal", desc: () => "DISPOSAL", qty: () => between(1, 4), price: () => 300 },
  { w: 3, cat: "battery", desc: () => "BATTERY", qty: () => 1, price: () => between(110, 160) * 100 },
];
const MENU_TOTAL = MENU.reduce((a, m) => a + m.w, 0);
function menuItem() {
  let n = rand() * MENU_TOTAL;
  for (const m of MENU) if ((n -= m.w) <= 0) return m;
  return MENU[0];
}

/** The shop's own rule: it keeps $1 of every $5 tipped, rounded up. */
const commissionOn = (tipCents) => (tipCents > 0 ? Math.ceil(tipCents / 500) * 100 : 0);

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The fortnight, most recent last, Sundays dropped. */
function businessDays() {
  const out = [];
  const end = new Date(`${LAST_DAY}T00:00:00`);
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    if (d.getDay() !== 0) out.push(dateStr(d));
  }
  return out;
}

// --- the wipe --------------------------------------------------------------

function wipe() {
  const before = db.prepare("SELECT COUNT(*) n FROM sales").get().n;
  // Children first, then parents. Inventory movements that belong to a sale go
  // with it; stock received or counted by hand does not, and is left alone.
  db.prepare("DELETE FROM inventory_movements WHERE sale_id IS NOT NULL").run();
  db.prepare("DELETE FROM payments").run();
  db.prepare("DELETE FROM sale_items").run();
  db.prepare("DELETE FROM sales").run();
  db.prepare("DELETE FROM shift_counts").run();
  db.prepare("DELETE FROM drawer_movements").run();
  db.prepare("DELETE FROM shifts").run();
  // The audit trail of rows that no longer exist is noise, not history.
  db.prepare("DELETE FROM audit_log WHERE target_type IN ('sale','payment','shift')").run();
  db.prepare("UPDATE counters SET next_value = 1 WHERE name IN ('sale_no','shift_no')").run();
  return before;
}

// --- writing a ticket ------------------------------------------------------

function nextNo(counter, prefix) {
  const row = db.prepare("SELECT next_value FROM counters WHERE name = ?").get(counter);
  db.prepare("UPDATE counters SET next_value = next_value + 1 WHERE name = ?").run(counter);
  return `${prefix}-2026-${String(row.next_value).padStart(6, "0")}`;
}

/** Mirrors `recalcMoney` in src/lib/sales.ts. */
function recalc(saleId) {
  const s = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents),0) paid, COALESCE(SUM(tip_cents),0) tip,
              COALESCE(SUM(comm_cents),0) comm FROM payments WHERE sale_id = ?`,
    )
    .get(saleId);
  const h = db.prepare("SELECT subtotal_cents, kind, status FROM sales WHERE id = ?").get(saleId);
  const total = h.subtotal_cents + s.tip + s.comm;
  const settled = h.kind === "purchase" ? -s.paid : s.paid;
  db.prepare(
    `UPDATE sales SET tip_cents=?, comm_cents=?, total_cents=?, paid_cents=?, balance_cents=?
     WHERE id = ?`,
  ).run(s.tip, s.comm, total, s.paid, h.status === "voided" ? 0 : total - settled, saleId);
}

function writeTicket({ date, at, lines, status, methodId, payCents, tipCents, seq, po, note, shiftId }) {
  const ts = `${date}T${at}`;
  const subtotal = lines.reduce((a, l) => a + l.qty * l.unitCents, 0);
  const saleId = Number(
    db
      .prepare(
        `INSERT INTO sales (sale_no, business_date, opened_at, completed_at, status,
                            cashier_id, seq, po, notes, subtotal_cents, tax_rate_bp,
                            created_at, updated_at, kind)
         VALUES (?,?,?,?,?,?,?,?,?,?,825,?,?,'sale')`,
      )
      .run(
        nextNo("sale_no", "S"), date, ts,
        status === "completed" ? ts : null,
        status, CASHIER, seq, po, note, subtotal, ts, ts,
      ).lastInsertRowid,
  );

  lines.forEach((l, i) => {
    db.prepare(
      `INSERT INTO sale_items (sale_id, line_no, description, category_id, mechanic_id,
                               qty, unit_price_cents, line_total_cents, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(saleId, i + 1, l.desc, l.categoryId, l.mechanicId, l.qty, l.unitCents,
          l.qty * l.unitCents, ts, ts);
  });

  if (payCents > 0) {
    const comm = commissionOn(tipCents);
    db.prepare(
      `INSERT INTO payments (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents,
                             seq, taken_by, business_date, created_at, shift_id, mechanic_id)
       VALUES (?,?,'payment',?,?,?,?,?,?,?,?,?)`,
    ).run(saleId, methodId, payCents + tipCents + comm, tipCents, comm, seq, CASHIER, date, ts,
          shiftId, tipCents > 0 ? lines[0].mechanicId : null);
  }

  recalc(saleId);
  return saleId;
}

// --- the fortnight ---------------------------------------------------------

function seed() {
  const days = businessDays();
  let tickets = 0;
  let owing = 0;

  for (const date of days) {
    const isToday = date === LAST_DAY;
    const shiftId = Number(
      db
        .prepare(
          `INSERT INTO shifts (shift_no, business_date, opened_at, opened_by,
                               opening_float_cents, is_open, closed_at, closed_by,
                               created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          nextNo("shift_no", "SH"), date, `${date}T06:50:00`, CASHIER, 10000,
          isToday ? 1 : 0,
          isToday ? null : `${date}T12:30:00`,
          isToday ? null : CASHIER,
          `${date}T06:50:00`, `${date}T06:50:00`,
        ).lastInsertRowid,
    );

    // Ten-ish, spread across the five hours the doors are open. The minutes are
    // sorted rather than dealt in order so the gaps between tickets are uneven,
    // which is what a real morning looks like -- three in ten minutes, then
    // nothing for half an hour.
    const count = between(8, 12);
    const span = (CLOSE_HOUR - OPEN_HOUR) * 60;
    const minutes = Array.from({ length: count }, () => between(0, span - 1)).sort((a, b) => a - b);

    // Today is still in progress: only the tickets up to the current hour exist.
    const stops = isToday ? Math.max(3, Math.floor(count * 0.7)) : count;

    for (let i = 0; i < stops; i++) {
      const m = minutes[i];
      const at =
        `${String(OPEN_HOUR + Math.floor(m / 60)).padStart(2, "0")}:` +
        `${String(m % 60).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}`;

      // Most tickets are one thing. Occasionally somebody buys tires and has
      // them disposed of in the same breath, and the second line goes to
      // whoever was free -- which is why mechanic sits on the line, not the
      // ticket.
      const lineCount = rand() < 0.18 ? 2 : 1;
      const lines = [];
      for (let n = 0; n < lineCount; n++) {
        const item = menuItem();
        const [desc, unitCents] = item.pair ? item.pair() : [item.desc(), item.price()];
        lines.push({
          desc,
          categoryId: CAT[item.cat],
          mechanicId: pick(MECHANICS),
          qty: item.qty(),
          unitCents,
        });
      }
      const subtotal = lines.reduce((a, l) => a + l.qty * l.unitCents, 0);

      // Cash for the small stuff, card for the big -- and the odd SNAP or house
      // account on a tire job, because both exist and both need to be visible
      // on the day's split.
      const methodId =
        subtotal >= 9000
          ? pick([PM.cc, PM.cc, PM.cc, PM.snap, PM.credit_account])
          : pick([PM.cash, PM.cash, PM.cash, PM.cc]);
      const isCard = methodId === PM.cc;

      // A tip on roughly one card job in four, always a round five.
      const tipCents = isCard && rand() < 0.25 ? between(1, 4) * 500 : 0;

      // A few tickets are left owing, which is the whole point of the amber on
      // Entries -- a screen that never shows the state it was built for is a
      // screen nobody trusts when it finally does.
      const roll = rand();
      let status = "completed";
      let payCents = subtotal;
      if (roll < 0.04) {
        // Ordered and part-paid: a deposit down, the rest on collection.
        payCents = Math.round(subtotal / 2 / 100) * 100;
      } else if (roll < 0.07) {
        // Rung up, walked out to the cash machine, not back yet.
        status = "open";
        payCents = 0;
      }

      writeTicket({
        date, at, lines, status,
        methodId,
        payCents,
        tipCents: payCents > 0 ? tipCents : 0,
        seq: isCard && payCents > 0 ? String(between(1, 60)) : null,
        po: null,
        note: payCents > 0 && payCents < subtotal ? "DEPOSIT — BALANCE ON PICKUP" : null,
        shiftId,
      });
      tickets++;
      if (payCents < subtotal) owing++;
    }
  }

  return { days: days.length, tickets, owing };
}

// ---------------------------------------------------------------------------

if (!APPLY) {
  const n = db.prepare("SELECT COUNT(*) n FROM sales").get().n;
  const days = businessDays();
  console.log(`Would delete ${n} sales and every payment, line, shift and drawer movement.`);
  console.log(`Would seed ${days.length} days, ${days[0]} to ${days[days.length - 1]}, 8-12 tickets each,`);
  console.log(`between ${OPEN_HOUR}:00 and ${CLOSE_HOUR}:00, renumbered from S-2026-000001.`);
  console.log("Re-run with --apply to do it.");
} else {
  const tx = db.transaction(() => {
    const removed = wipe();
    const r = seed();
    return { removed, ...r };
  });
  const r = tx();
  console.log(`Cleared ${r.removed} old sales.`);
  console.log(`Seeded ${r.tickets} tickets across ${r.days} days (${r.owing} left owing).`);
}

db.close();
