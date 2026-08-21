import { getSetting } from "./settings";
import { clockOf } from "./schedule";

/**
 * The register at night.
 *
 * One question, answered on the server the way the fence's is: may THIS
 * person open the register NOW. The fence judges where; this judges when and
 * who. An owner is never refused — the curfew is the owner's own rule, and a
 * rule that could lock its author out at 2 AM the night the alarm goes off
 * would be enforced exactly once. Everybody else needs to be on the allow
 * list to open the register inside the window.
 *
 * ENTRY ONLY. A session alive at 8 PM keeps working until it locks itself —
 * cutting a half-rung ticket off mid-payment would trade a rule about doors
 * for a broken drawer. The lock screen is the enforcement point: the idle
 * lock fires soon enough, and reopening is entering.
 */
export type CurfewConfig = {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  allow: number[];
};

export function curfewConfig(): CurfewConfig {
  const start = Number(getSetting("register_curfew_start_minute"));
  const end = Number(getSetting("register_curfew_end_minute"));
  return {
    enabled: getSetting("register_curfew_enabled") === "1",
    startMinute: Number.isFinite(start) ? Math.min(1439, Math.max(0, Math.trunc(start))) : 1200,
    endMinute: Number.isFinite(end) ? Math.min(1439, Math.max(0, Math.trunc(end))) : 360,
    allow: getSetting("register_curfew_allow")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  };
}

/** Is this minute of the day inside the window? 1200 → 360 wraps midnight. */
export function insideCurfew(minute: number, cfg: CurfewConfig): boolean {
  const { startMinute: a, endMinute: b } = cfg;
  if (a === b) return false; // a zero-length window is no window
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
}

/**
 * The refusal, in words, or null where the door opens.
 *
 * `now` is a parameter for the tests and defaults to the wall clock — the
 * shop's own machine, which is the same clock every business date is cut by.
 */
export function curfewRefusal(
  user: { employeeId: number; role: string },
  now: Date = new Date(),
): string | null {
  const cfg = curfewConfig();
  if (!cfg.enabled) return null;
  if (user.role === "owner") return null;
  if (cfg.allow.includes(user.employeeId)) return null;

  const minute = now.getHours() * 60 + now.getMinutes();
  if (!insideCurfew(minute, cfg)) return null;

  return `The register is closed from ${clockOf(cfg.startMinute)} to ${clockOf(cfg.endMinute)}. If you need it at night, that is a conversation with the owner.`;
}
