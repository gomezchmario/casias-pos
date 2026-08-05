import { getDb } from "./db";

export type SettingsMap = {
  company_name: string;
  company_address: string; // printed on receipts
  company_phone: string; // printed on receipts
  week_start_day: string; // "0" = Sunday, "1" = Monday, ... "6" = Saturday
  auto_close_hour: string; // "21" for 9pm
  photo_retention_days: string; // "90"
  break_auto_deduct_minutes: string; // "0" = disabled

  // POS
  tax_rate_bp: string; // basis points; prices are tax-INCLUSIVE
  tip_comm_per_cents: string; // charge per this much tip taken out...
  tip_comm_charge_cents: string; // ...this much commission ($1 per $5)
  customer_prompt_threshold_cents: string;
  business_day_start_hour: string; // business day runs from this hour to the same hour next day
  allow_oversell: string; // "1" = cashier may sell stock the system thinks is gone
  pos_idle_lock_seconds: string;
  receipt_footer: string;
  /**
   * The small print above the signature line on a receipt.
   *
   * A setting rather than a string baked into the page, because it is the one
   * thing on this document the shop is most likely to be told to change by
   * somebody who is not a programmer -- an insurer, an attorney, a new state
   * rule -- and that change should not have to wait on a deploy. Blanking it
   * removes the signature block along with it, for a shop that does not want
   * one.
   */
  receipt_disclaimer: string;
  search_log_retention_days: string;
  register_float_cents: string; // standing change fund, not takings
  // The most a cashier may take off a ticket without fetching a manager. A
  // number rather than a flat yes/no, because the everyday case -- a few dollars
  // off for a regular -- should not stop the counter, and the case worth
  // stopping is the large one.
  discount_cashier_max_cents: string;

  // The tire quoter — see tire-quote.ts for the chain these feed.
  //
  // Settings rather than constants because all three are commercial decisions
  // that move: the markup is the shop's margin, mount-and-balance is a posted
  // labour price, and the rounding step is how coarse the shop wants its quotes
  // to sound. None of them should need a programmer.
  //
  // The tax rate is deliberately NOT duplicated here. It is `tax_rate_bp`, the
  // same one the register rings on, because a quote computed at a different
  // rate than the ticket is a quote that comes apart at the counter.
  quote_margin_bp: string; // 2000 = 20%
  quote_mount_balance_cents: string;
  quote_round_to_cents: string; // 1000 = round up to the next $10

  // The last time somebody physically walked the racks and counted.
  //
  // Deliberately NOT derived from `inventory_movements`. The obvious derivation
  // is MAX(business_date) WHERE reason = 'count', and it is wrong in the exact
  // case that matters most: a count that agrees with the system books no
  // movement at all (qty_delta <> 0 is a CHECK), so a full, clean, everything-
  // matched count would leave this reading whatever the last DISAGREEMENT was.
  // The sheet would say "last checked in March" on the afternoon somebody
  // finished counting the whole shop. So it is stated, by the person who did it.
  last_inventory_check: string; // YYYY-MM-DD business date, "" = never
  last_inventory_check_by: string; // name, for the same reason the notice has one

  // "Yes, I know, stop shouting."
  //
  // The stock sheet turns orange after a week and a bit without a count and red
  // after a fortnight, and there are honest reasons to be behind — the counting
  // week is next week, the racks were half rebuilt. This restarts that colour
  // timer WITHOUT touching `last_inventory_check`, which is the whole design:
  // the strip goes quiet, and it still reads "last counted March 3" underneath,
  // because the alternative -- a Clear that stamps a count -- is a button that
  // launders "I don't want to see this" into "somebody walked the racks".
  inventory_alarm_cleared: string; // YYYY-MM-DD business date, "" = never
  inventory_alarm_cleared_by: string;

  // The board above the register: a standing note a manager leaves for whoever
  // is on the counter. Empty means no board is shown at all -- a permanently
  // visible box reading "(no notes)" is furniture people stop seeing, and the
  // whole value of this is that its presence means something.
  pos_notice: string;
  pos_notice_by: string; // name of whoever last wrote it, for accountability
  pos_notice_at: string; // local ISO, so the counter can see if it is stale
};

export const DEFAULT_SETTINGS: SettingsMap = {
  company_name: "Casias Muffler and Tire Shop",
  company_address: "8715 Grissom Rd, San Antonio, TX 78251",
  company_phone: "(210) 543-0909",
  // Thursday. The shop's week has always run Thursday to Thursday -- it is the
  // week the mechanics are measured and paid on, so it is the week every report
  // here uses. There is deliberately only ONE definition of the week: a
  // leaderboard running Thursday-Thursday beside a payroll report running
  // Sunday-Saturday would show the same technician two different totals for
  // "this week", and whichever one someone happened to be looking at would be
  // the one they argued from.
  week_start_day: "4",
  auto_close_hour: "21", // 9 PM
  photo_retention_days: "90",
  break_auto_deduct_minutes: "0",

  tax_rate_bp: "825", // 8.25%
  tip_comm_per_cents: "500",
  tip_comm_charge_cents: "100",
  customer_prompt_threshold_cents: "20000", // $200
  business_day_start_hour: "4",
  allow_oversell: "1",
  pos_idle_lock_seconds: "900", // 15 minutes
  receipt_footer: "Thank you for your business!",
  // A starting point, not legal advice -- the shop should read this and put its
  // own words here. Four sentences, in the order the day happened: the work was
  // authorised, it was inspected and accepted before the vehicle left, used
  // tires carry no warranty, and the shop is not holding the vehicle for you.
  //
  // The inspection sentence is the one that has to be signed to be worth
  // anything. It says the customer looked BEFORE DRIVING AWAY, because that is
  // the only version that answers the argument it exists to answer -- somebody
  // returning a week later saying the work was wrong when the shop cannot now
  // know what happened to the car in between.
  receipt_disclaimer:
    "I authorized the work described above and accept the charges shown. " +
    "I have inspected the completed work before taking delivery of the vehicle " +
    "and accept it as satisfactory. " +
    "Used tires are sold as-is, with no warranty expressed or implied. " +
    "The shop is not responsible for vehicles or property left after closing.",
  search_log_retention_days: "180",
  register_float_cents: "10000", // $100 in the drawer to make change with
  discount_cashier_max_cents: "1500", // $15

  quote_margin_bp: "2000", // 20%
  quote_mount_balance_cents: "3500", // $35
  quote_round_to_cents: "1000", // next $10

  last_inventory_check: "",
  last_inventory_check_by: "",

  inventory_alarm_cleared: "",
  inventory_alarm_cleared_by: "",

  pos_notice: "",
  pos_notice_by: "",
  pos_notice_at: "",
};

export function getSetting<K extends keyof SettingsMap>(key: K): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key];
}

export function getAllSettings(): SettingsMap {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value;
  return map as SettingsMap;
}

export function setSetting<K extends keyof SettingsMap>(
  key: K,
  value: string,
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function ensureDefaultSettings(): void {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  );
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    stmt.run(k, v);
  }
}
