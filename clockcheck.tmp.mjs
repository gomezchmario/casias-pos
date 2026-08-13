// A technician must still be offered the clock exactly as before.
const db = (await import("better-sqlite3")).default("data/timeclock.db", { readonly: true });
const rows = db.prepare("SELECT id, name, pin_hash, pos_role FROM employees WHERE active = 1").all();
const bcrypt = (await import("bcryptjs")).default;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

for (const r of rows) {
  for (let n = 0; n < 10000; n++) {
    const pin = String(n).padStart(4, "0");
    if (bcrypt.compareSync(pin, r.pin_hash)) {
      const res = await fetch("https://localhost:3000/api/checkin/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const j = await res.json();
      console.log(
        `${r.name.padEnd(16)} ${String(r.pos_role).padEnd(11)} actions=${JSON.stringify(j.actions).padEnd(28)} register=${j.employee?.canRegister}`,
      );
      break;
    }
  }
}
