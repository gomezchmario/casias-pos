import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { accountMonth } from "@/lib/credit-accounts";
import { currentBusinessDate } from "@/lib/business-date";
import { getSetting } from "@/lib/settings";

/** A month of house accounts: what was owed, what went on, what came in. */
export async function GET(req: NextRequest) {
  const auth = await requirePos("manageCreditAccounts");
  if (!auth.ok) return auth.response;

  const asked = req.nextUrl.searchParams.get("month");
  // Anything that is not a month falls back to the one we are in. A malformed
  // string would otherwise produce a page of zeroes headed by a date nobody
  // typed, which reads as "nobody owes anything" rather than as a bad request.
  const month = asked && /^\d{4}-\d{2}$/.test(asked)
    ? asked
    : currentBusinessDate().slice(0, 7);

  // Sent with the figures rather than fetched separately by the page. It is
  // only wanted for the letterhead, and a sheet that printed with a blank name
  // because a second request had not landed yet would be a sheet somebody files.
  return NextResponse.json({
    ...accountMonth(month),
    shopName: getSetting("company_name") ?? "Casias Tire Shop",
  });
}
