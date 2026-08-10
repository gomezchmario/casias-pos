/**
 * Builds the printable manual, in both languages, from the same content the
 * Help page renders.
 *
 * The point is that there is nowhere for the two to disagree. A printed manual
 * and an on-screen one that were written separately stay identical for about a
 * week; after the first correction, whoever is holding paper is holding
 * something wrong and has no way to tell. So the words live in
 * `src/lib/manual.ts`, the app reads them, and this writes them out.
 *
 * Run it with:
 *   npx --yes tsx scripts/build-manual.mts
 *
 * It emits HTML next to itself and then, if Chrome is where Windows normally
 * puts it, prints each one to PDF. Chrome is used rather than a PDF library
 * because the register prints from Chrome — rendering the paper copy through
 * anything else would mean checking the layout in an engine nobody here uses.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Specimen } from "../src/app/help/specimens.tsx";
import {
  MANUALS,
  type Block,
  type Guide,
  type Lang,
  type T,
} from "../src/lib/manual.ts";

const OUT = path.resolve("docs");

/**
 * The app's own compiled stylesheet, inlined into the printable HTML.
 *
 * Specimens are built out of Tailwind classes — `bg-white`, `rounded-2xl`,
 * `text-brand-300` — and none of those mean anything outside the app. Rather
 * than hand-copy a hundred declarations into this file and watch them rot, the
 * built CSS is pulled in whole and this document's own rules are written after
 * it, so they win where the two overlap.
 *
 * It has to come from a build. If `.next` has been wiped, run `npm run build`
 * before this script or the specimens print unstyled.
 */
function appStylesheet(): string {
  const dir = path.resolve(".next/static/css");
  if (!fs.existsSync(dir)) return "";
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => path.join(dir, f));
  // The app's bundle is the big one; the others are per-route slices.
  const main = files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  return main ? fs.readFileSync(main, "utf8") : "";
}

/** The specimen chrome, mirrored from `src/app/help/help.css` — see the note
 *  there. Print-only adjustments live at the bottom of this file's <style>. */
const SPECIMEN_CSS = `
.manual-specimen{background:#f2f4f7;border:1px solid rgba(0,0,0,.08);border-radius:3mm;padding:4mm;margin:4mm 0 2mm;display:flex;justify-content:center;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.manual-specimen-inner{width:100%}
.manual-specimen .keypad{display:grid;gap:.5rem;grid-template-columns:repeat(3,minmax(0,1fr))}
.manual-specimen .keypad>.btn{padding-left:.4rem;padding-right:.4rem;line-height:1.15}
.manual-specimen *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.manual-modal{background:#fff;border:1px solid #999;border-radius:3mm;padding:5mm 6mm}
.manual-specimen-caption{font-size:9pt;color:#4f6e8e;text-align:center;margin:0 0 4mm}
.manual-specimen-missing{border:1px dashed #b45309;color:#92400e;background:#fffbeb;padding:3mm;border-radius:2mm;font-size:9pt}
`;

/** Figures live in `public/manual/`, and the PDF is rendered from a file:// URL,
 *  so they have to be pointed at by absolute path rather than by web path. */
const FIGURES = "file:///" + path.resolve("public/manual").replace(/\\/g, "/");
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The same two marks the Help page understands — see `rich` there. */
function rich(s: string): string {
  return esc(s)
    .replace(/\[\[(.+?)\]\]/g, '<span class="chip">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

const yesNo = (c: string) =>
  c === "Sí" || c === "Yes" ? ' class="yes"' : c === "No" ? ' class="no"' : "";

function block(b: Block, lang: Lang): string {
  const t = (x: T) => x[lang];
  switch (b.kind) {
    case "p":
      return `<p>${rich(t(b.text))}</p>`;
    case "h3":
      return `<h3>${rich(t(b.text))}</h3>`;
    case "steps":
      return `<ol class="steps">${b.items.map((i) => `<li>${rich(t(i))}</li>`).join("")}</ol>`;
    case "list":
      return `<ul class="plain">${b.items.map((i) => `<li>${rich(t(i))}</li>`).join("")}</ul>`;
    case "note":
    case "warn":
      return `<div class="${b.kind}"><div class="ct">${esc(t(b.title))}</div>${b.body
        .map((p) => `<p>${rich(t(p))}</p>`)
        .join("")}</div>`;
    /* The SAME React components the Help page shows, rendered to flat HTML.
       Not a second set of markup written for print: a specimen that exists
       twice is a specimen that will eventually disagree with itself, and the
       paper copy is the one nobody can refresh. */
    case "ui":
      return renderToStaticMarkup(createElement(Specimen, { name: b.specimen }));
    case "figure":
      return (
        `<figure class="figure"><div class="figure-shot">` +
        `<img src="${FIGURES}/${b.src}" alt="${esc(t(b.alt))}">` +
        b.callouts
          .map(
            (c, j) =>
              `<span class="pin" style="left:${c.x}%;top:${c.y}%">${j + 1}</span>`,
          )
          .join("") +
        `</div><ol class="legend">` +
        b.callouts.map((c) => `<li>${rich(t(c.text))}</li>`).join("") +
        `</ol></figure>`
      );
    case "table":
      return `<table><thead><tr>${b.head
        .map((h) => `<th>${esc(t(h))}</th>`)
        .join("")}</tr></thead><tbody>${b.rows
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td${yesNo(t(c))}>${rich(t(c))}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table>`;
  }
}

function document(guide: Guide, lang: Lang): string {
  const doc = MANUALS[guide];
  const t = (x: T) => x[lang];
  const contents = lang === "es" ? "Contenido" : "Contents";
  const foot =
    lang === "es"
      ? "Casias Muffler and Tire Shop · Manual del sistema · Las pantallas están en inglés; los nombres de botones se muestran tal como aparecen."
      : "Casias Muffler and Tire Shop · Shop system manual · Button names are shown exactly as they appear on screen.";

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(t(doc.title))} — Casias Muffler and Tire Shop</title>
<style>${appStylesheet()}</style>
<style>${SPECIMEN_CSS}</style>
<style>
@page { size: letter; margin: 17mm 16mm 15mm; }
html,body{margin:0;padding:0;background:#fff}
body{font-family:"Segoe UI",system-ui,Roboto,Helvetica,Arial,sans-serif;color:#14181d;font-size:11.5pt;line-height:1.6}
p{margin:0 0 9px;max-width:57em}
.cover{padding:22mm 0 12mm;border-bottom:3px solid #0a2540;margin-bottom:8mm}
.cover .eyebrow{font-size:9.5pt;text-transform:uppercase;letter-spacing:.15em;color:#96690a;font-weight:700;margin-bottom:6mm}
.cover h1{font-family:Georgia,serif;font-size:30pt;line-height:1.1;font-weight:400;color:#0a2540;margin:0 0 4mm}
.cover .sub{font-family:Georgia,serif;font-size:14pt;font-style:italic;color:#4e5b68;margin:0 0 10mm}
.cover .who{font-size:10.5pt;color:#4e5b68}
h2{font-family:Georgia,serif;font-size:19pt;font-weight:400;color:#0a2540;margin:0 0 4mm;padding-bottom:2mm;border-bottom:2px solid #0a2540;break-before:page;break-after:avoid}
h2 .n{font-family:"Segoe UI",sans-serif;font-size:11pt;font-weight:700;color:#96690a;margin-right:3mm}
h3{font-size:12.5pt;font-weight:650;color:#0a2540;margin:7mm 0 2mm;break-after:avoid}
ol.steps{list-style:none;counter-reset:step;padding:0;margin:3mm 0 5mm}
ol.steps>li{counter-increment:step;position:relative;padding:0 0 4mm 12mm;break-inside:avoid}
ol.steps>li::before{content:counter(step);position:absolute;left:0;top:0;width:8mm;height:8mm;border-radius:50%;background:#0a2540;color:#fff;font-size:10pt;font-weight:700;display:flex;align-items:center;justify-content:center}
ul.plain{margin:2mm 0 5mm;padding-left:6mm}
ul.plain li{margin-bottom:2mm}
.chip{display:inline-block;border:1px solid #0a2540;border-radius:3px;padding:0 1.6mm;margin:0 .3mm;font-size:10pt;font-weight:650;color:#0a2540;background:#eef2f6;white-space:nowrap}
.note,.warn{padding:4mm 5mm;margin:4mm 0 5mm;break-inside:avoid;font-size:11pt}
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
tbody tr:nth-child(even) td{background:#fafbfc}
.yes{color:#14532d;font-weight:700}
.no{color:#7f1d1d}
.toc{break-after:page}
.toc ol{list-style:none;padding:0;margin:4mm 0 0;counter-reset:sec}
.toc li{counter-increment:sec;border-bottom:1px solid #d3d9e0;padding:2.4mm 0;display:flex;gap:4mm}
.toc li::before{content:counter(sec,decimal-leading-zero);color:#96690a;font-weight:700;font-size:10pt;min-width:9mm}
.figure{margin:4mm 0 6mm;break-inside:avoid}
.figure-shot{position:relative;display:inline-block;max-width:100%;border:1px solid #bbb;border-radius:2mm;overflow:hidden;line-height:0}
.figure-shot img{display:block;max-width:100%;max-height:105mm;width:auto;height:auto}
.pin{position:absolute;transform:translate(-50%,-50%);width:6mm;height:6mm;border-radius:50%;background:#96690a;color:#fff;border:.5mm solid #fff;font-size:8.5pt;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.legend{list-style:none;counter-reset:pin;padding:0;margin:3mm 0 0}
.legend li{counter-increment:pin;position:relative;padding:0 0 2mm 8mm;font-size:10pt}
.legend li::before{content:counter(pin);position:absolute;left:0;top:.3mm;width:5.5mm;height:5.5mm;border-radius:50%;background:#96690a;color:#fff;font-size:8pt;font-weight:700;display:flex;align-items:center;justify-content:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.foot{margin-top:9mm;padding-top:3mm;border-top:1px solid #d3d9e0;font-size:9pt;color:#4e5b68}
</style></head><body>
<div class="cover">
  <div class="eyebrow">${lang === "es" ? "Manual de uso" : "Staff manual"}</div>
  <h1>${esc(t(doc.title))}</h1>
  <div class="sub">${esc(t(doc.subtitle))}</div>
  <div class="who">Casias Muffler and Tire Shop · San Antonio, Texas<br>${
    lang === "es" ? "Para todo el personal" : "For all staff"
  } · ${lang === "es" ? "Agosto de 2026" : "August 2026"}</div>
</div>
<div class="warn"><div class="ct">${esc(t(doc.intro.title))}</div><p>${rich(
    t(doc.intro.body),
  )}</p></div>
<div class="toc"><h3 style="margin-top:0">${contents}</h3><ol>${doc.sections.map(
    (s) => `<li>${esc(t(s.title))}</li>`,
  ).join("")}</ol></div>
${doc.sections.map(
  (s, i) =>
    `<h2><span class="n">${String(i + 1).padStart(2, "0")}</span>${esc(t(s.title))}</h2>` +
    s.blocks.map((b) => block(b, lang)).join(""),
).join("\n")}
<div class="foot">${esc(foot)}</div>
</body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });

for (const [guide, lang, name] of [
  ["pos", "es", "Manual-del-Sistema"],
  ["pos", "en", "Shop-System-Manual"],
  ["timeclock", "es", "Manual-del-Reloj"],
  ["timeclock", "en", "Time-Clock-Manual"],
] as [Guide, Lang, string][]) {
  const html = path.join(OUT, `${name}.html`);
  fs.writeFileSync(html, document(guide, lang), "utf8");
  console.log("wrote", html);

  if (!CHROME) {
    console.log("  (no Chrome found — HTML only)");
    continue;
  }
  const pdf = path.join(OUT, `${name}.pdf`);
  execFileSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdf}`,
    `file:///${html.replace(/\\/g, "/")}`,
  ]);
  console.log("wrote", pdf, `(${Math.round(fs.statSync(pdf).size / 1024)} KB)`);
}
