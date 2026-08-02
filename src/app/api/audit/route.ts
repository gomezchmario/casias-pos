import { NextRequest, NextResponse } from "next/server";
import { listAudit } from "@/lib/audit";
import { requireAdminApi } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 1000) : 200;
  return NextResponse.json({ entries: listAudit(limit) });
}
