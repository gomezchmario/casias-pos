import { getSetting } from "./settings";
import type { InventoryCheck } from "./inventory-alarm";

/**
 * When the racks were last actually counted, and when somebody last told the
 * alarm about it to be quiet.
 *
 * The two travel together because no screen should ever show one without the
 * other. A quiet strip beside "last counted in March" reads as a bug; a quiet
 * strip that also names who quieted it, and when, reads as a decision somebody
 * made and can be asked about.
 *
 * Lives here rather than in the inventory route because three routes need it —
 * the register's sheet, the settings page that can silence it, and the no-login
 * copy on the kiosk — and a route file is not an import target.
 */
export function readInventoryCheck(): InventoryCheck {
  return {
    date: getSetting("last_inventory_check"),
    by: getSetting("last_inventory_check_by"),
    clearedOn: getSetting("inventory_alarm_cleared"),
    clearedBy: getSetting("inventory_alarm_cleared_by"),
  };
}
