import { NextResponse } from "next/server";
import { getPosUser, posIdleSeconds } from "@/lib/pos-session";
import { CAPABILITIES, can, type Capability } from "@/lib/roles";

export async function GET() {
  const user = await getPosUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  const capabilities = Object.fromEntries(
    (Object.keys(CAPABILITIES) as Capability[]).map((c) => [c, can(user.role, c)]),
  );
  // The lock threshold ships with the identity so the shell never has to guess
  // it or hardcode a second copy. It is a shop setting, and an owner who
  // shortens it should not have to reason about which of two places wins.
  return NextResponse.json({ user, capabilities, idleSeconds: posIdleSeconds() });
}
