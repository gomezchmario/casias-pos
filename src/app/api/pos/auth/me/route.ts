import { NextResponse } from "next/server";
import { getPosUser, posIdleSeconds } from "@/lib/pos-session";
import { CAPABILITIES, type Capability } from "@/lib/roles";
import { userCan } from "@/lib/grants";
import { tireDemandEnabled } from "@/lib/tire-demand";

export async function GET() {
  const user = await getPosUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  // `userCan`, not `can`. The second knows about roles and cannot see a
  // capability granted to one person — so a grant would work on the server and
  // the tab it unlocks would never appear, which reads as the grant not working.
  const capabilities = Object.fromEntries(
    (Object.keys(CAPABILITIES) as Capability[]).map((c) => [c, userCan(user, c)]),
  );
  // The lock threshold ships with the identity so the shell never has to guess
  // it or hardcode a second copy. It is a shop setting, and an owner who
  // shortens it should not have to reason about which of two places wins.
  //
  // The tire study rides along for two reasons that are both about where the
  // shell sits. It is the one request every role may make, so a cashier — who
  // is the whole point of that button and cannot read the study's own report —
  // still learns the switch is on. And the shell re-asks it while somebody is
  // working, so turning the study on in Settings puts the button on the screen
  // without anybody reloading the page.
  return NextResponse.json({
    user,
    capabilities,
    idleSeconds: posIdleSeconds(),
    tireDemandEnabled: tireDemandEnabled(),
  });
}
