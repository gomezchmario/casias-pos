/**
 * Looks inside a set of workbook backups and reports what days each one holds
 * that the database does not.
 *
 * Reads only. Its whole job is to answer "is there anything in here we have
 * not already got", so that an import can be aimed at the gap rather than run
 * over the top of two years that are already in.
 *
 *   npx --yes tsx --tsconfig scripts/tsconfig.preview.json scripts/survey-workbooks.mts <file...>
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { readSharedStrings, readSheet, serialToDate } from "./lib-xlsx.mts";

const files = process.argv.slice(2).filter((a) => /\.xlsm$|\.xlsx$/i.test(a));
if (!files.length) throw new Error("give me some workbooks");

/**
 * A workbook is a zip, and ExcelJS refuses these ones — it throws on a
 * `dynamicFilter` node in the autofilter before it reaches a cell. Expanding it
 * with the shell and reading the XML is both more robust and less code.
 */
function unzip(file: string): string {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "wb-"));
  const zip = path.join(out, "book.zip");
  fs.copyFileSync(file, zip);
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}/x' -Force`],
    { stdio: "pipe" },
  );
  return path.join(out, "x");
}

/** The sheet named Data, whatever file it happens to live in. */
function dataSheet(dir: string): string | null {
  const rels = fs.readFileSync(`${dir}/xl/_rels/workbook.xml.rels`, "utf8");
  const map: Record<string, string> = {};
  for (const m of rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g))
    map[m[1]] = m[2];
  const wb = fs.readFileSync(`${dir}/xl/workbook.xml`, "utf8");
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g))
    if (m[1].trim().toLowerCase() === "data") return map[m[2]] ?? null;
  return null;
}

const db = new Database("data/timeclock.db", { readonly: true });
const have = new Map<string, number>(
  (
    db
      .prepare(
        `SELECT business_date d, COUNT(*) n FROM sales
          WHERE deleted = 0 AND kind = 'sale' AND status = 'completed'
       GROUP BY d`,
      )
      .all() as { d: string; n: number }[]
  ).map((r) => [r.d, r.n]),
);
console.log(`database holds ${have.size} days, ${[...have.keys()].sort()[0]} → ${[...have.keys()].sort().at(-1)}\n`);

const gapDays = new Map<string, { file: string; rows: number; cents: number }>();

for (const file of files) {
  const label = path.basename(path.dirname(file)) + "/" + path.basename(file);
  let dir: string;
  try {
    dir = unzip(file);
  } catch (e) {
    console.log(`${label}: could not open — ${(e as Error).message.slice(0, 60)}`);
    continue;
  }
  const sheet = dataSheet(dir);
  if (!sheet) {
    console.log(`${label}: no sheet called Data`);
    continue;
  }

  const shared = readSharedStrings(dir);
  const rows = readSheet(dir, sheet, shared)
    .slice(1)
    .filter((r) => r[0] != null && r[9] != null);

  const byDate = new Map<string, { n: number; cents: number }>();
  for (const r of rows) {
    const d = serialToDate(Number(r[9]));
    if (!d) continue;
    const e = byDate.get(d) ?? { n: 0, cents: 0 };
    e.n++;
    e.cents += Math.round((Number(r[4]) || 0) * 100);
    byDate.set(d, e);
  }
  const dates = [...byDate.keys()].sort();
  const missing = dates.filter((d) => !have.has(d));

  console.log(
    `${label}\n  ${rows.length} rows · ${dates.length} days · ${dates[0] ?? "-"} → ${dates.at(-1) ?? "-"}` +
      `\n  days the database does NOT have: ${missing.length}` +
      (missing.length ? ` (${missing[0]} → ${missing.at(-1)})` : ""),
  );

  for (const d of missing) {
    const e = byDate.get(d)!;
    // The first workbook that offers a day wins it. They are backups of one
    // sheet at different moments, so a day present in two is the same day
    // twice — taking the first keeps the import from double-counting it.
    if (!gapDays.has(d)) gapDays.set(d, { file, rows: e.n, cents: e.cents });
  }
  console.log("");
}

const all = [...gapDays.keys()].sort();
console.log("=".repeat(64));
if (!all.length) {
  console.log("Nothing new. Every day in these backups is already in the database.");
} else {
  const totalRows = [...gapDays.values()].reduce((n, g) => n + g.rows, 0);
  const totalCents = [...gapDays.values()].reduce((n, g) => n + g.cents, 0);
  console.log(
    `${all.length} days missing, ${totalRows} rows, $${(totalCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
  );
  console.log(`span ${all[0]} → ${all.at(-1)}`);
  // Runs of consecutive days, which is how a gap actually reads.
  let start = all[0];
  let prev = all[0];
  const runs: string[] = [];
  const next = (d: string) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  };
  for (const d of all.slice(1)) {
    if (d !== next(prev)) {
      runs.push(start === prev ? start : `${start}…${prev}`);
      start = d;
    }
    prev = d;
  }
  runs.push(start === prev ? start : `${start}…${prev}`);
  console.log("runs: " + runs.join(", "));
}
