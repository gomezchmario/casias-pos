/**
 * Load the shop's existing tire list out of INVENTARIO.xlsx.
 *
 * The workbook is the system of record today, so this is the one moment where
 * its numbers become the POS's numbers. It runs as a DRY RUN unless given
 * --commit, because importing 1,300 priced products twice is a much worse
 * problem than importing them zero times.
 *
 * Sheet layout, confirmed against the file and with the owner:
 *   B  cost      what we paid
 *   C  size      175-70-13, or a bare rim number on a section heading row
 *   D  tire      brand and model as one string, sometimes with the ply
 *   E  stock     count on the rack
 *   O  price     "PRICE W TAX" -- what we charge, tax included
 *
 * Column N is an older price kept alongside the current one: it is filled on
 * 362 of 555 rows and on all but two of those O is filled as well, so O is the
 * live number and N is history. The owner's rule was that the second figure is
 * "an extra if it's only there" -- so N is used only where O is blank, which is
 * those two rows and nothing else. P (year) and Q (barcode) have nowhere to go.
 *
 * Usage:
 *   npx tsx scripts/import-tire-list.mts            # dry run, changes nothing
 *   npx tsx scripts/import-tire-list.mts --commit
 */
import ExcelJS from "exceljs";
import path from "node:path";
import { runMigrations } from "../src/lib/migrations.ts";
import { getDb } from "../src/lib/db.ts";
import { createProduct } from "../src/lib/products.ts";
import { normalizeTireSize, rimDiameterOf, looksSpecialized } from "../src/lib/tire-size.ts";
import { receiveStock } from "../src/lib/inventory.ts";
import type { PosUser } from "../src/lib/pos-session.ts";

const COMMIT = process.argv.includes("--commit");
const FILE =
  process.argv.find((a) => a.endsWith(".xlsx")) ??
  "C:\\Users\\Casia\\OneDrive\\Pictures\\INVENTARIO(AutoRecovered).xlsx";

// ---------------------------------------------------------------------------

type Row = {
  excelRow: number;
  size: string;
  rawSize: string;
  tire: string;
  brand: string;
  model: string | null;
  ply: string | null;
  qty: number;
  costCents: number;
  priceCents: number;
  specialized: boolean;
};

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.result !== undefined) return String(o.result).trim();
    if (o.richText) return o.richText.map((t) => t.text).join("").trim();
    if (o.text) return String(o.text).trim();
    return "";
  }
  return String(v).trim();
};

/** Dollars in the sheet, integer cents in the database. Never a float. */
const cents = (v: unknown): number => {
  const s = text(v).replace(/[$,\s]/g, "");
  if (!s) return 0;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
};

const count = (v: unknown): number => {
  const n = Number.parseInt(text(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * "TRANSEAGLE ST II RADIAL (8PLY)" -> ply "8PLY", name without it.
 * Only an explicit PLY/PR is taken. The sheet also has bare "(4)" and "(14)"
 * which are probably ply too, but probably is not good enough to write into a
 * field somebody will later quote to a customer.
 */
function splitPly(tire: string): { name: string; ply: string | null } {
  const m = tire.match(/\(\s*(\d{1,2})\s*(?:PLY|PR)\s*\)/i);
  if (!m) return { name: tire.trim(), ply: null };
  return { name: tire.replace(m[0], "").replace(/\s{2,}/g, " ").trim(), ply: `${m[1]}PLY` };
}

// ---------------------------------------------------------------------------

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(FILE);
const ws = wb.getWorksheet("NEW TIRES");
if (!ws) throw new Error("No 'NEW TIRES' sheet in that workbook");

const rows: Row[] = [];
const skipped: string[] = [];
// Everything below the "18 WHEELER TIRES" marker row is commercial stock.
let pastMarker = false;

ws.eachRow({ includeEmpty: false }, (row, n) => {
  const rawSize = text(row.getCell(3).value);
  const tire = text(row.getCell(4).value);

  if (/18\s*WHEELER/i.test(rawSize) || /18\s*WHEELER/i.test(tire)) {
    pastMarker = true;
    return;
  }
  // Section heading rows carry a bare rim number and nothing else.
  if (!rawSize || !tire) return;
  if (/^(SIZE|STOCK|PRICE|TOTAL)$/i.test(rawSize)) return;

  const size = normalizeTireSize(rawSize);
  const rim = rimDiameterOf(size);
  if (!size) {
    skipped.push(`row ${n}: no size (${tire})`);
    return;
  }

  const { name, ply } = splitPly(tire);
  const firstSpace = name.indexOf(" ");
  rows.push({
    excelRow: n,
    size,
    rawSize,
    tire,
    // The whole string is the brand and the rest the model. Splitting on the
    // first word gets "BF GOODRICH" wrong, so the full text stays searchable
    // in `brand` and `model` only carries what is clearly a separate word.
    brand: firstSpace === -1 ? name : name.slice(0, firstSpace),
    model: firstSpace === -1 ? null : name.slice(firstSpace + 1),
    ply,
    qty: count(row.getCell(5).value),
    costCents: cents(row.getCell(2).value),
    priceCents: cents(row.getCell(15).value) || cents(row.getCell(14).value),
    specialized: pastMarker || looksSpecialized(size) || rim === null,
  });
});

// ---------------------------------------------------------------------------
// SKUs. autoSku() builds from the size alone, which collides the moment a size
// has two brands -- and most do. So each row gets an explicit one.
// ---------------------------------------------------------------------------

const used = new Set<string>();
const skuFor = (r: Row): string => {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  const base = `${slug(r.size)}-${slug(r.brand).slice(0, 6)}${slug(r.model ?? "").slice(0, 6)}`;
  let sku = base;
  for (let i = 2; used.has(sku); i++) sku = `${base}-${i}`;
  used.add(sku);
  return sku;
};

// ---------------------------------------------------------------------------

const bySection = new Map<string, number>();
for (const r of rows) {
  const k = r.specialized ? "specialty" : String(rimDiameterOf(r.size));
  bySection.set(k, (bySection.get(k) ?? 0) + 1);
}

console.log(`file    : ${path.basename(FILE)}`);
console.log(`mode    : ${COMMIT ? "COMMIT" : "DRY RUN (nothing will be written)"}`);
console.log(`rows    : ${rows.length} tires`);
console.log(`sizes   : ${new Set(rows.map((r) => r.size)).size}`);
console.log(`in stock: ${rows.filter((r) => r.qty > 0).length} rows, ${rows.reduce((s, r) => s + Math.max(0, r.qty), 0)} tires`);
console.log(`no price: ${rows.filter((r) => r.priceCents === 0).length} rows`);
console.log(`no cost : ${rows.filter((r) => r.costCents === 0).length} rows`);
console.log(`specialty: ${rows.filter((r) => r.specialized).length} rows`);
console.log(
  `sections: ${[...bySection].sort((a, b) => (a[0] === "specialty" ? 1 : b[0] === "specialty" ? -1 : Number(a[0]) - Number(b[0]))).map(([k, v]) => `${k}(${v})`).join(" ")}`,
);

// Anything priced below cost is either a typo or a loss, and both are worth
// seeing before 1,300 rows go in.
const underwater = rows.filter((r) => r.priceCents > 0 && r.costCents > r.priceCents);
if (underwater.length) {
  console.log(`\n!! ${underwater.length} rows priced at or below cost:`);
  for (const r of underwater.slice(0, 15))
    console.log(`   row ${r.excelRow}: ${r.size} ${r.tire} cost ${r.costCents / 100} > price ${r.priceCents / 100}`);
}

if (skipped.length) {
  console.log(`\nskipped ${skipped.length}:`);
  for (const s of skipped.slice(0, 20)) console.log("   " + s);
}

console.log("\nfirst 12 rows as they will be stored:");
for (const r of rows.slice(0, 12))
  console.log(
    `   ${r.size.padEnd(13)} ${(r.brand + " " + (r.model ?? "")).trim().slice(0, 34).padEnd(35)} ` +
      `ply=${(r.ply ?? "-").padEnd(6)} qty=${String(r.qty).padStart(3)} ` +
      `cost=${(r.costCents / 100).toFixed(2).padStart(8)} price=${(r.priceCents / 100).toFixed(2).padStart(8)}` +
      `${r.specialized ? "  SPECIALTY" : ""}`,
  );

if (!COMMIT) {
  console.log("\nDry run. Re-run with --commit to write these.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write. Attributed to the owner: this is his list, and an audit row that says
// "system" would be a lie about who put these numbers in.
// ---------------------------------------------------------------------------

runMigrations();
const db = getDb();

const owner = db
  .prepare("SELECT id, name, pos_role FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id")
  .get() as { id: number; name: string; pos_role: string } | undefined;
if (!owner) throw new Error("No active owner to attribute the import to");
const user: PosUser = { employeeId: owner.id, name: owner.name, role: "owner" };
console.log(`\nattributing to: ${owner.name} (owner)`);

let created = 0;
let receivedRows = 0;
let receivedTires = 0;
const failures: string[] = [];

for (const r of rows) {
  const result = createProduct(user, {
    kind: "tire",
    condition: "new",
    sku: skuFor(r),
    tireSize: r.size,
    brand: r.brand,
    model: r.model,
    ply: r.ply,
    priceCents: r.priceCents,
    defaultCostCents: r.costCents,
    specialized: r.specialized,
    reorderPoint: 0,
  });
  if (!result.ok) {
    failures.push(`row ${r.excelRow} ${r.size} ${r.tire}: ${result.error}`);
    continue;
  }
  created++;

  if (r.qty > 0) {
    const rec = receiveStock(user, {
      productId: result.product.id,
      qty: r.qty,
      unitCostCents: r.costCents,
      note: "Opening count imported from INVENTARIO.xlsx",
    });
    if (!rec.ok) failures.push(`row ${r.excelRow} ${r.size} receive: ${rec.error}`);
    else {
      receivedRows++;
      receivedTires += r.qty;
    }
  }
}

console.log(`\ncreated  : ${created} products`);
console.log(`received : ${receivedTires} tires across ${receivedRows} lots`);
console.log(`failed   : ${failures.length}`);
for (const f of failures.slice(0, 30)) console.log("   " + f);
