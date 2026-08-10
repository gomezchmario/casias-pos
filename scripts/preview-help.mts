/**
 * Renders the Help page as a PNG, without a browser or a sign-in.
 *
 * For looking at how it reads when you are not standing at the machine — the
 * page is public now, but "public" still means finding a browser pointed at the
 * register. This walks the same content through the same stylesheet and takes a
 * picture.
 *
 *   npx --yes tsx scripts/preview-help.mts timeclock es
 *   npx --yes tsx scripts/preview-help.mts pos en 1500
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  MANUALS,
  type Block,
  type Guide,
  type Lang,
  type T,
} from "../src/lib/manual.ts";

const guide = ((process.argv[2] as Guide) || "pos") as Guide;
const lang = ((process.argv[3] as Lang) || "es") as Lang;
const doc = MANUALS[guide];
const t = (x: T) => x[lang];
const OUT = path.resolve("docs");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rich = (s: string) =>
  esc(s)
    .replace(/\[\[(.+?)\]\]/g, '<span class="manual-chip">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
const yesNo = (c: string) =>
  c === "Sí" || c === "Yes" ? ' class="manual-yes"' : c === "No" ? ' class="manual-no"' : "";

function block(b: Block): string {
  switch (b.kind) {
    case "p":
      return `<p>${rich(t(b.text))}</p>`;
    case "h3":
      return `<h3>${rich(t(b.text))}</h3>`;
    case "steps":
      return `<ol class="manual-steps">${b.items.map((i) => `<li>${rich(t(i))}</li>`).join("")}</ol>`;
    case "list":
      return `<ul class="manual-list">${b.items.map((i) => `<li>${rich(t(i))}</li>`).join("")}</ul>`;
    case "note":
    case "warn":
      return `<div class="manual-${b.kind}"><div class="manual-callout-title">${esc(
        t(b.title),
      )}</div>${b.body.map((p) => `<p>${rich(t(p))}</p>`).join("")}</div>`;
    case "figure":
      return (
        `<figure class="manual-figure"><div class="manual-figure-shot">` +
        `<img src="file:///${path.resolve("public/manual").replace(/\\/g, "/")}/${b.src}" alt="${esc(t(b.alt))}">` +
        b.callouts
          .map(
            (c, j) =>
              `<span class="manual-pin" style="left:${c.x}%;top:${c.y}%">${j + 1}</span>`,
          )
          .join("") +
        `</div><ol class="manual-legend">` +
        b.callouts.map((c) => `<li>${rich(t(c.text))}</li>`).join("") +
        `</ol></figure>`
      );
    case "table":
      return `<div class="manual-table-wrap"><table class="manual-table"><thead><tr>${b.head
        .map((h) => `<th>${esc(t(h))}</th>`)
        .join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td${yesNo(t(c))}>${rich(t(c))}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
  }
}

const css = fs.readFileSync(path.resolve("src/app/help/help.css"), "utf8");

const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
${css}
/* the bits the real page gets from Tailwind and the POS shell */
body{margin:0;background:#f4f6fa;font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif}
.wrap{padding:24px}
.manual{max-width:56rem;margin:0 auto}
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}
.head h1{font-size:24px;font-weight:600;color:#0a2540;margin:0}
.head p{font-size:14px;color:#4f6e8e;margin:4px 0 0}
.ctl{display:flex;align-items:center;gap:8px}
.seg{display:flex;border:1px solid rgba(0,0,0,.1);border-radius:8px;overflow:hidden}
.seg button{padding:0 12px;height:36px;font-size:14px;font-weight:500;border:0;cursor:pointer}
.seg .on{background:#0a2540;color:#fff}
.seg .off{background:#fff;color:#1f3f64}
.btn{height:36px;padding:0 14px;border:1px solid rgba(0,0,0,.12);background:#fff;border-radius:8px;font-size:14px;font-weight:500;color:#0a2540;cursor:pointer}
</style></head><body><div class="wrap"><div class="manual">
<div class="head">
  <div><h1>${esc(t(doc.title))}</h1><p>${esc(t(doc.subtitle))}</p></div>
  <div class="ctl">
    <div class="seg">
      <button class="${guide === "pos" ? "on" : "off"}">${lang==="es"?"Caja":"Register"}</button>
      <button class="${guide === "timeclock" ? "on" : "off"}">${lang==="es"?"Reloj":"Time clock"}</button>
    </div>
    <div class="seg">
      <button class="${lang === "es" ? "on" : "off"}">Español</button>
      <button class="${lang === "en" ? "on" : "off"}">English</button>
    </div>
    <button class="btn">${lang === "es" ? "Imprimir" : "Print"}</button>
  </div>
</div>
<div class="manual-warn"><div class="manual-callout-title">${esc(
  t(doc.intro.title),
)}</div><p>${rich(t(doc.intro.body))}</p></div>
<div class="manual-toc"><div class="manual-callout-title">${
  lang === "es" ? "Contenido" : "Contents"
}</div><ol>${doc.sections.map((s) => `<li><a href="#">${esc(t(s.title))}</a></li>`).join("")}</ol></div>
${doc.sections.map(
  (s, i) =>
    `<section class="manual-section"><h2><span class="manual-num">${String(i + 1).padStart(
      2,
      "0",
    )}</span>${esc(t(s.title))}</h2>${s.blocks.map(block).join("")}</section>`,
).join("")}
</div></div></body></html>`;

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `help-preview-${guide}-${lang}.html`);
fs.writeFileSync(file, html, "utf8");

const height = Number(process.argv[4] || 1400);
const png = path.join(OUT, `help-preview-${guide}-${lang}.png`);
execFileSync(CHROME, [
  "--headless",
  "--disable-gpu",
  "--hide-scrollbars",
  `--window-size=1180,${height}`,
  `--screenshot=${png}`,
  `file:///${file.replace(/\\/g, "/")}`,
]);
console.log("wrote", png);
