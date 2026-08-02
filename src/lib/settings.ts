import { getDb } from "./db";

export type SettingsMap = {
  company_name: string;
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
  search_log_retention_days: string;
};

export const DEFAULT_SETTINGS: SettingsMap = {
  company_name: "Casias Tire Shop",
  week_start_day: "0", // Sunday
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
  search_log_retention_days: "180",
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
