/**
 * Load the shop's live inventory out of COPIA DE INVENTARIO.xlsx.
 *
 * This is the opening count: the moment the workbook stops being the system of
 * record and the POS starts. It runs as a DRY RUN unless given --commit,
 * because importing 550 priced products twice is a much worse problem than
 * importing them zero times.
 *
 * Supersedes import-tire-list.mts, which read an older copy of the workbook and
 * knew nothing about batteries.
 *
 * SHEET LAYOUT — "NEW TIRES", confirmed against the file with the owner
 *
 *   Tires, rows 7 to the RIMS marker:
 *     B  cost       what the shop paid
 *     C  size       175-70-13, or a bare rim number on a section heading row
 *     D  tire       brand and model as one string, sometimes with the ply
 *     E  stock      count on the rack
 *     N  old price  history, used ONLY where O is blank
 *     O  price      "PRICE W TAX" — what the customer pays, tax included
 *
 *   Batteries, under the BATTERIES marker (~row 887):
 *     B  QUANTITY   <- NOT cost. The one column that changes meaning.
 *     C  name       LARGE / MEDIUM / SMALL
 *     O  price
 *
 *   That B switch is the trap in this file. It reads exactly like the cost
 *   column above it — 55/45/35 against prices of 120/90/70 is a plausible
 *   markup — and importing it as cost would silently put 0 batteries on the
 *   shelf while recording a cost the shop never paid. Confirmed with the owner:
 *   there are 55 Large at $120. Batteries therefore import with no cost at all,
 *   which is honest; a guessed cost is worse than a missing one.
 *
 * Everything past the "18 WHEELER TIRES" marker is commercial stock and goes to
 * the specialty section. Everything from the RIMS marker down, and every column
 * from P across, is ignored — the shop does not stock rims through the POS and
 * year/barcode have nowhere to go.
 *
 * Usage:
 *   npx tsx scripts/import-inventory.mts            # dry run
 *   npx tsx scripts/import-inventory.mts --commit
 */
import ExcelJS from "exceljs";
import path from "node:path";
import { getDb } from "../src/lib/db.ts";
import { createProduct } from "../src/lib/products.ts";
import { normalizeTireSize, rimDiameterOf, looksSpecialized } from "../src/lib/tire-size.ts";
import { receiveStock } from "../src/lib/inventory.ts";
import type { PosUser } from "../src/lib/pos-session.ts";

const COMMIT = process.argv.includes("--commit");
const FILE =
  process.argv.find((a) => a.endsWith(".xlsx")) ??
  "C:\\Users\\Casia\\OneDrive\\Documents\\COPIA DE INVENTARIO.xlsx";

/** Nothing below this row is inventory. Rims, workings, scratch. */
const LAST_ROW = 899;

// ---------------------------------------------------------------------------

type Tire = {
  excelRow: number;
  size: string;
  tire: string;
  brand: string;
  model: string | null;
  ply: string | null;
  qty: number;
  costCents: number;
  priceCents: number;
  /** True when the price came from column N because O was blank. */
  priceFromHistory: boolean;
  specialized: boolean;
};

type Battery = { excelRow: number; label: string; qty: number; priceCents: number };

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
// Read
// ---------------------------------------------------------------------------

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(FILE);
const ws = wb.getWorksheet("NEW TIRES");
if (!ws) throw new Error("No 'NEW TIRES' sheet in that workbook");

const tires: Tire[] = [];
const batteries: Battery[] = [];
const skipped: string[] = [];

let pastWheeler = false; // below the 18 WHEELER marker: commercial stock
let inBatteries = false; // below the BATTERIES marker: column B means quantity

for (let n = 1; n <= LAST_ROW; n++) {
  const row = ws.getRow(n);
  const cell = (i: number) => text(row.getCell(i).value);
  const size = cell(3);
  const name = cell(4);

  if (/^RIMS$/i.test(name)) break; // nothing below this is stock we carry
  if (/^BATTERIES$/i.test(name)) {
    inBatteries = true;
    continue;
  }
  if (/18\s*WHEELER/i.test(size) || /18\s*WHEELER/i.test(name)) {
    pastWheeler = true;
    continue;
  }

  if (inBatteries) {
    // C is the whole record here: LARGE / MEDIUM / SMALL. Rows with anything
    // else in C (a date, a note) are the sheet's own scribbles.
    if (!/^(LARGE|MEDIUM|SMALL)$/i.test(size)) continue;
    batteries.push({
      excelRow: n,
      label: size.toUpperCase(),
      qty: count(row.getCell(2).value), // B = QUANTITY down here
      priceCents: cents(row.getCell(15).value),
    });
    continue;
  }

  if (!size || !name) continue; // section heading or spacer
  if (/^(SIZE|STOCK|PRICE|TOTAL)$/i.test(size)) continue;

  const normalized = normalizeTireSize(size);
  if (!normalized) {
    skipped.push(`row ${n}: unreadable size "${size}" (${name})`);
    continue;
  }

  const { name: clean, ply } = splitPly(name);
  const firstSpace = clean.indexOf(" ");
  const priceO = cents(row.getCell(15).value);
  const priceN = cents(row.getCell(14).value);

  tires.push({
    excelRow: n,
    size: normalized,
    tire: name,
    // The whole string is the brand and the rest the model. Splitting on the
    // first word gets "BF GOODRICH" wrong, so the full text stays searchable in
    // `brand` and `model` only carries what is clearly a separate word.
    brand: firstSpace === -1 ? clean : clean.slice(0, firstSpace),
    model: firstSpace === -1 ? null : clean.slice(firstSpace + 1),
    ply,
    qty: count(row.getCell(5).value),
    costCents: cents(row.getCell(2).value),
    priceCents: priceO || priceN,
    priceFromHistory: !priceO && priceN > 0,
    specialized: pastWheeler || looksSpecialized(normalized) || rimDiameterOf(normalized) === null,
  });
}

// ---------------------------------------------------------------------------
// SKUs. autoSku() builds from the size alone, which collides the moment a size
// has two brands -- and most do. So each row gets an explicit one.
// ---------------------------------------------------------------------------

const used = new Set<string>();
const skuFor = (t: Tire): string => {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  const base = `${slug(t.size)}-${slug(t.brand).slice(0, 6)}${slug(t.model ?? "").slice(0, 6)}`;
  let sku = base;
  for (let i = 2; used.has(sku); i++) sku = `${base}-${i}`;
  used.add(sku);
  return sku;
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const inStock = tires.filter((t) => t.qty > 0);
const tireCount = tires.reduce((s, t) => s + Math.max(0, t.qty), 0);

console.log(`file      : ${path.basename(FILE)}`);
console.log(`mode      : ${COMMIT ? "COMMIT" : "DRY RUN (nothing will be written)"}`);
console.log(`tires     : ${tires.length} rows, ${new Set(tires.map((t) => t.size)).size} sizes`);
console.log(`in stock  : ${inStock.length} rows, ${tireCount} tires`);
console.log(`specialty : ${tires.filter((t) => t.specialized).length} rows`);
console.log(
  `batteries : ${batteries.length} sizes, ${batteries.reduce((s, b) => s + b.qty, 0)} on hand`,
);
for (const b of batteries)
  console.log(`            ${b.label.padEnd(7)} qty=${String(b.qty).padStart(3)}  ${(b.priceCents / 100).toFixed(2)}`);

// The two conditions the shop asked to be warned about. Both are reported here
// AND flagged in the app afterwards, for managers only -- a dry run scrolls past
// and is forgotten, and these need to stay visible until somebody fixes them.
const noPriceInStock = inStock.filter((t) => t.priceCents === 0);
const belowCost = tires.filter((t) => t.priceCents > 0 && t.costCents > t.priceCents);
const fallback = tires.filter((t) => t.priceFromHistory);

if (fallback.length) {
  console.log(`\nprice taken from column N (O was blank): ${fallback.length}`);
  for (const t of fallback)
    console.log(`   row ${t.excelRow}: ${t.size} ${t.tire.slice(0, 30)} -> ${(t.priceCents / 100).toFixed(2)} (qty ${t.qty})`);
}

if (noPriceInStock.length) {
  console.log(`\n!! IN STOCK WITH NO PRICE: ${noPriceInStock.length}`);
  for (const t of noPriceInStock)
    console.log(`   row ${t.excelRow}: ${t.size} ${t.tire.slice(0, 34)} qty=${t.qty}`);
}

if (belowCost.length) {
  console.log(`\n!! PRICED BELOW COST: ${belowCost.length}`);
  for (const t of belowCost)
    console.log(
      `   row ${t.excelRow}: ${t.size.padEnd(12)} ${t.tire.slice(0, 30).padEnd(31)} ` +
        `cost ${(t.costCents / 100).toFixed(2)} > price ${(t.priceCents / 100).toFixed(2)}  qty=${t.qty}`,
    );
}

if (skipped.length) {
  console.log(`\nskipped ${skipped.length}:`);
  for (const s of skipped) console.log("   " + s);
}

console.log("\nfirst 10 tires as they will be stored:");
for (const t of tires.slice(0, 10))
  console.log(
    `   ${t.size.padEnd(13)} ${(t.brand + " " + (t.model ?? "")).trim().slice(0, 32).padEnd(33)} ` +
      `ply=${(t.ply ?? "-").padEnd(6)} qty=${String(t.qty).padStart(3)} ` +
      `cost=${(t.costCents / 100).toFixed(2).padStart(7)} price=${(t.priceCents / 100).toFixed(2).padStart(7)}` +
      `${t.specialized ? "  SPECIALTY" : ""}`,
  );

if (!COMMIT) {
  console.log("\nDry run. Re-run with --commit to write these.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write. Attributed to the owner: this is his list, and an audit row saying
// "system" would be a lie about who put these numbers in.
// ---------------------------------------------------------------------------

const db = getDb();

const existing = db.prepare("SELECT COUNT(*) n FROM products WHERE deleted = 0").get() as { n: number };
if (existing.n > 0) {
  console.error(`\nRefusing to run: ${existing.n} products already exist.`);
  console.error("This is an OPENING COUNT and assumes an empty catalogue. Clear it first,");
  console.error("or the shop ends up with two of every tire and doubled stock.");
  process.exit(1);
}

const owner = db
  .prepare("SELECT id, name FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id")
  .get() as { id: number; name: string } | undefined;
if (!owner) throw new Error("No active owner to attribute the import to");
const user: PosUser = { employeeId: owner.id, name: owner.name, role: "owner" };
console.log(`\nattributing to: ${owner.name} (owner)`);

const batteryCategory = db
  .prepare("SELECT id FROM service_categories WHERE code = 'battery'")
  .get() as { id: number } | undefined;
if (!batteryCategory) throw new Error("No 'battery' service category — is migration 010 applied?");

let created = 0;
let receivedRows = 0;
let receivedUnits = 0;
const failures: string[] = [];

const receive = (productId: number, qty: number, costCents: number, what: string, row: number) => {
  if (qty <= 0) return;
  const rec = receiveStock(user, {
    productId,
    qty,
    unitCostCents: costCents,
    note: "Opening count imported from INVENTARIO.xlsx",
  });
  if (!rec.ok) failures.push(`row ${row} ${what} receive: ${rec.error}`);
  else {
    receivedRows++;
    receivedUnits += qty;
  }
};

for (const t of tires) {
  const result = createProduct(user, {
    kind: "tire",
    condition: "new",
    sku: skuFor(t),
    tireSize: t.size,
    brand: t.brand,
    model: t.model,
    ply: t.ply,
    priceCents: t.priceCents,
    defaultCostCents: t.costCents,
    specialized: t.specialized,
    reorderPoint: 0,
  });
  if (!result.ok) {
    failures.push(`row ${t.excelRow} ${t.size} ${t.tire}: ${result.error}`);
    continue;
  }
  created++;
  receive(result.product.id, t.qty, t.costCents, t.size, t.excelRow);
}

for (const b of batteries) {
  // "BATTERY LARGE" rather than "LARGE": the inventory sheet strips the prefix
  // under its own heading, but a receipt and a product search have no heading
  // to lean on, and a line reading just "LARGE" explains nothing.
  const result = createProduct(user, {
    kind: "part",
    name: `BATTERY ${b.label}`,
    sku: `BATT-${b.label}`,
    categoryId: batteryCategory.id,
    priceCents: b.priceCents,
    defaultCostCents: 0, // the sheet has no battery cost. Guessing one is worse.
    trackInventory: true,
    trackLots: false,
    reorderPoint: 0,
  });
  if (!result.ok) {
    failures.push(`row ${b.excelRow} battery ${b.label}: ${result.error}`);
    continue;
  }
  created++;
  receive(result.product.id, b.qty, 0, `battery ${b.label}`, b.excelRow);
}

console.log(`\ncreated  : ${created} products`);
console.log(`received : ${receivedUnits} units across ${receivedRows} lots`);
console.log(`failed   : ${failures.length}`);
for (const f of failures.slice(0, 30)) console.log("   " + f);
