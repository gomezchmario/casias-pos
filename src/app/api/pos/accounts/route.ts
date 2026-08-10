import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { listAccounts } from "@/lib/credit-accounts";

/**
 * The house-account book: everyone who has ever run a tab, and what they owe.
 *
 * `manageCreditAccounts` — owner and accountant. Not managers, who run the floor
 * and have no part in what a customer owes over a month.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("manageCreditAccounts");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  return NextResponse.json({
    accounts: listAccounts({
      owing: sp.get("owing") === "1",
      notApproved: sp.get("notApproved") === "1",
    }),
  });
}
