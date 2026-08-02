import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SETTINGS,
  getAllSettings,
  setSetting,
  type SettingsMap,
} from "@/lib/settings";
import { logAudit } from "@/lib/audit";
import { jsonError, requireAdminApi } from "@/lib/api-helpers";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ settings: getAllSettings() });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: Partial<SettingsMap>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const allowedKeys = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsMap)[];
  const changes: Record<string, string> = {};
  for (const k of allowedKeys) {
    if (typeof body[k] === "string") {
      const v = body[k] as string;
      // Validate numeric settings
      if (
        k === "week_start_day" ||
        k === "auto_close_hour" ||
        k === "photo_retention_days" ||
        k === "break_auto_deduct_minutes" ||
        // A non-numeric value here would propagate NaN straight into money and
        // tax arithmetic, so reject it at the door.
        k === "tax_rate_bp" ||
        k === "tip_comm_per_cents" ||
        k === "tip_comm_charge_cents" ||
        k === "customer_prompt_threshold_cents" ||
        k === "business_day_start_hour" ||
        k === "pos_idle_lock_seconds" ||
        k === "search_log_retention_days"
      ) {
        const n = parseInt(v, 10);
        if (Number.isNaN(n)) return jsonError(`${k} must be a number`);
        if (k === "week_start_day" && (n < 0 || n > 6))
          return jsonError("week_start_day must be 0-6");
        if (k === "auto_close_hour" && (n < 0 || n > 23))
          return jsonError("auto_close_hour must be 0-23");
        if (k === "photo_retention_days" && n < 1)
          return jsonError("photo_retention_days must be ≥ 1");
        if (k === "break_auto_deduct_minutes" && n < 0)
          return jsonError("break_auto_deduct_minutes must be ≥ 0");
        if (k === "business_day_start_hour" && (n < 0 || n > 23))
          return jsonError("business_day_start_hour must be 0-23");
        if (k === "tax_rate_bp" && n < 0) return jsonError("tax_rate_bp must be ≥ 0");
        if (k === "tip_comm_per_cents" && n <= 0)
          return jsonError("tip_comm_per_cents must be > 0");
        if (k === "tip_comm_charge_cents" && n < 0)
          return jsonError("tip_comm_charge_cents must be ≥ 0");
        if (k === "pos_idle_lock_seconds" && n < 60)
          return jsonError("pos_idle_lock_seconds must be ≥ 60");
      }
      setSetting(k, v);
      changes[k] = v;
    }
  }

  if (Object.keys(changes).length > 0) {
    logAudit({
      adminId: auth.admin.adminId,
      adminUsername: auth.admin.username,
      action: "settings.update",
      details: changes,
    });
  }

  return NextResponse.json({ ok: true, settings: getAllSettings() });
}
