/* Read-only. If the shop stopped stocking tires, the RANGE should narrow
   before the volume does, and the share of tickets carrying a tire should fall.
   Stock levels themselves were never recorded historically — these are the
   proxies the sales data can actually support. */
import { getDb } from "../src/lib/db";
import { formatCents } from "../src/lib/money";

const db = getDb();
const SALE = "s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'";
const m = (c: number) => formatCents(Math.round(c));

const rows = db
  .prepare(
    `SELECT substr(s.business_date,1,4)||'-Q'||((CAST(substr(s.business_date,6,2) AS INTEGER)+2)/3) q,
            COUNT(DISTINCT s.business_date) days,
            COUNT(DISTINCT s.id) tickets,
            COUNT(DISTINCT CASE WHEN c.code='new_tire' THEN s.id END) tireTickets,
            COUNT(DISTINCT CASE WHEN c.code='new_tire' THEN p.tire_size END) sizes,
            COUNT(DISTINCT CASE WHEN c.code='new_tire' THEN i.product_id END) skus,
            SUM(CASE WHEN c.code='new_tire' THEN i.qty ELSE 0 END) units,
            SUM(CASE WHEN c.code='new_tire' THEN i.line_total_cents ELSE 0 END) tireCents
       FROM sales s
       JOIN sale_items i ON i.sale_id = s.id AND i.voided = 0
  LEFT JOIN service_categories c ON c.id = i.category_id
  LEFT JOIN products p ON p.id = i.product_id
      WHERE ${SALE} GROUP BY q ORDER BY q`,
  )
  .all() as Record<string, number & string>[];

console.log("quarter   tire tickets   of all   sizes sold   units/day   avg tire line");
for (const r of rows as unknown as {
  q: string; days: number; tickets: number; tireTickets: number;
  sizes: number; skus: number; units: number; tireCents: number;
}[])
  console.log(
    `${r.q}   ${String(r.tireTickets).padStart(12)}   ${((r.tireTickets / r.tickets) * 100).toFixed(0).padStart(5)}%   ` +
      `${String(r.sizes).padStart(10)}   ${(r.units / r.days).toFixed(1).padStart(9)}   ${m(r.tireCents / (r.units || 1)).padStart(13)}`,
  );

console.log("\n═══ What the remaining tickets ARE ═══");
for (const r of db
  .prepare(
    `SELECT substr(s.business_date,1,4)||'-Q'||((CAST(substr(s.business_date,6,2) AS INTEGER)+2)/3) q,
            UPPER(TRIM(i.description)) d, COUNT(*) n
       FROM sale_items i JOIN sales s ON s.id=i.sale_id
      WHERE ${SALE} AND i.voided=0 AND i.product_id IS NULL
        AND s.business_date >= '2026-01-01'
   GROUP BY q, d ORDER BY q, n DESC`,
  )
  .all() as { q: string; d: string; n: number }[])
  if (["2026-Q2"].includes(r.q) && r.n > 150) console.log(`  ${r.q}  ${r.d.padEnd(24)} ${r.n}`);

console.log("\n═══ Same, at the start of the record ═══");
for (const r of db
  .prepare(
    `SELECT UPPER(TRIM(i.description)) d, COUNT(*) n
       FROM sale_items i JOIN sales s ON s.id=i.sale_id
      WHERE ${SALE} AND i.voided=0 AND i.product_id IS NULL
        AND s.business_date BETWEEN '2024-04-01' AND '2024-06-30'
   GROUP BY d ORDER BY n DESC LIMIT 8`,
  )
  .all() as { d: string; n: number }[])
  console.log(`  2024-Q2  ${r.d.padEnd(24)} ${r.n}`);
