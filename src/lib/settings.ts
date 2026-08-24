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
  /**
   * The floor the shop assumes it made on a tire it has no cost for.
   *
   * A MARKUP ON COST, the same direction as `quote_margin_bp` and the same
   * arithmetic the quoter shows as "Markup 20%": cost = price / 1.20. Kept as
   * its own key rather than reusing the quote margin, because changing what the
   * counter quotes tomorrow must not silently restate what the shop earned last
   * March.
   *
   * Set to 0 to switch the assumption off entirely and go back to counting only
   * tires with a real cost recorded.
   */
  assumed_tire_markup_bp: string; // 2000 = 20%
  /** What the shop assumes it paid on the IMPORTED years. See assumedCostSql. */
  assumed_history_markup_bp: string; // 2000 = 20%
  quote_mount_balance_cents: string;
  quote_round_to_cents: string; // 1000 = round up to the next $10

  /**
   * What one tire's fitting is worth to the technician who fitted it, when a
   * line names somebody other than the person who sold it. See
   * migrations/018_mount_credit.sql.
   *
   * Starts life equal to `quote_mount_balance_cents` and is deliberately NOT
   * the same setting, however tempting that looks while both read $35. One is
   * what a customer is quoted for mounting; this is what the shop credits a
   * technician internally. Folded into one key, raising the posted price would
   * silently move what everybody gets paid -- and it would move it on the
   * quietest possible change, made by whoever was tidying up the quoter.
   */
  mount_credit_cents: string;

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

  // "1" = the register shows the lost-sale button. See DEFAULT_SETTINGS.
  tire_demand_enabled: string;

  // The board above the register: a standing note a manager leaves for whoever
  // is on the counter. Empty means no board is shown at all -- a permanently
  // visible box reading "(no notes)" is furniture people stop seeing, and the
  // whole value of this is that its presence means something.
  pos_notice: string;
  pos_notice_by: string; // name of whoever last wrote it, for accountability
  pos_notice_at: string; // local ISO, so the counter can see if it is stale

  /*
    THE FENCE: punch the clock here, or on a device the shop trusts.

    Empty coordinates mean no fence at all and every punch is allowed, which is
    the state the shop starts in and must keep working in — switching this on
    is a deliberate act, not something a fresh install inflicts on anybody.

    NOT geocoded from the company address, deliberately. An address lands on
    the road centreline or the wrong end of a lot, and a fence built on one is
    fifty metres wrong before anybody stands in it. These are written by
    somebody standing at the counter pressing a button on a phone that has real
    GPS — see the admin settings page.

    The radius is metres. Generous by default: a phone indoors, behind a metal
    roll-up door, reports a worse fix than the same phone in the lot, and a
    fence tight enough to be satisfying is a fence that locks out the person
    standing in the bay.
  */
  timeclock_fence_lat: string; // "" = no fence
  timeclock_fence_lng: string;
  timeclock_fence_radius_m: string;
  timeclock_fence_set_by: string; // who stood there and pressed it
  timeclock_fence_set_at: string; // local ISO

  /*
    "1" = only enrolled devices may punch the clock at all.

    Stricter than the fence and it replaces it rather than adding to it: with
    this on, standing in the lot is not enough — the device itself has to be
    one the shop enrolled. For a shop that hands out the tablet and wants the
    clock punched on that and nothing else.

    The route refuses to switch this on while no device is trusted, because
    the state it would create is one where nobody in the building can clock in
    and the only way back is a database edit.
  */
  timeclock_trusted_only: string;

  /*
    The register at night.

    "1" = between the two minutes below, the register refuses to open for
    anyone but the owner and the names on the allow list. The fence answers
    WHERE a session may start; this answers WHEN — a register that opens at
    2 AM for anybody with a PIN is a drawer with a timer nobody set.

    The window is minutes from midnight and is expected to WRAP: 1200 → 360
    is 8 PM to 6 AM. The allow list is employee ids, comma-separated —
    ids rather than names because names get remarried and retyped.
  */
  register_curfew_enabled: string;
  register_curfew_start_minute: string;
  register_curfew_end_minute: string;
  register_curfew_allow: string;

  /*
    "1" = the wall board's tips corner is drawn, and the public endpoint
    sends tip figures at all. Off, the server sends zeros and a flag — the
    corner is not hidden by the screen, it is absent from the data, because
    a wall monitor is exactly the place where "hidden by CSS" is a euphemism
    for "published".
  */
  leaderboard_show_tips: string;

  /*
    The still-on-the-clock warning's leash. "1" = it fires at all; the minute
    is when it starts firing on the current day (minutes from midnight,
    1110 = 6:30 PM). Before that hour everybody is SUPPOSED to be on the
    clock, and a warning that cries all day is a warning nobody reads at
    night. Past days are exempt from the hour — their loose ends are news
    whenever they are found.
  */
  onclock_alarm_enabled: string;
  onclock_alarm_minute: string;
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
  /*
    Zero: the customer and vehicle panel never opens itself.

    It was $200, which on a counter where a set of four is four hundred meant it
    unfolded on nearly every ticket — a panel that is open by default without
    ever having been asked for. It is still one number away from coming back:
    put a figure here and the panel opens itself again once a ticket reaches it.

    This is only the prompt. A ticket going on the house account still forces
    the panel open and still refuses to fold away, because a tab with no name on
    it is money the shop cannot chase.
  */
  customer_prompt_threshold_cents: "0",
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
  assumed_tire_markup_bp: "2000", // 20%
  assumed_history_markup_bp: "2000", // 20%
  quote_mount_balance_cents: "3500", // $35
  quote_round_to_cents: "1000", // next $10

  mount_credit_cents: "3500", // $35 a tire, to whoever fitted it

  last_inventory_check: "",
  last_inventory_check_by: "",

  inventory_alarm_cleared: "",
  inventory_alarm_cleared_by: "",

  /**
   * Whether the register offers the lost-sale button.
   *
   * A switch rather than always-on because it is a study, not a feature of
   * ringing a sale: the shop turns it on when it wants a few months of data
   * about what to buy, and off again afterwards. A permanently floating button
   * that nobody has a reason to press is a button people learn to ignore, and
   * then it is useless on the day somebody does want the numbers.
   */
  tire_demand_enabled: "0",

  pos_notice: "",
  pos_notice_by: "",
  pos_notice_at: "",

  // No fence until somebody sets one. See the type above for why these are not
  // seeded from the company address.
  timeclock_fence_lat: "",
  timeclock_fence_lng: "",
  timeclock_fence_radius_m: "250",
  timeclock_fence_set_by: "",
  timeclock_fence_set_at: "",
  timeclock_trusted_only: "0",
  register_curfew_enabled: "0",
  register_curfew_start_minute: "1200",
  register_curfew_end_minute: "360",
  register_curfew_allow: "",
  leaderboard_show_tips: "1",
  onclock_alarm_enabled: "1",
  onclock_alarm_minute: "1110",
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
