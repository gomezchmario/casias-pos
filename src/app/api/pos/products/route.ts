import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import {
  createProduct,
  listProducts,
  searchProducts,
  withStock,
  type ProductKind,
} from "@/lib/products";
import { can } from "@/lib/roles";

const KINDS = ["tire", "part", "service", "fee"] as const;
const isKind = (v: unknown): v is ProductKind =>
  typeof v === "string" && (KINDS as readonly string[]).includes(v);

export async function GET(req: NextRequest) {
  const auth = await requirePos("searchProducts");
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams.get("q");
  const showCosts = can(auth.user.role, "viewCosts");

  const results = q
    ? searchProducts(q, { user: auth.user })
    : withStock(listProducts({ includeInactive: false }));

  return NextResponse.json({
    products: results.map((p) => ({
      ...p,
      default_cost_cents: showCosts ? p.default_cost_cents : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("manageProducts");
  if (!auth.ok) return auth.response;

  let body: {
    kind?: ProductKind;
    name?: string;
    sku?: string;
    tireSize?: string | null;
    brand?: string | null;
    model?: string | null;
    ply?: string | null;
    condition?: "new" | "used" | null;
    priceCents?: number;
    defaultCostCents?: number;
    reorderPoint?: number;
    trackInventory?: boolean;
    specialized?: boolean;
    supplier?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!isKind(body.kind)) return jsonError("Pick a kind: tire, part, service or fee");

  const result = createProduct(auth.user, {
    kind: body.kind,
    name: body.name,
    sku: body.sku,
    tireSize: body.tireSize,
    brand: body.brand,
    model: body.model,
    ply: body.ply,
    condition: body.condition,
    priceCents: body.priceCents,
    defaultCostCents: body.defaultCostCents,
    reorderPoint: body.reorderPoint,
    trackInventory: body.trackInventory,
    specialized: body.specialized,
    supplier: body.supplier,
  });
  if (!result.ok) return jsonError(result.error);
  // With its count on it. A used size is get-or-create — ask for one that has
  // existed since March and you get back the row that was already there, tires
  // and all — and the caller puts this straight onto a ticket, where a hardcoded
  // "0 on hand" is a number somebody at the counter reads and believes.
  return NextResponse.json({ product: withStock([result.product])[0] });
}
