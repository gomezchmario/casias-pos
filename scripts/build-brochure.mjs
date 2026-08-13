/**
 * The brochure, as a PDF.
 *
 * The source is the artifact HTML, which is a body fragment — no <html>, no
 * <head>, because the artifact host supplies those. Chrome needs a whole
 * document, so it is wrapped here rather than duplicated on disk: one source
 * file, and the wrapper is the only thing that knows about printing.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const src = path.join(root, "docs", "treadline-brochure.html");
const body = fs.readFileSync(src, "utf8");

const doc = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<style>
  /* Backgrounds are the design here — the navy cover and the amber rules are
     the brand, and a printer that helpfully drops them would hand back a
     different document. */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  @page { size: 8.5in 11in; margin: 0; }
  html, body { margin: 0; padding: 0; }

  /*
    Scaled so one brochure page is one sheet.

    Unscaled, each section runs about 1.9 sheets tall — every spread broke in
    the middle of its own mockup, which is the one place a break must never
    fall. Zoom rather than a shrunken type scale so the proportions the layout
    was designed at survive; the reader is holding a whole page either way.

    ZOOM is set by the build after measuring, not guessed. See buildAt().
  */
  body { zoom: __ZOOM__; }

  /* The screen padding is generous for scrolling and wasteful on paper. */
  .page { padding: 40px 44px 48px !important; }
  .cover-inner { padding: 48px 44px 52px !important; }

  /*
    Where a break may fall.

    A spread running onto a second sheet is fine. A break through the middle of
    an app mockup is not — it turns the one thing on the page that is doing the
    selling into two halves of nothing. So the blocks are kept whole and the
    page is allowed to be longer instead.
  */
  .app, .callout, .compare, .ordercard, .plan, .endcard, .placeholder,
  .explain > div, .steps > div { break-inside: avoid; page-break-inside: avoid; }
  h2 { break-after: avoid; page-break-after: avoid; }
</style>
</head>
<body>
${body}
</body>
</html>`;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => fs.existsSync(p));

const tmp = path.join(root, "docs", ".brochure-print.html");
const pdf = path.join(root, "docs", "Treadline-Brochure.pdf");

if (!CHROME) {
  fs.writeFileSync(tmp, doc.replace("__ZOOM__", "0.72"), "utf8");
  console.log("No Chrome found — wrote", tmp, "only");
  process.exit(0);
}

/** Render at a given zoom and report how many sheets came out. */
function buildAt(zoom) {
  fs.writeFileSync(tmp, doc.replace("__ZOOM__", String(zoom)), "utf8");
  execFileSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdf}`,
    `file:///${tmp.split(path.sep).join("/")}`,
  ]);
  const raw = fs.readFileSync(pdf).toString("latin1");
  return (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/*
  Measured, not guessed — and legibility wins every tie.

  Each spread ends with a forced break, so the sheet count can never go below
  the number of spreads; past a point, shrinking the type buys nothing but
  smaller type. So the floor is measured first, and the largest zoom that still
  reaches it is the one that ships. When shrinking genuinely does save sheets
  the walk finds that too — it just refuses to pay for a saving that isn't
  there, which is what a fixed guess did when it printed the whole brochure at
  0.55 for no benefit at all.
*/
const ZOOMS = [0.9, 0.85, 0.8, 0.75, 0.72, 0.7, 0.65, 0.6, 0.55];

const floorPages = buildAt(ZOOMS[ZOOMS.length - 1]);
console.log(`  floor: ${floorPages} sheets, however small the type goes`);

let chosen = ZOOMS[ZOOMS.length - 1];
let chosenPages = floorPages;
for (const z of ZOOMS) {
  const pages = buildAt(z);
  console.log(`  zoom ${z} → ${pages} sheets`);
  if (pages === floorPages) { chosen = z; chosenPages = pages; break; }
}

// The chosen zoom was not necessarily the last one rendered.
if (chosen !== ZOOMS[ZOOMS.length - 1]) buildAt(chosen);
fs.unlinkSync(tmp);

console.log(
  `\nwrote ${pdf} — ${chosenPages} sheets at zoom ${chosen} ` +
    `(${Math.round(fs.statSync(pdf).size / 1024)} KB)`,
);
