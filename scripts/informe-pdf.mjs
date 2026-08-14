/**
 * The tire report, as a PDF.
 *
 * Same arrangement as the brochure build: the HTML on disk is a body fragment
 * (the artifact host supplies the document shell on the web), so the wrapper
 * lives here, and printing is the only thing that knows about it.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const body = fs.readFileSync(path.join(root, "docs", "informe-llantas.html"), "utf8");

const doc = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  /* The amber note, the red loss box and the table zebra are the document's
     signposts — a printer that drops backgrounds hands back a wall of prose. */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  @page { size: letter; margin: 14mm 15mm; }
  html, body { margin: 0; padding: 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;

const tmp = path.join(os.tmpdir(), "informe-llantas-print.html");
fs.writeFileSync(tmp, doc);

const chrome = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => fs.existsSync(p));
if (!chrome) throw new Error("Chrome not found");

const pdf = path.join(root, "docs", "Informe-Llantas-Casias.pdf");
execFileSync(chrome, [
  "--headless",
  "--disable-gpu",
  "--no-pdf-header-footer",
  `--print-to-pdf=${pdf}`,
  `file:///${tmp.replace(/\\/g, "/")}`,
], { stdio: "pipe" });

console.log(`${pdf} · ${(fs.statSync(pdf).size / 1024).toFixed(0)} KB`);
