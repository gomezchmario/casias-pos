import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { dirSession, dirProfile } from "@/lib/directory";

/** What the company owes, who ran it up, on which trucks and tickets. */
export async function GET() {
  const session = await dirSession();
  if (!session) return jsonError("Not signed in", 401);

  const profile = dirProfile(session.customerId);
  if (!profile) return jsonError("This page is not open");
  return NextResponse.json({ profile });
}
