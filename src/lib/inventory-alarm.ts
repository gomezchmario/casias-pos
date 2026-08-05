/**
 * How loudly the stock sheet complains about not having been counted.
 *
 * Deliberately free of any server import, because three screens need the same
 * answer: the register's inventory page, the settings page that can silence it,
 * and the no-login sheet on the kiosk. Two of those run in the browser, and a
 * second copy of "8 days" living in one of them is how a shop ends up with a
 * sheet that says orange and a settings page that says it is fine.
 */

/** Long enough that a normal busy week never trips it. */
export const ALARM_WARN_DAYS = 8;

/** Past this, the number on the sheet is folklore. */
export const ALARM_ALERT_DAYS = 15;

export type AlarmLevel = "ok" | "warn" | "alert";

export type InventoryCheck = {
  /** YYYY-MM-DD business date of the last real count. "" = never. */
  date: string;
  by: string;
  /** YYYY-MM-DD the alarm was last silenced. "" = never. */
  clearedOn: string;
  clearedBy: string;
};

/**
 * Whole days between a YYYY-MM-DD and today, in local time.
 *
 * Split by hand rather than `new Date(iso)`, which reads a bare date as UTC and
 * so lands a day early across all of the Americas. A stock sheet dated one day
 * early is the kind of wrong nobody notices and everybody argues about.
 */
export function daysSinceDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - then) / 86_400_000);
}

/**
 * "2026-08-03" → "Monday, August 3".
 *
 * A weekday rather than a bare date, because "Wednesday" is how anybody in the
 * shop remembers whether they were the one holding the clipboard.
 */
export function formatCheckDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * The colour of the strip.
 *
 * Measured from the LATER of the last count and the last time somebody cleared
 * the alarm, so clearing buys another eight quiet days rather than silencing it
 * forever — an alarm you can turn off permanently is one that gets turned off
 * permanently on its second day.
 *
 * Never counted and never cleared is `warn`, not `alert`. It is tempting to
 * make it the loudest thing on the screen, but "we have no idea" is not the
 * same claim as "fifteen days stale", and a brand-new install screaming red at
 * a shop that has not had a chance to count anything yet teaches everyone that
 * red on this strip means nothing.
 */
export function alarmLevel(check: InventoryCheck): AlarmLevel {
  const from = check.clearedOn > check.date ? check.clearedOn : check.date;
  if (!from) return "warn";
  const days = daysSinceDate(from);
  if (days >= ALARM_ALERT_DAYS) return "alert";
  if (days >= ALARM_WARN_DAYS) return "warn";
  return "ok";
}

/**
 * Background and border for a strip at each level.
 *
 * Green rather than grey for `ok`, because a neutral strip reads as "this
 * feature is off" and a green one reads as "somebody checked". The strip is
 * worth its space on the screen only if the good state says something.
 */
export const ALARM_STYLE: Record<AlarmLevel, { background: string; border: string }> = {
  ok: { background: "rgba(22,163,74,0.10)", border: "1px solid rgba(22,163,74,0.30)" },
  warn: { background: "rgba(234,179,8,0.18)", border: "1px solid rgba(202,138,4,0.45)" },
  alert: { background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.40)" },
};

/**
 * A glyph for the two levels that want to be noticed.
 *
 * Colour alone is not enough on this strip: it sits on a white page that
 * already has coloured buttons on it, roughly one man in twelve struggles to
 * separate the green from the red, and the sheet gets printed in black and
 * white where all three look identical. The glyph survives all three.
 *
 * `ok` gets nothing on purpose. A green tick on every visit is a thing people
 * stop seeing within a week, and then the warning glyph is just another
 * character in a line they have learned to skip.
 */
export const ALARM_ICON: Record<AlarmLevel, string> = {
  ok: "",
  warn: "⚠️",
  alert: "🛑",
};
