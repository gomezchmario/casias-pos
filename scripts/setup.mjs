// First-run setup: generate session secret, create database, seed admin + sample employees.
// Idempotent — safe to run multiple times.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, ".env.local");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "timeclock.db");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");

function nowLocalIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function ensureEnv() {
  let envContent = fs.existsSync(ENV_FILE)
    ? fs.readFileSync(ENV_FILE, "utf-8")
    : "";

  let updated = envContent;
  let added = [];

  if (!/^SESSION_SECRET=/m.test(envContent)) {
    const secret = crypto.randomBytes(48).toString("base64url");
    updated += (updated && !updated.endsWith("\n") ? "\n" : "") +
      `SESSION_SECRET=${secret}\n`;
    added.push("SESSION_SECRET");
  }
  if (!/^DEFAULT_ADMIN_USERNAME=/m.test(envContent)) {
    updated += `DEFAULT_ADMIN_USERNAME=admin\n`;
    added.push("DEFAULT_ADMIN_USERNAME");
  }
  if (!/^DEFAULT_ADMIN_PASSWORD=/m.test(envContent)) {
    updated += `DEFAULT_ADMIN_PASSWORD=changeme\n`;
    added.push("DEFAULT_ADMIN_PASSWORD");
  }

  if (added.length > 0) {
    fs.writeFileSync(ENV_FILE, updated);
    console.log(`  + Wrote ${added.join(", ")} to .env.local`);
  } else {
    console.log("  ✓ .env.local already has all required keys");
  }
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log("  ✓ data/ and uploads/ directories ready");
}

function runMigrations(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    db.prepare("SELECT filename FROM _migrations").all().map((r) => r.filename),
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)",
      ).run(file, nowLocalIso());
      db.exec("COMMIT");
      console.log(`  + Applied migration: ${file}`);
      count++;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  if (count === 0) console.log("  ✓ All migrations already applied");
}

function ensureDefaultSettings(db) {
  const defaults = {
    company_name: "Casias Tire Shop",
    // Thursday -- the shop's week. Must match DEFAULT_SETTINGS in
    // src/lib/settings.ts, or a fresh install reports a different week than the
    // app was written for.
    week_start_day: "4",
    auto_close_hour: "21",
    photo_retention_days: "90",
    break_auto_deduct_minutes: "0",
  };
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  );
  let added = 0;
  for (const [k, v] of Object.entries(defaults)) {
    const result = stmt.run(k, v);
    if (result.changes > 0) added++;
  }
  console.log(
    added > 0
      ? `  + Initialized ${added} default settings`
      : "  ✓ Settings already present",
  );
}

function ensureAdmin(db) {
  const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
  const password = process.env.DEFAULT_ADMIN_PASSWORD || "changeme";

  const existing = db.prepare("SELECT COUNT(*) AS c FROM admin_users").get();
  if (existing.c > 0) {
    console.log("  ✓ Admin user already exists");
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO admin_users (username, password_hash, must_change_password, created_at) VALUES (?, ?, 1, ?)",
  ).run(username, hash, nowLocalIso());
  console.log(`  + Created admin user "${username}" (password: "${password}")`);
  console.log(`    >>> CHANGE THIS PASSWORD on first login <<<`);
}

function ensureSampleEmployees(db) {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM employees").get();
  if (existing.c > 0) {
    console.log("  ✓ Employees already exist — skipping samples");
    return;
  }
  const samples = [
    { name: "Alex Rivera", pin: "1234", role: "Tech" },
    { name: "Sam Patel", pin: "2345", role: "Tech" },
    { name: "Jordan Kim", pin: "3456", role: "Front Desk" },
  ];
  const insert = db.prepare(
    "INSERT INTO employees (name, pin_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
  );
  const now = nowLocalIso();
  for (const s of samples) {
    insert.run(s.name, bcrypt.hashSync(s.pin, 10), s.role, now, now);
  }
  console.log(`  + Seeded ${samples.length} sample employees`);
  console.log(`    Sample PINs: ${samples.map((s) => `${s.name} → ${s.pin}`).join(", ")}`);
}

function main() {
  console.log("=== Casias Tire Shop Time Clock — Setup ===\n");

  console.log("[1/5] Ensuring .env.local...");
  ensureEnv();

  console.log("\n[2/5] Ensuring directories...");
  ensureDirs();

  // Reload env now that .env.local definitely exists.
  const envText = fs.readFileSync(ENV_FILE, "utf-8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

  const db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    console.log("\n[3/5] Running migrations...");
    runMigrations(db);

    console.log("\n[4/5] Ensuring default settings + admin...");
    ensureDefaultSettings(db);
    ensureAdmin(db);

    console.log("\n[5/5] Seeding sample employees...");
    ensureSampleEmployees(db);
  } finally {
    db.close();
  }

  console.log("\n=== Setup complete ===");
  console.log("Run `npm run dev` to start the kiosk + admin server.");
  console.log("Kiosk:  http://localhost:3000");
  console.log("Admin:  http://localhost:3000/admin");
}

main();
