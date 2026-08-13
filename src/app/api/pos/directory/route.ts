import { NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { listDirectory } from "@/lib/directory";

/** Every company, its address, and whether it has been given a code yet. */
export async function GET() {
  const auth = await requirePos("manageDirectory");
  if (!auth.ok) return auth.response;

  const res = listDirectory(auth.user);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ rows: res.rows });
}
