import { notFound, redirect } from "next/navigation";
import { getPosUser } from "@/lib/pos-session";
import { getSale, listSaleItems } from "@/lib/sales";
import { listPayments, listPaymentMethods } from "@/lib/payments";
import { getSetting } from "@/lib/settings";
import { formatCents, taxIncludedInCents } from "@/lib/money";
import { getDb } from "@/lib/db";
import { PrintButton } from "@/components/pos/PrintButton";
import "./receipt.css";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getPosUser();
  if (!user) redirect("/");

  const sale = getSale(parseInt((await params).id, 10));
  if (!sale) notFound();

  const items = listSaleItems(sale.id);
  const payments = listPayments(sale.id).filter((p) => p.amount_cents !== 0);
  const methods = new Map(listPaymentMethods().map((m) => [m.id, m.label]));

  // Buying over the counter collects no sales tax, so a purchase receipt shows
  // no tax line rather than one back-calculated from the retail rate.
  const isPurchase = sale.kind === "purchase";
  const taxRate = sale.tax_rate_bp ?? Number(getSetting("tax_rate_bp"));
  const taxCents = taxIncludedInCents(sale.subtotal_cents, taxRate);
  const companyName = getSetting("company_name");
  const footer = getSetting("receipt_footer");

  const customer = sale.customer_id
    ? (getDb()
        .prepare("SELECT name, phone FROM customers WHERE id = ?")
        .get(sale.customer_id) as { name: string; phone: string | null } | undefined)
    : undefined;
  const vehicle = sale.vehicle_id
    ? (getDb()
        .prepare("SELECT year, make, model, plate FROM vehicles WHERE id = ?")
        .get(sale.vehicle_id) as
        | { year: string | null; make: string | null; model: string | null; plate: string | null }
        | undefined)
    : undefined;

  return (
    <div className="receipt-page">
      <PrintButton />

      <div className="receipt">
        <header className="receipt-head">
          <div className="receipt-shop">{companyName}</div>
          <div className="receipt-meta">{sale.sale_no}</div>
          <div className="receipt-meta">
            {sale.completed_at ?? sale.opened_at} · {sale.business_date}
          </div>
          {isPurchase && <div className="receipt-meta">PURCHASE — PAID OUT IN CASH</div>}
          {sale.status === "voided" && <div className="receipt-void">VOIDED</div>}
        </header>

        {(customer || vehicle) && (
          <section className="receipt-block">
            {customer && (
              <div>
                <strong>{customer.name}</strong>
                {customer.phone ? ` · ${customer.phone}` : ""}
              </div>
            )}
            {vehicle && (
              <div>
                {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                {vehicle.plate ? ` · ${vehicle.plate}` : ""}
              </div>
            )}
          </section>
        )}

        <table className="receipt-items">
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td className="qty">{i.qty > 1 ? `${i.qty}×` : ""}</td>
                <td className="desc">{i.description}</td>
                <td className="amt">{formatCents(i.line_total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="receipt-totals">
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="amt">{formatCents(sale.subtotal_cents)}</td>
            </tr>
            {sale.tip_cents > 0 && (
              <tr>
                <td>Cashback</td>
                <td className="amt">{formatCents(sale.tip_cents)}</td>
              </tr>
            )}
            {sale.comm_cents > 0 && (
              <tr>
                <td>Cashback fee</td>
                <td className="amt">{formatCents(sale.comm_cents)}</td>
              </tr>
            )}
            <tr className="grand">
              <td>{isPurchase ? "Paid out" : "Total"}</td>
              <td className="amt">{formatCents(sale.total_cents)}</td>
            </tr>
            {!isPurchase && (
              <tr className="tax">
                <td>Tax included ({(taxRate / 100).toFixed(2)}%)</td>
                <td className="amt">{formatCents(taxCents)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {payments.length > 0 && (
          <table className="receipt-totals">
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    {methods.get(p.method_id) ?? "Payment"}
                    {p.kind !== "payment" ? ` (${p.kind.replace("_", " ")})` : ""}
                    {p.seq ? ` · SEQ ${p.seq}` : ""}
                  </td>
                  <td className="amt">{formatCents(p.amount_cents)}</td>
                </tr>
              ))}
              {sale.balance_cents !== 0 && (
                <tr className="grand">
                  <td>Balance due</td>
                  <td className="amt">{formatCents(sale.balance_cents)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <footer className="receipt-foot">
          {sale.po && <div>PO {sale.po}</div>}
          <div>{footer}</div>
        </footer>
      </div>
    </div>
  );
}
