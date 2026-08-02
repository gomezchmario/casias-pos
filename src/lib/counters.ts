import { getDb } from "./db";

export type CounterName = "sale_no" | "customer_no" | "lot_no" | "shift_no";

/**
 * Allocate the next number for a counter. The UPDATE ... RETURNING is a single
 * atomic statement, so two callers can never be handed the same number.
 */
export function nextCounterValue(name: CounterName): number {
  const db = getDb();
  const row = db
    .prepare("UPDATE counters SET next_value = next_value + 1 WHERE name = ? RETURNING next_value")
    .get(name) as { next_value: number } | undefined;
  if (!row) throw new Error(`Unknown counter: ${name}`);
  return row.next_value - 1;
}

export function nextSaleNo(): string {
  const year = new Date().getFullYear();
  return `S-${year}-${String(nextCounterValue("sale_no")).padStart(6, "0")}`;
}

export function nextCustomerNo(): string {
  return `C-${String(nextCounterValue("customer_no")).padStart(6, "0")}`;
}

export function nextLotNo(): string {
  return `L-${String(nextCounterValue("lot_no")).padStart(6, "0")}`;
}

export function nextShiftNo(): string {
  const year = new Date().getFullYear();
  return `SH-${year}-${String(nextCounterValue("shift_no")).padStart(6, "0")}`;
}
