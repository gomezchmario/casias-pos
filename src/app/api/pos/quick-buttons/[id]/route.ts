import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { updateQuickButton } from "@/lib/quick-buttons";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageQuickButtons");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);

  let body: {
    label?: string;
    amountCents?: number | null;
    description?: string | null;
    sortOrder?: number;
    active?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const result = updateQuickButton(auth.user, id, body);
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ button: result.button });
}
