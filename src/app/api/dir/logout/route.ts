import { NextResponse } from "next/server";
import { dirLogout } from "@/lib/directory";

export async function POST() {
  await dirLogout();
  return NextResponse.json({ ok: true });
}
