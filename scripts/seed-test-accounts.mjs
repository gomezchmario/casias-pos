/**
 * Four throwaway accounts, one per POS role, for walking the permission model
 * without borrowing a real employee's PIN.
 *
 * Named "Test <Role>" so they are obvious in the employee list and impossible to
 * confuse with staff on the clock-in screen. Run again any time to reset them.
 *
 *   node scripts/seed-test-accounts.mjs          add or update
 *   node scripts/seed-test-accounts.mjs --remove deactivate them
 *
 * These are real login credentials with real permissions. Deactivate them before
 * the shop goes live -- an owner-level account whose PIN is 4444 is a back door.
 */
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new Database(path.join(root, "data", "timeclock.db"));

const ACCOUNTS = [
  { name: "Test Technician", pin: "1111", posRole: "technician" },
  { name: "Test Cashier", pin: "2222", posRole: "cashier" },
  { name: "Test Manager", pin: "3333", posRole: "manager" },
  { name: "Test Owner", pin: "4444", posRole: "owner" },
];

const remove = process.argv.includes("--remove");
const now = new Date().toISOString().slice(0, 19).replace("T", " ");

if (remove) {
  const stmt = db.prepare(
    "UPDATE employees SET active = 0, updated_at = ? WHERE name = ?",
  );
  for (const a of ACCOUNTS) {
    const info = stmt.run(now, a.name);
    console.log(`${info.changes ? "deactivated" : "not found"}  ${a.name}`);
  }
  process.exit(0);
}

// Guard against handing a test PIN to someone who already uses it on the clock.
const live = db
  .prepare("SELECT id, name, pin_hash FROM employees WHERE active = 1")
  .all()
  .filter((e) => !ACCOUNTS.some((a) => a.name === e.name));

for (const a of ACCOUNTS) {
  const clash = live.filter((e) => bcrypt.compareSync(a.pin, e.pin_hash));
  if (clash.length > 0) {
    console.error(
      `refusing to seed ${a.name}: PIN ${a.pin} already belongs to ${clash
        .map((c) => c.name)
        .join(", ")}`,
    );
    process.exit(1);
  }
}

const insert = db.prepare(
  `INSERT INTO employees (name, pin_hash, role, active, pos_role, created_at, updated_at)
   VALUES (?, ?, 'EMPLOYEE', 1, ?, ?, ?)`,
);
const update = db.prepare(
  `UPDATE employees SET pin_hash = ?, pos_role = ?, active = 1, pos_failed_attempts = 0,
     pos_locked_until = NULL, updated_at = ? WHERE id = ?`,
);
const find = db.prepare("SELECT id FROM employees WHERE name = ?");

for (const a of ACCOUNTS) {
  const hash = bcrypt.hashSync(a.pin, 10);
  const existing = find.get(a.name);
  if (existing) {
    update.run(hash, a.posRole, now, existing.id);
    console.log(`updated  ${a.name.padEnd(16)} pin ${a.pin}  ${a.posRole}`);
  } else {
    insert.run(a.name, hash, a.posRole, now, now);
    console.log(`created  ${a.name.padEnd(16)} pin ${a.pin}  ${a.posRole}`);
  }
}

console.log("\nRemove them with: node scripts/seed-test-accounts.mjs --remove");
