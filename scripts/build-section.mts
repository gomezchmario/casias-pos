/**
 * One section of the manual, on its own, as a sheet to hand somebody.
 *
 * WHY THIS EXISTS SEPARATELY FROM `build-manual.mts`: the full guide is a
 * fifty-page document nobody reads to learn one procedure. When a new way of
 * working starts on Monday, what the counter needs is the four pages about that
 * and nothing else — small enough to sit by the register, cheap enough to
 * reprint when it changes.
 *
 * It renders through the SAME `block()` and the same stylesheet as the full
 * manual, from the same source text, so the extract cannot drift from the book
 * it came out of. Nothing is retyped here: pass a section title and it finds it.
 *
 *   npx tsx scripts/build-section.mts "Cuentas de empresa"
 *   npx tsx scripts/build-section.mts "Cuentas de empresa" --en
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MANUALS, type Lang, type T } from "../src/lib/manual.ts";

const OUT = path.resolve("docs");
const wanted = (process.argv[2] ?? "").toLowerCase();
if (!wanted) throw new Error('Give a section title, e.g. "Cuentas de empresa"');

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const rich = (s: string) =>
  esc(s)
    .replace(/\[\[(.+?)\]\]/g, '<span class="chip">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");

/** The manual's own block renderer, minus the screenshots — see the note below. */
function block(b: (typeof MANUALS)["pos"]["sections"][number]["blocks"][number], lang: Lang): string {
  const t = (x: T) => x[lang];
  switch (b.kind) {
    case "p":
      return `<p>${rich(t(b.text))}</p>`;
    case "h3":
      return `<h3>${esc(t(b.text))}</h3>`;
    case "steps":
      return `<ol class="steps">${b.items.map((i) => `<li>${rich(t(i))}</li>`).join("")}</ol>`;
    case "list":
      return `<ul class="plain">${b.items.map((i) => `<li>${rich(t(i))}</li>`).join("")}</ul>`;
    case "note":
    case "warn":
      return `<div class="${b.kind}"><div class="ct">${esc(t(b.title))}</div>${b.body
        .map((x) => `<p>${rich(t(x))}</p>`)
        .join("")}</div>`;
    case "table":
      return `<table><thead><tr>${b.head
        .map((h) => `<th>${esc(t(h))}</th>`)
        .join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${rich(t(c))}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    default:
      // Figures and specimens are photographs of the running screens, and they
      // are the one thing this extract leaves out: they need the app's compiled
      // stylesheet and its screenshot folder, which a one-section handout does
      // not carry. Sections built out of them belong in the full manual.
      return "";
  }
}

const CSS = `
@page { size: letter; margin: 17mm 16mm 15mm; }
html,body{margin:0;padding:0;background:#fff;color-scheme:light only}
body{font-family:"Segoe UI",system-ui,Roboto,Helvetica,Arial,sans-serif;color:#14181d;font-size:11.5pt;line-height:1.6}
p{margin:0 0 9px;max-width:57em}
.cover{padding:0 0 8mm;border-bottom:3px solid #0a2540;margin-bottom:7mm}
.cover .eyebrow{font-size:9.5pt;text-transform:uppercase;letter-spacing:.15em;color:#96690a;font-weight:700;margin-bottom:4mm}
.cover h1{font-family:Georgia,serif;font-size:26pt;line-height:1.15;font-weight:400;color:#0a2540;margin:0 0 3mm}
.cover .sub{font-family:Georgia,serif;font-size:12.5pt;font-style:italic;color:#4e5b68;margin:0 0 6mm}
.cover .who{font-size:10pt;color:#4e5b68}
h3{font-size:12.5pt;font-weight:650;color:#0a2540;margin:7mm 0 2mm;break-after:avoid}
ol.steps{list-style:none;counter-reset:step;padding:0;margin:3mm 0 5mm}
ol.steps>li{counter-increment:step;position:relative;padding:0 0 4mm 12mm;break-inside:avoid}
ol.steps>li::before{content:counter(step);position:absolute;left:0;top:0;width:8mm;height:8mm;border-radius:50%;background:#0a2540;color:#fff;font-size:10pt;font-weight:700;display:flex;align-items:center;justify-content:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}
ul.plain{margin:2mm 0 5mm;padding-left:6mm}
ul.plain li{margin-bottom:2mm}
.chip{display:inline-block;border:1px solid #0a2540;border-radius:3px;padding:0 1.6mm;margin:0 .3mm;font-size:10pt;font-weight:650;color:#0a2540;background:#eef2f6;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.note,.warn{padding:4mm 5mm;margin:4mm 0 5mm;break-inside:avoid;font-size:11pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.note{background:#f4f7f9;border-left:3px solid #0a2540}
.warn{background:#fdf6e6;border-left:3px solid #96690a}
.ct{font-size:9pt;text-transform:uppercase;letter-spacing:.09em;font-weight:700;margin-bottom:2mm;color:#0a2540}
.warn .ct{color:#96690a}
.note p:last-child,.warn p:last-child{margin-bottom:0}
table{width:100%;border-collapse:collapse;margin:3mm 0 6mm;font-size:10.5pt}
th{text-align:left;font-size:8.5pt;text-transform:uppercase;letter-spacing:.07em;color:#4e5b68;font-weight:700;border-bottom:1.5px solid #0a2540;padding:0 6px 2mm 0}
td{padding:2.2mm 6px 2.2mm 0;border-bottom:1px solid #d3d9e0;vertical-align:top}
td:last-child,th:last-child{padding-right:0}
td+td,th+th{padding-left:5mm}
tbody tr:nth-child(even) td{background:#fafbfc;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.foot{margin-top:9mm;padding-top:3mm;border-top:1px solid #d3d9e0;font-size:9pt;color:#4e5b68}
`;

for (const lang of ["es", "en"] as Lang[]) {
  const doc = MANUALS.pos;
  const t = (x: T) => x[lang];
  const section = doc.sections.find((s) =>
    [s.title.es, s.title.en].some((x) => x.toLowerCase().includes(wanted)),
  );
  if (!section) throw new Error(`No manual section matching "${wanted}"`);

  const foot =
    lang === "es"
      ? "Casias Muffler and Tire Shop · Extracto del Manual del Sistema · Las pantallas están en inglés; los nombres de botones se muestran tal como aparecen."
      : "Casias Muffler and Tire Shop · Extract from the Shop System manual · Button names are shown exactly as they appear on screen.";

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(t(section.title))} — Casias Muffler and Tire Shop</title>
<style>${CSS}</style></head><body>
<div class="cover">
  <div class="eyebrow">${lang === "es" ? "Manual de uso · extracto" : "Staff manual · extract"}</div>
  <h1>${esc(t(section.title))}</h1>
  <div class="sub">${esc(
    lang === "es"
      ? "Una sección del manual del sistema, aparte para tenerla en el mostrador"
      : "One section of the shop system manual, on its own for the counter",
  )}</div>
  <div class="who">Casias Muffler and Tire Shop · San Antonio, Texas<br>${
    lang === "es" ? "Para el mostrador y la oficina" : "For the counter and the office"
  } · ${lang === "es" ? "Agosto de 2026" : "August 2026"}</div>
</div>
<div class="warn"><div class="ct">${esc(t(doc.intro.title))}</div><p>${rich(
    lang === "es"
      ? "Un recuadro como [[New sale]] es el texto exacto de un botón de la pantalla; búsquelo tal cual. Después de cada cosa que se hace hay una nota que dice **qué acaba de pasar**. Las pantallas están en inglés aunque este manual esté en español."
      : "A box like [[New sale]] is the exact text on a button; look for it as written. After every action there is a note saying **what just happened**.",
  )}</p></div>
${section.blocks.map((b) => block(b, lang)).join("")}
<div class="foot">${esc(foot)}</div>
</body></html>`;

  const slug = t(section.title)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const htmlPath = path.join(OUT, `${slug}.html`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(htmlPath, html, "utf8");

  if (!CHROME) {
    console.log(`wrote ${htmlPath} (no Chrome — HTML only)`);
    continue;
  }
  const pdf = path.join(OUT, `${slug}.pdf`);
  execFileSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdf}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`,
  ]);
  console.log(`wrote ${pdf} (${Math.round(fs.statSync(pdf).size / 1024)} KB)`);
}
