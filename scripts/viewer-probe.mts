/**
 * Does the viewer account reach the register, and is it still unable to use it?
 *
 * Both halves matter and they pull against each other, which is why they are
 * checked together: opening the screen is the whole point of the account, and
 * writing a ticket from it would defeat the whole point of the account.
 */
const BASE = "https://localhost:3000";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import Database from "better-sqlite3";
const db = new Database("data/timeclock.db");

const viewer = db
  .prepare(`SELECT id, name, pos_role FROM employees WHERE pos_role = 'viewer' AND active = 1 LIMIT 1`)
  .get() as { id: number; name: string; pos_role: string } | undefined;
if (!viewer) throw new Error("no active viewer account");
console.log(`viewer: ${viewer.name}\n`);

let cookie = "";
const call = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", cookie, ...(init.headers ?? {}) },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(";")[0];
    const name = pair.split("=")[0];
    cookie = cookie.split("; ").filter((x) => x && !x.startsWith(name + "=")).concat(pair).join("; ");
  }
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

let fails = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? " · " + detail : ""}`);
};

const pin = process.argv[2] ?? "0813";
const login = await call("/api/pos/auth/kiosk", { method: "POST", body: JSON.stringify({ pin }) });
check("viewer signs in", login.status === 200, String(login.body.error ?? ""));
if (login.status !== 200) { db.close(); process.exit(1); }

console.log("\n── may look ──");
const furniture = await call("/api/pos/register");
check("the register screen loads", furniture.status === 200, String(furniture.body.error ?? ""));
const open = await call("/api/pos/sales?scope=open");
check("open tickets load", open.status === 200, String(open.body.error ?? ""));

console.log("\n── may not touch ──");
const before = (db.prepare("SELECT COUNT(*) AS n FROM sales").get() as { n: number }).n;
const ring = await call("/api/pos/sales", { method: "POST", body: JSON.stringify({ kind: "sale" }) });
check("ringing a new ticket is refused", ring.status !== 200, String(ring.body.error ?? JSON.stringify(ring.body)));
const after = (db.prepare("SELECT COUNT(*) AS n FROM sales").get() as { n: number }).n;
check("no ticket landed in the ledger", before === after, `${before} → ${after}`);

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} CHECK(S) FAILED.`);
db.close();
process.exit(fails === 0 ? 0 : 1);
