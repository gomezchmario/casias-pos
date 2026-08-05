import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { setSetting } from "@/lib/settings";
import { currentBusinessDate } from "@/lib/business-date";
import { logActorAudit } from "@/lib/audit";
import { inTx } from "@/lib/tx";
import { readInventoryCheck } from "@/lib/inventory-check";

/**
 * Silence the stock-sheet alarm for another eight days.
 *
 * Its own endpoint, and not part of the settings PATCH, because it is an act
 * rather than a value: somebody with their name on it decided the shop can live
 * with an uncounted rack a while longer. That reads badly as `{"cleared":true}`
 * in a bag of other fields, and it audits badly too.
 *
 * What it very deliberately does NOT do is touch `last_inventory_check`. The
 * obvious shortcut — clear the alarm by stamping a count — would turn a button
 * meaning "I know" into a button meaning "somebody walked the racks", and the
 * sheet would then lie to the next person who printed it. The strip stays
 * honest: it goes quiet, and it says underneath who quieted it.
 */
export async function POST() {
  const auth = await requirePos("manageSettings");
  if (!auth.ok) return auth.response;

  const before = readInventoryCheck();
  const date = currentBusinessDate();

  inTx(() => {
    setSetting("inventory_alarm_cleared", date);
    setSetting("inventory_alarm_cleared_by", auth.user.name);
    logActorAudit(auth.actor, {
      action: "settings.update",
      targetType: "setting",
      targetId: "inventory_alarm_cleared",
      before,
      after: { ...before, clearedOn: date, clearedBy: auth.user.name },
    });
  });

  return NextResponse.json(readInventoryCheck());
}
