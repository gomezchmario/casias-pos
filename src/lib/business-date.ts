import { getSetting } from "./settings";
import { localIsoToDate, nowLocalIso, toLocalIso } from "./time";

/**
 * A ticket corrected at 12:30am after a 9pm close still belongs to the previous
 * business day. Everything that buckets money by day MUST come through here —
 * never `created_at.slice(0, 10)`, which would split one day's takings in two.
 *
 * The business day runs from `business_day_start_hour` (default 4am) to the
 * same hour the next morning.
 */
export function businessDateFor(localIso: string): string {
  const startHour = Number(getSetting("business_day_start_hour"));
  const d = localIsoToDate(localIso);
  if (d.getHours() < startHour) {
    d.setDate(d.getDate() - 1);
  }
  return toLocalIso(d).slice(0, 10);
}

export function currentBusinessDate(): string {
  return businessDateFor(nowLocalIso());
}
