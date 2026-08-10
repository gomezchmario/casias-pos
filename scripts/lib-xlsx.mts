/**
 * A minimal reader for the shop's workbook.
 *
 * ExcelJS refuses this file — it hits a `dynamicFilter` node in the autofilter
 * and throws before it reaches a single cell. The workbook is a zip of XML and
 * the part that is needed is small and regular, so it is read directly rather
 * than fighting a library over a feature nothing here uses.
 *
 * Deliberately not a general xlsx parser. It handles exactly what this file
 * contains: shared strings, inline strings, numbers, and dates as serial
 * numbers. Anything it cannot read comes back as null rather than as a guess.
 */
import fs from "node:fs";

export type Cell = string | number | null;
export type Row = Cell[];

/** Excel's 1900 serial → a plain YYYY-MM-DD on the UTC clock. */
export function serialToDate(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  // Day 1 is 1900-01-01, and the sheet believes 1900 was a leap year — hence
  // the 25569 offset used everywhere, which already absorbs the phantom day.
  const ms = Math.round((n - 25569) * 86_400_000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** The fractional part of a serial as HH:MM, or null when there is none. */
export function serialToTime(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const frac = n - Math.floor(n);
  if (frac <= 0) return null;
  const mins = Math.round(frac * 1440);
  return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

/** A1 → 0, B1 → 1, AA1 → 26. */
function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readSharedStrings(dir: string): string[] {
  const path = `${dir}/xl/sharedStrings.xml`;
  if (!fs.existsSync(path)) return [];
  const xml = fs.readFileSync(path, "utf8");
  const out: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // A shared string can be split across several runs; the text is the
    // concatenation of every <t> inside it.
    let text = "";
    for (const t of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    out.push(unescape(text));
  }
  return out;
}

/**
 * Every row of one sheet, as a dense array indexed by column.
 *
 * Rows are returned sparse-filled: a row that skips columns comes back with
 * nulls in the gaps, so a caller can index by column without checking.
 */
export function readSheet(dir: string, sheetFile: string, shared: string[]): Row[] {
  const xml = fs.readFileSync(`${dir}/xl/${sheetFile}`, "utf8");
  const rows: Row[] = [];

  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: Row = [];
    for (const cm of rm[1].matchAll(/<c ([^>]*?)\/>|<c ([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1] ?? cm[2] ?? "";
      const body = cm[3] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      if (!ref) continue;
      const i = colIndex(ref);
      const type = attrs.match(/t="(\w+)"/)?.[1];

      let value: Cell = null;
      if (type === "s") {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        value = v != null ? (shared[Number(v)] ?? null) : null;
      } else if (type === "inlineStr") {
        let text = "";
        for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
        value = unescape(text);
      } else if (type === "str") {
        // A formula's cached result, which is what the shop's sheets are full of.
        value = unescape(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        value = v != null && v !== "" ? Number(v) : null;
        if (typeof value === "number" && Number.isNaN(value)) value = null;
      }
      row[i] = value;
    }
    // Fill the holes so callers can index without checking.
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows.push(row);
  }
  return rows;
}
