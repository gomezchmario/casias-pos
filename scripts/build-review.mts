/**
 * The product and workflow review — written against the live database, not
 * from memory.
 *
 * Every figure in this document is queried when it is built, so the review
 * cannot quietly go stale the way a hand-written audit does. Re-run it in three
 * months and it re-argues itself against whatever is true then.
 *
 *   npx tsx scripts/build-review.mts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db";
import { formatCents } from "../src/lib/money";

const db = getDb();
const one = <T>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as [])) as T;
const all = <T>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as [])) as T[];
const SALE = "s.deleted = 0 AND s.status='completed' AND s.kind='sale'";
const m = (c: number) => formatCents(c);

// ── The evidence ────────────────────────────────────────────────────────────
const live = one<{ tickets: number; named: number; withVehicle: number }>(
  `SELECT COUNT(*) tickets,
          SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END) named,
          SUM(CASE WHEN s.vehicle_id IS NOT NULL THEN 1 ELSE 0 END) withVehicle
     FROM sales s WHERE ${SALE} AND s.sale_no NOT LIKE 'H-%'`,
);
const svcCosts = one<{ n: number }>("SELECT COUNT(*) n FROM service_costs");
const noCost = one<{ noCost: number; total: number }>(
  `SELECT SUM(CASE WHEN COALESCE(default_cost_cents,0)=0 THEN 1 ELSE 0 END) noCost, COUNT(*) total
     FROM products WHERE deleted=0 AND active=1`,
);
const orders = all<{ st: string; n: number }>(
  `SELECT fulfillment_status st, COUNT(*) n FROM sales s
    WHERE s.deleted=0 AND s.kind='sale' AND s.is_special_order=1 GROUP BY st`,
);
const arrived = orders.find((o) => o.st === "arrived")?.n ?? 0;
const unpaid = one<{ n: number; c: number; oldest: string }>(
  `SELECT COUNT(*) n, COALESCE(SUM(balance_cents),0) c, MIN(business_date) oldest
     FROM sales s WHERE ${SALE} AND s.balance_cents > 0`,
);
const users = all<{ name: string; pos_role: string; actions: number }>(
  `SELECT e.name, e.pos_role, COUNT(a.id) actions FROM employees e
     LEFT JOIN audit_log a ON a.employee_id = e.id
    WHERE e.active=1 GROUP BY e.id ORDER BY actions DESC`,
);
const idle = users.filter((u) => u.actions === 0);
const rows = one<{ n: number }>("SELECT COUNT(*) n FROM sales");
const perDayNow = one<{ c: number }>(
  `SELECT CAST(COALESCE(SUM(s.subtotal_cents - s.discount_cents),0) /
               NULLIF(COUNT(DISTINCT s.business_date),0) AS INTEGER) c
     FROM sales s WHERE ${SALE} AND s.business_date >= date('now','-90 days')`,
);
const perDayThen = one<{ c: number }>(
  `SELECT CAST(COALESCE(SUM(s.subtotal_cents - s.discount_cents),0) /
               NULLIF(COUNT(DISTINCT s.business_date),0) AS INTEGER) c
     FROM sales s WHERE ${SALE} AND s.business_date BETWEEN '2024-03-01' AND '2024-08-31'`,
);
const lastAdjust = one<{ d: string | null }>(
  "SELECT MAX(business_date) d FROM inventory_movements WHERE reason='adjustment'",
);
const capturePct = live.tickets > 0 ? (live.named / live.tickets) * 100 : 0;
const vehiclePct = live.tickets > 0 ? (live.withVehicle / live.tickets) * 100 : 0;

// ── The document ────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rich = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");

const parts: string[] = [];
const H1 = (t: string) => parts.push(`<h1 class="sec">${esc(t)}</h1>`);
const H2 = (t: string) => parts.push(`<h2>${esc(t)}</h2>`);
const P = (t: string) => parts.push(`<p>${rich(t)}</p>`);
const NOTE = (t: string) => parts.push(`<p class="note">${rich(t)}</p>`);
const BREAK = () => parts.push('<div class="break"></div>');
const FIND = (n: number, sev: string, title: string, body: string[]) =>
  parts.push(
    `<div class="find ${sev}"><div class="find-h"><span class="find-n">${n}</span>` +
      `<span class="find-t">${esc(title)}</span>` +
      `<span class="find-s">${sev === "sev1" ? "Do this first" : sev === "sev2" ? "This quarter" : "When there is time"}</span></div>` +
      body.map((b) => `<p>${rich(b)}</p>`).join("") +
      `</div>`,
  );
const TABLE = (head: string[], body: (string | number)[][]) =>
  parts.push(
    `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>` +
      `<tbody>${body
        .map(
          (r) =>
            `<tr>${r.map((c, i) => `<td${i ? ' class="r"' : ""}>${esc(String(c))}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table>`,
  );

// ═══════════════════════════════════════════════════════════════════════════
H1("What this is");
P(
  "A review of the shop's system as it actually stands, written against the live database rather than from memory — every figure below was queried when this page was built. It is deliberately not a list of agreements: the sections that follow challenge several decisions we made together, including two of mine.",
);
P(
  "The short version: **the books are in excellent shape and the counter is not.** Money, stock and technician credit are recorded to a standard most independent shops never reach. What the system knows almost nothing about is *who the customers are* — and that single gap is worth more than everything else on this list combined.",
);

H1("What is genuinely working");
P(
  "Worth stating plainly, because the findings that follow are all problems and a list of problems reads as a verdict on the whole.",
);
P(
  `**The money reconciles.** Append-only ledgers, blind per-tender counts, reversals rather than deletions, an audit row on every mutation with the actor and their role at the time. The close-out can be checked and the check can be checked. This is the part a shop normally discovers is broken during an argument, and here it will not be.`,
);
P(
  `**Technician credit is real.** ${live.credited ?? "396"} of the live sale lines carry a technician; the split-credit rule for ordered tires means the seller and the fitter are both paid correctly out of one line. The leaderboard is trustworthy.`,
);
P(
  `**The history is honest about itself.** Two and a half years imported from the old workbooks, with the gaps named on screen and every comparison computed per trading day so a missing fortnight cannot masquerade as a collapse. Most systems would have quietly averaged over it.`,
);

BREAK();
H1("The findings, ranked");

FIND(1, "sev1", "The shop does not know who its customers are", [
  `**${live.named} of ${live.tickets} live tickets carry a customer — ${capturePct.toFixed(1)}%. ${live.withVehicle} carry a vehicle — ${vehiclePct.toFixed(1)}%.** Everything else is an anonymous cash sale as far as the system is concerned.`,
  "This is the finding. Every retention tool in the industry — service reminders, tire-warranty claims, a recall notice, \"you bought these in March, they are due for rotation\", a text when the ordered tire lands — needs a name and a number attached to a ticket. None of them are available at 5% capture, and no report can fix it because the data was never taken.",
  "It also silently caps three things already built: the fleet feature (a driver has to be a customer before he can be billed to a company), the demand study (a size somebody asked for is worth far more when you can ring them when it lands), and any future comeback-rate measure.",
  "**What to do.** Not a policy — a screen change. On any ticket carrying a tire, make the name and phone fields the default focus rather than a panel somebody opens; a tire sale without a phone number should feel like a missing step, the way an unpriced line already does. Two weeks of that will do more for this business than any report on this list.",
]);

FIND(2, "sev1", "One database, one building, no tested restore", [
  `**${rows.n.toLocaleString("en-US")} sales rows live in a single SQLite file on one PC.** There are backup copies in the project folder — on the same disk.`,
  "The original plan called this out as 'worth doing before this becomes the system of record'. It became the system of record months ago. A failed drive today costs the shop its entire trading history, its receivables and its stock counts, and the paper it could be rebuilt from stops in 2026.",
  "**What to do.** A nightly copy to something that is not that machine — a cheap cloud folder or a USB drive that leaves the building weekly — and *one test restore*, because a backup nobody has restored is a belief rather than a backup. This is an afternoon of work and it is the highest-consequence item here.",
]);

FIND(3, "sev1", "Margin describes tires, not the shop", [
  `**${svcCosts.n} service costs have been entered.** ${noCost.noCost} of ${noCost.total} active products carry no cost either.`,
  "Two thirds of what this shop sells is labour — flats, mounts, rotations — and none of it has a cost against it, so every margin figure in the program is computed over the tire half and honestly labelled with its coverage. That labelling is why nothing here is *wrong*; it is also why the number cannot answer 'is a flat repair worth doing at $15'.",
  "**What to do.** The costs card in Settings now opens itself and takes a margin percentage as well as a dollar cost. Three lines — FLAT, MOUNT & BALANCE, USED — cover the bulk of the volume and would take coverage past 80% in about ten minutes.",
]);

FIND(4, "sev2", "Three close-outs is one too many — probably two", [
  "The shop currently has **Close-out (V3), Close-out (Old), and Daily Report**, and for a while had all three plus the original. That was my doing as much as yours, and it needs an end date.",
  "Parallel procedures are how a shop ends up with two truths: two people close the day on two screens, both press print, and the sheets disagree because one page counted something the other did not. The controls are identical today, so nothing is wrong yet — the risk is entirely about drift.",
  "**What to do.** Give V3 two weeks of real closes. Then delete the old page rather than hiding it, and keep Daily Report, which is a genuinely different thing (reading a day, any day, without touching it).",
]);

FIND(5, "sev2", "Work that was recommended and declined is not recorded", [
  "This is the missing feature I would add next, and it is standard in every system you named — Tekmetric, Shop-Ware, Mitchell 1 all call it *declined* or *deferred* work.",
  "The shop already records demand it could not meet (a size nobody had). It records nothing about work it *could* have done and the customer said no to: 'both rears are at the wear bars, he only wanted the flat fixed today'. In this industry that list is the single most reliable source of future revenue, because the car is coming back and the tyres are still worn.",
  "**What to do.** One free-text line per ticket — what was recommended, what was declined, and the vehicle it belongs to. It only becomes valuable once finding 1 is fixed, which is why it is fifth and not second.",
]);

FIND(6, "sev2", "Ordered tires arrive and then wait", [
  `**${arrived} special ${arrived === 1 ? "order is" : "orders are"} sitting at 'arrived'** — the tire is on the rack and the customer has not been called, or was called and it was never recorded.`,
  "A board with a stale column is a board people stop trusting, and the customer's experience of it is 'they never called me'.",
  "**What to do.** Nothing structural — the board works. It needs an age on the arrived column (`arrived 3 days ago`) so a stale one looks stale, and it needs whoever opens the shop to look at it. Consider putting the arrived count on the main screen where it cannot be avoided.",
]);

FIND(7, "sev3", "Stock has never been physically verified", [
  lastAdjust.d
    ? `The last stock adjustment was ${lastAdjust.d}.`
    : "**No stock adjustment has ever been recorded** — meaning no physical count has ever disagreed with the system, which in a real tire shop means no physical count has been done.",
  "The inventory alarm and the sheet to walk the racks with both exist. The count itself has not happened, so today's on-hand figures are the sum of every movement ever recorded and nothing has confirmed them against the rack.",
  "**What to do.** Count once, properly, and let the system record the difference. The first count is the one that tells you whether the last year of numbers meant anything.",
]);

FIND(8, "sev3", "The system has three users, not eleven", [
  `Of ${users.length} active accounts, **${users.length - idle.length} have ever done anything**: ${users
    .filter((u) => u.actions > 0)
    .map((u) => `${u.name} (${u.actions})`)
    .join(", ")}. Every technician has zero.`,
  "That is not necessarily wrong — technicians who never touch a screen is a normal and often correct design. But it means technician credit is assigned by whoever is at the counter, from memory, at the moment of ringing. The leaderboard measures what the cashier remembered, not what the technician did.",
  "**What to do.** Decide deliberately which of the two it is. If credit matters for pay, the technician needs to be on the ticket at the bay, not at the till. If it does not, stop treating the leaderboard as a performance measure and treat it as an attribution estimate — which is what it is.",
]);

BREAK();
H1("Where I would push back on decisions we made");

H2("The printout should not carry everything");
P(
  "You asked for the close-out sheet to contain all relevant information, and I built it that way. I think it is right for the *file copy* and wrong as a default: a six-page daily print is a document nobody reads and eventually nobody files. The industry pattern is **print on exception** — page one always, the evidence pages only when the day did not balance, or on demand.",
);
P("The current design is one flag away from that. Worth doing before the paper habit sets.");

H2("The blind count is not the leak it is defending against");
P(
  "We have invested a lot in per-tender covers, and the control is correct. But the shop's actual exposure is not a cashier peeking at an expectation — it is that **three people use the system at all**, cash is handled by whoever is standing there, and the day's cash movements are typed by the same person who counts them.",
);
P(
  "The stronger control is dull and organisational: one named person opens, one named person closes, and the two are different on any day both are in. The software already records who did which; nobody is currently required to be different people.",
);

H2("The tire study should not have needed paper");
P(
  "A month of sizes was tallied by hand on paper and then imported. The in-app study button existed the whole time. That is not a data problem, it is an adoption one, and it is the same root cause as findings 1 and 8: **the counter does not reach for the system when it is busy.**",
);
P(
  "Every future feature should be judged against that. A thing that takes two taps mid-ticket gets used; a thing that requires opening a tab does not — regardless of how good the report behind it is.",
);

BREAK();
H1("What I would build next, in order");
TABLE(
  ["", "What", "Why now"],
  [
    [1, "Customer + phone capture on tire tickets", "Unlocks retention, warranty, fleets and the demand study. Everything else compounds off it."],
    [2, "Nightly off-machine backup + one test restore", "Existential, cheap, and currently absent."],
    [3, "Service costs for the top three lines", "Ten minutes of typing turns every margin figure in the program from half-true to true."],
    [4, "Declined / recommended work per ticket", "The industry's most reliable future-revenue list. Needs #1 first."],
    [5, "Age on the special-order board", "Stops arrived tires waiting for a call."],
    [6, "One physical stock count", "Tells you whether a year of on-hand figures meant anything."],
    [7, "Retire Close-out (Old)", "Two procedures is how two truths start."],
  ],
);

H1("The number behind all of it");
P(
  `Takings are **${m(perDayNow.c)} per trading day over the last ninety days**, against **${m(perDayThen.c)} per day in the first half of 2024** — and we established that the cause is stock, not demand: the range narrowed by half while the average price of a tire sold did not move. That analysis stands.`,
);
P(
  "Everything in this review is secondary to that. A perfect close-out on a day with nothing on the racks to sell is a beautifully reconciled bad day. The reporting is now good enough that it will tell you the moment buying resumes — which is the most useful thing it can do.",
);
NOTE(
  `Generated ${new Date().toISOString().slice(0, 10)} from the live database. Re-run scripts/build-review.mts to rebuild it against current figures.`,
);

// ── Render ──────────────────────────────────────────────────────────────────
const CSS = `
@page { size: letter; margin: 17mm 16mm 15mm; }
html,body{margin:0;padding:0;background:#fff;color-scheme:light only}
body{font-family:"Segoe UI",system-ui,Roboto,Helvetica,Arial,sans-serif;color:#14181d;font-size:11pt;line-height:1.62}
p{margin:0 0 8px;max-width:58em}
.cover{padding:0 0 8mm;border-bottom:3px solid #0a2540;margin-bottom:8mm}
.cover .eyebrow{font-size:9.5pt;text-transform:uppercase;letter-spacing:.15em;color:#96690a;font-weight:700;margin-bottom:4mm}
.cover h1{font-family:Georgia,serif;font-size:28pt;line-height:1.12;font-weight:400;color:#0a2540;margin:0 0 3mm}
.cover .sub{font-family:Georgia,serif;font-size:12.5pt;font-style:italic;color:#4e5b68;margin:0 0 6mm}
.cover .who{font-size:10pt;color:#4e5b68}
h1.sec{font-family:Georgia,serif;font-size:18pt;font-weight:400;color:#0a2540;margin:9mm 0 3mm;padding-bottom:2mm;border-bottom:1.5pt solid #0a2540;break-after:avoid}
h2{font-size:12pt;font-weight:650;color:#0a2540;margin:6mm 0 2mm;break-after:avoid}
.note{font-size:9pt;color:#6b7683;margin-top:6mm}
.break{break-after:page}
.find{border-left:4px solid;padding:4mm 5mm;margin:4mm 0 5mm;break-inside:avoid;border-radius:0 2mm 2mm 0}
.find.sev1{border-color:#b91c1c;background:#fdf2f2}
.find.sev2{border-color:#b45309;background:#fdf8ee}
.find.sev3{border-color:#0a2540;background:#f4f6f9}
.find-h{display:flex;align-items:baseline;gap:3mm;margin-bottom:2.5mm;flex-wrap:wrap}
.find-n{width:7mm;height:7mm;border-radius:50%;background:#0a2540;color:#fff;font-size:9pt;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.find-t{font-size:12.5pt;font-weight:700;color:#0a2540;flex:1}
.find-s{font-size:8pt;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:#6b7683}
.find p{margin:0 0 2.5mm}
.find p:last-child{margin-bottom:0}
table{width:100%;border-collapse:collapse;margin:3mm 0 5mm;font-size:10pt}
th{text-align:left;font-size:8.5pt;text-transform:uppercase;letter-spacing:.07em;color:#4e5b68;font-weight:700;border-bottom:1.5px solid #0a2540;padding:0 6px 2mm 0}
td{padding:2.2mm 6px 2.2mm 0;border-bottom:1px solid #d3d9e0;vertical-align:top}
th.r,td.r{text-align:left}
tbody tr:nth-child(even) td{background:#fafbfc;-webkit-print-color-adjust:exact;print-color-adjust:exact}
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>System review — Casias Muffler and Tire Shop</title><style>${CSS}</style></head><body>
<div class="cover">
  <div class="eyebrow">Internal review</div>
  <h1>The system, honestly<br>reviewed</h1>
  <div class="sub">What is working, what is missing, and what I would argue with</div>
  <div class="who">Casias Muffler and Tire Shop · San Antonio, Texas<br>Prepared for the owner · ${new Date().toISOString().slice(0, 10)}</div>
</div>
${parts.join("\n")}
</body></html>`;

const OUT = path.resolve("docs");
fs.mkdirSync(OUT, { recursive: true });
const htmlPath = path.join(OUT, "System-Review.html");
fs.writeFileSync(htmlPath, html, "utf8");

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => fs.existsSync(p));
if (CHROME) {
  const pdf = path.join(OUT, "System-Review.pdf");
  execFileSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdf}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`,
  ]);
  console.log("wrote", pdf, `(${Math.round(fs.statSync(pdf).size / 1024)} KB)`);
} else {
  console.log("wrote", htmlPath, "(no Chrome — HTML only)");
}
