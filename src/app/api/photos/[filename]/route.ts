import { NextRequest, NextResponse } from "next/server";
import { getMimeType, readPhoto } from "@/lib/photos";
import { requireAdminApi } from "@/lib/api-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { filename } = await params;
  const buf = readPhoto(filename);
  if (!buf) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": getMimeType(filename),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
