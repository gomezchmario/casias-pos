/**
 * One-off tidy of names already in the roster.
 *
 * `createEmployee` and `updateEmployee` now run every name through
 * `properName()` in src/lib/names.ts, so anything typed from today on comes out
 * as Adrain rather than ADRAIN. This is for the rows that were entered before
 * that — it is the same rule applied once to what is already there.
 *
 * Safe to run repeatedly: a name that is already right is left alone, and the
 * mixed-case rule means running it twice cannot walk a name further away from
 * what somebody typed.
 *
 * The rule is duplicated here rather than imported because this is plain node
 * and the source of truth is TypeScript. If one changes, change both — and the
 * one in src/lib/names.ts is the one that matters, because it runs on every
 * write and this runs approximately never.
 *
 *   node scripts/tidy-employee-names.mjs           # show what would change
 *   node scripts/tidy-employee-names.mjs --apply   # write it
 */
import Database from "better-sqlite3";
import path from "node:path";

const apply = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "timeclock.db"));

function fixWord(word) {
  if (/[a-z]/.test(word) && /[A-Z]/.test(word)) return word;
  return word
    .toLowerCase()
    .replace(/(^|[-'’.])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}
const properName = (raw) =>
  !raw ? "" : raw.trim().split(/\s+/).map(fixWord).join(" ");

const rows = db.prepare("SELECT id, name FROM employees ORDER BY name").all();
const changes = rows
  .map((r) => ({ ...r, next: properName(r.name) }))
  .filter((r) => r.next !== r.name);

if (changes.length === 0) {
  console.log("Every name is already written the way it should print.");
} else {
  for (const c of changes) console.log(`  ${c.name}  ->  ${c.next}`);
  if (apply) {
    const stmt = db.prepare(
      "UPDATE employees SET name = ?, updated_at = ? WHERE id = ?",
    );
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const tx = db.transaction(() => {
      for (const c of changes) stmt.run(c.next, now, c.id);
    });
    tx();
    console.log(`\nUpdated ${changes.length}.`);
  } else {
    console.log(`\n${changes.length} to change. Re-run with --apply to write them.`);
  }
}
db.close();
