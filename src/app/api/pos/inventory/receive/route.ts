import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { receiveStock, stockOnHand } from "@/lib/inventory";
import { createProduct, ensureUsedTire } from "@/lib/products";
import { inTx } from "@/lib/tx";

/** Thrown to unwind the transaction below; the message is shown to the user. */
class ReceiveError extends Error {}

export async function POST(req: NextRequest) {
  const auth = await requirePos("receiveInventory");
  if (!auth.ok) return auth.response;

  let body: {
    productId?: number;
    usedSize?: string;
    /** A tire the shop has never carried, being created as it is unloaded. */
    newTire?: {
      brand?: string | null;
      model?: string | null;
      ply?: string | null;
      tireSize?: string;
      priceCents?: number;
      specialized?: boolean;
    };
    qty?: number;
    unitCostCents?: number;
    supplier?: string | null;
    reference?: string | null;
    note?: string | null;
    specialized?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  try {
    // Everything below commits together or not at all. The case that forces it
    // is the new tire: a product row created by a receive that then failed is a
    // phantom on the stock sheet — a tire the shop appears to carry, with no
    // stock, no invoice and nobody who knows to delete it.
    const result = inTx(() => {
      let productId = body.productId;

      // Received by SIZE rather than by product id: whoever is unloading them
      // knows the size, not which row of a table it maps to, and a size the
      // shop has never carried before should not be a dead end.
      if (!productId && body.usedSize) {
        const used = ensureUsedTire(auth.user, body.usedSize, body.specialized);
        if (!used.ok) throw new ReceiveError(used.error);
        productId = used.product.id;
      }

      if (!productId && body.newTire) {
        const nt = body.newTire;
        if (!nt.tireSize?.trim()) throw new ReceiveError("Which size?");
        if (!nt.brand?.trim()) throw new ReceiveError("Which brand?");
        // Creating a product needs `manageProducts`, which receiveInventory does
        // not imply. Checked here rather than left to createProduct so the
        // message names the actual problem instead of a permission the user
        // thought they had.
        const created = createProduct(auth.user, {
          kind: "tire",
          condition: "new",
          brand: nt.brand.trim(),
          model: nt.model?.trim() || null,
          ply: nt.ply?.trim() || null,
          tireSize: nt.tireSize.trim(),
          priceCents: nt.priceCents ?? 0,
          defaultCostCents: body.unitCostCents ?? 0,
          specialized: nt.specialized,
          supplier: body.supplier ?? null,
          trackInventory: true,
          trackLots: true,
        });
        if (!created.ok) throw new ReceiveError(created.error);
        productId = created.product.id;
      }

      if (!productId) throw new ReceiveError("Pick a tire, or fill in a new one");

      const received = receiveStock(auth.user, {
        productId,
        qty: body.qty ?? 0,
        // A used tire has no cost to record — see ensureUsedTire.
        unitCostCents: body.usedSize ? 0 : (body.unitCostCents ?? 0),
        supplier: body.supplier ?? null,
        reference: body.reference ?? null,
        note: body.note ?? null,
      });
      if (!received.ok) throw new ReceiveError(received.error);

      return { lot: received.lot, productId };
    });

    return NextResponse.json({
      lot: result.lot,
      productId: result.productId,
      onHand: stockOnHand(result.productId),
    });
  } catch (e) {
    if (e instanceof ReceiveError) return jsonError(e.message);
    throw e;
  }
}
