import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import {
  createQuickButton,
  listAllQuickButtons,
  type QuickButtonKind,
} from "@/lib/quick-buttons";

export async function GET() {
  const auth = await requirePos("manageQuickButtons");
  if (!auth.ok) return auth.response;

  return NextResponse.json({ buttons: listAllQuickButtons() });
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("manageQuickButtons");
  if (!auth.ok) return auth.response;

  let body: {
    label?: string;
    kind?: QuickButtonKind;
    amountCents?: number | null;
    description?: string | null;
    sortOrder?: number;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (body.kind !== "amount" && body.kind !== "service")
    return jsonError("A button is either a price or a service");

  const result = createQuickButton(auth.user, {
    label: body.label ?? "",
    kind: body.kind,
    amountCents: body.amountCents ?? null,
    description: body.description ?? null,
    sortOrder: body.sortOrder,
  });
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ button: result.button });
}
