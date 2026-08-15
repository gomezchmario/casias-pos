/**
 * How much of a screen is translatable, and how much of that is translated.
 *
 * Two different failures, and the difference decides the work. A string wrapped
 * in tr() with no Spanish is one line in the dictionary. A string NOT wrapped in
 * tr() cannot be translated at all however full the dictionary gets — it has to
 * be wrapped first, and on these pages that is most of the prose.
 *
 * Run: npx tsx scripts/i18n-audit.mts [path ...]
 */
import fs from "node:fs";
import path from "node:path";

const dict = fs.readFileSync("src/lib/i18n.ts", "utf8");
const body = dict.slice(dict.indexOf("const ES"), dict.indexOf("\n};", dict.indexOf("const ES")));
/*
  Both spellings of a key. A phrase needing no escaping is written bare —
  `Drawer: "Caja"` — and only quoted when JS forces it, so a quoted-only match
  silently reports every bare key as untranslated. That is not a cosmetic miss:
  it reads as "nothing is translated" and invites the whole block to be added a
  second time.
*/
const have = new Set(
  [...body.matchAll(/^ {2}(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*)):/gm)].map((m) => m[1] ?? m[2]),
);

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx$/.test(e.name) ? [p] : [];
  });

const targets = process.argv.slice(2);
const files = targets.length
  ? targets.flatMap((t) => (fs.statSync(t).isDirectory() ? walk(t) : [t]))
  : walk("src/app/pos");

let wrapped = 0;
const missing = new Set<string>();
const bare = new Map<string, string[]>();

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");

  for (const m of text.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    wrapped += 1;
    if (!have.has(m[1])) missing.add(m[1]);
  }

  /*
    Bare English in the markup: a JSX text node of two or more words, letters
    only, that is not inside a tr(). Deliberately crude — it is a worklist, not
    a linter, and a few false positives cost less than a missed paragraph.
  */
  for (const m of text.matchAll(/>\s*([A-Z][A-Za-z][^<>{}"]{12,})\s*</g)) {
    const s = m[1].replace(/\s+/g, " ").trim();
    if (!/[a-z]/.test(s) || s.split(" ").length < 3) continue;
    if (text.includes(`tr("${s}"`)) continue;
    bare.set(file, [...(bare.get(file) ?? []), s]);
  }
}

console.log(`files          ${files.length}`);
console.log(`tr() calls     ${wrapped}`);
console.log(`missing es     ${missing.size}`);
console.log(`bare English   ${[...bare.values()].flat().length}\n`);

if (missing.size) {
  console.log("— wrapped but not translated —");
  for (const s of [...missing].sort()) console.log(`  ${JSON.stringify(s)}: "",`);
}
if (bare.size) {
  console.log("\n— not wrapped in tr() —");
  for (const [file, list] of bare) {
    console.log(`  ${path.relative(".", file)}`);
    for (const s of [...new Set(list)]) console.log(`     ${s.slice(0, 96)}`);
  }
}
