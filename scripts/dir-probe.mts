/**
 * End-to-end probe for the company directory.
 *
 * Sets a code on one company as the owner, then exercises the outside door the
 * way somebody outside the shop would: a good code, the profile, the throttle,
 * and — the one that matters — an attempt to edit a vehicle belonging to a
 * DIFFERENT company while holding a perfectly valid session.
 *
 * Two separate cookie jars, because the throttle counts per device and the
 * lockout earned by the guessing test would otherwise shut the good path out of
 * its own run. The good path goes first for the same reason.
 *
 * Run against production with the server up.
 */
const BASE = "https://localhost:3000";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import Database from "better-sqlite3";

const db = new Database("data/timeclock.db");

const owner = db
  .prepare(`SELECT id, name FROM employees WHERE pos_role = 'owner' AND active = 1 LIMIT 1`)
  .get() as { id: number; name: string };

const [a, b] = db
  .prepare(`SELECT id, name FROM customers WHERE is_fleet = 1 AND deleted = 0 ORDER BY id LIMIT 2`)
  .all() as { id: number; name: string }[];

const { setDirPin, clearDirPin } = await import("../src/lib/directory.ts");
const me = { employeeId: owner.id, name: owner.name, role: "owner" as const };

const set = setDirPin(me, a.id, "TIRE");
if (!set.ok) throw new Error(set.error);
const slug = set.slug;

console.log(`owner    ${owner.name}`);
console.log(`company  ${a.name} → /dir/${slug}   (code TIRE)`);
console.log(`other    ${b.name}`);

/*
  A driver and a truck on the OTHER company, made here and removed at the end.

  Seeded rather than found because no fleet in the book has a vehicle yet, and a
  cross-company test that quietly skips itself when it finds nothing to reach
  for is worse than no test: it prints nothing and reads as a pass. This is the
  single rule the whole portal rests on, so it gets a row to try it against.
*/
const seededDriver = Number(
  db
    .prepare(
      `INSERT INTO customers (customer_no, name, phone, fleet_id, is_fleet, created_at, updated_at)
       VALUES (?, 'Probe Driver', NULL, ?, 0, datetime('now','localtime'), datetime('now','localtime'))`,
    )
    .run(`C-PROBE-${Date.now()}`, b.id).lastInsertRowid,
);
const seededVehicle = Number(
  db
    .prepare(
      `INSERT INTO vehicles (customer_id, make, model, notes, created_at, updated_at)
       VALUES (?, 'Ford', 'F-250', 'untouched', datetime('now','localtime'), datetime('now','localtime'))`,
    )
    .run(seededDriver).lastInsertRowid,
);

const victim = db
  .prepare(
    `SELECT v.id, v.make, v.model, v.notes, c.name AS owner
       FROM vehicles v JOIN customers c ON c.id = v.customer_id
      WHERE v.id = ?`,
  )
  .get(seededVehicle) as { id: number; make: string; model: string; notes: string | null; owner: string };

/** One browser. Keeps its own cookies, so the throttle sees it as one device. */
function jar() {
  let cookie = "";
  return async (path: string, init: RequestInit = {}) => {
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
}

let fails = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? " · " + detail : ""}`);
};

// ── Device 1: the company's own office ─────────────────────────────────────
console.log("\n── the company's office ──");
const office = jar();

const anon = await office("/api/dir/profile");
check("profile refused with no session", anon.status === 401);

const wrong = await office(`/api/dir/${slug}/login`, { method: "POST", body: JSON.stringify({ pin: "NOPE" }) });
check("wrong code refused", wrong.status === 401, String(wrong.body.error));

const good = await office(`/api/dir/${slug}/login`, { method: "POST", body: JSON.stringify({ pin: "tire" }) });
check("correct code opens (and case does not matter)", good.status === 200, String(good.body.name ?? good.body.error));

const prof = await office("/api/dir/profile");
const p = prof.body.profile as
  | { company: { name: string }; balanceCents: number; drivers: unknown[]; charges: unknown[] }
  | undefined;
check("profile loads", prof.status === 200 && !!p);
if (p)
  console.log(
    `        ${p.company.name} · owes ${(p.balanceCents / 100).toFixed(2)} · ` +
      `${p.drivers.length} drivers · ${p.charges.length} charges`,
  );

// ── The rule the whole design rests on ─────────────────────────────────────
{
  console.log(`\n── ${a.name} reaches for ${victim.owner}'s ${victim.make} ${victim.model} ──`);
  const cross = await office(`/api/dir/vehicles/${victim.id}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: "SHOULD NEVER LAND" }),
  });
  check("cross-company vehicle edit refused", cross.status !== 200, String(cross.body.error));

  const after = db.prepare(`SELECT notes FROM vehicles WHERE id = ?`).get(victim.id) as { notes: string | null };
  check("the row is untouched", after.notes === victim.notes, `notes = ${after.notes ?? "null"}`);

  const otherDriver = db
    .prepare(`SELECT id, name FROM customers WHERE fleet_id = ? AND deleted = 0 LIMIT 1`)
    .get(b.id) as { id: number; name: string } | undefined;
  if (otherDriver) {
    const cd = await office(`/api/dir/drivers/${otherDriver.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "SHOULD NEVER LAND" }),
    });
    check("cross-company driver edit refused", cd.status !== 200, String(cd.body.error));
  }
}

// ── And the company must not rename itself ─────────────────────────────────
const selfRename = await office(`/api/dir/drivers/${a.id}`, {
  method: "PATCH",
  body: JSON.stringify({ name: "Renamed By The Customer" }),
});
check("company cannot rename itself", selfRename.status !== 200, String(selfRename.body.error));

// ── Device 2: somebody sitting on the address trying words ─────────────────
console.log("\n── somebody guessing ──");
const guesser = jar();
for (let i = 1; i <= 5; i++) {
  const r = await guesser(`/api/dir/${slug}/login`, { method: "POST", body: JSON.stringify({ pin: "ZZZZ" }) });
  process.stdout.write(`  ${i}:${r.status} `);
}
console.log();
const lockedOut = await guesser(`/api/dir/${slug}/login`, { method: "POST", body: JSON.stringify({ pin: "TIRE" }) });
check("the CORRECT code is refused during the lockout", lockedOut.status !== 200, String(lockedOut.body.error));

const stillIn = await office("/api/dir/profile");
check("the guesser's lockout did not touch the office", stillIn.status === 200);

// ── Tidy up ────────────────────────────────────────────────────────────────
clearDirPin(me, a.id);
const closed = await office("/api/dir/profile");
check("closing the page ends the live session", closed.status === 401);

// The seeded rows go, whatever the checks said.
db.prepare('DELETE FROM vehicles WHERE id = ?').run(seededVehicle);
db.prepare('DELETE FROM customers WHERE id = ?').run(seededDriver);

const visits = db
  .prepare(`SELECT ok, COUNT(*) AS n FROM dir_visits WHERE customer_id = ? GROUP BY ok`)
  .all(a.id) as { ok: number; n: number }[];
console.log(`\nrecorded visits: ${visits.map((v) => `${v.n} ${v.ok ? "good" : "refused"}`).join(", ")}`);

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} CHECK(S) FAILED.`);
db.close();
process.exit(fails === 0 ? 0 : 1);
