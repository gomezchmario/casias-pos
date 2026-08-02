import { NextResponse } from "next/server";
import { getPosUser } from "@/lib/pos-session";
import { CAPABILITIES, can, type Capability } from "@/lib/roles";

export async function GET() {
  const user = await getPosUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  const capabilities = Object.fromEntries(
    (Object.keys(CAPABILITIES) as Capability[]).map((c) => [c, can(user.role, c)]),
  );
  return NextResponse.json({ user, capabilities });
}
