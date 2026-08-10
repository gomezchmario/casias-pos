import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import {
  createQuickButton,
  listAllQuickButtons,
  listServiceCategories,
  type QuickButtonKind,
} from "@/lib/quick-buttons";

export async function GET() {
  const auth = await requirePos("manageQuickButtons");
  if (!auth.ok) return auth.response;

  // The categories ride along with the buttons rather than sitting behind their
  // own request: the editor cannot draw a row without them, so fetching them
  // separately only buys a screen that renders once with the dropdowns empty.
  return NextResponse.json({
    buttons: listAllQuickButtons(),
    categories: listServiceCategories(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("manageQuickButtons");
  if (!auth.ok) return auth.response;

  let body: {
    label?: string;
    kind?: QuickButtonKind;
    amountCents?: number | null;
    description?: string | null;
    categoryId?: number | null;
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
    categoryId: body.categoryId ?? null,
    sortOrder: body.sortOrder,
  });
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ button: result.button });
}
