"use client";

import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { PrintButton } from "@/components/pos/PrintButton";
import type { Staffing } from "@/lib/reports-bi";
import "../../drawer/report/report.css";

/**
 * THE STAFFING REPORT, ON ITS OWN.
 *
 * It began as a section of the daily close-out and did not belong there. The
 * day report answers "what happened today" and is read at nine at night by
 * somebody who wants to go home; this answers "how should the week be
 * rostered", which is a question asked once a quarter, sitting down, probably
 * with somebody else in the room. Two different documents, two different
 * moments, and stapling them together made the nightly one longer for no gain.
 *
 * WHAT IT KNOWS AND WHAT IT REFUSES TO GUESS. The shape of the week is counted
 * off every ticket the shop rang — that part is solid. Turning it into a number
 * of PEOPLE needs a pace, how many customers one technician gets through in an
 * hour, and the tickets do not contain that. The honest source is the shop's
 * own clock: customers served divided by technician-hours worked. Where those
 * hours exist this uses them. Where they do not, it says so on the page and
 * hands over the arithmetic at four rates rather than substituting a figure
 * from somebody else's shop — a confident grid built on that is worse than no
 * grid, because it looks like it came from the books.
 *
 * The pay appendix is the only page here not made from the shop's own records,
 * which is exactly why it is an appendix, printed with its date and its sources
 * on it.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
const hourLong = (h: number) =>
  h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;

/**
 * The same blue-to-red scale the day report's charts use, so a busy hour is the
 * same colour wherever somebody meets one.
 */
function busyColor(share: number): string {
  const stops: [number, string][] = [
    [0, "#dbeafe"],
    [0.25, "#60a5fa"],
    [0.45, "#34d399"],
    [0.65, "#facc15"],
    [0.82, "#fb923c"],
    [1, "#dc2626"],
  ];
  const t = Math.max(0, Math.min(1, share));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0 || 1);
      const hex = (c: string) => [1, 3, 5].map((j) => parseInt(c.slice(j, j + 2), 16));
      const a = hex(c0);
      const b = hex(c1);
      const mix = a.map((v, j) => Math.round(v + (b[j] - v) * k));
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    }
  }
  return stops[stops.length - 1][1];
}
const busyInk = (share: number) => (share > 0.55 ? "#fff" : "#111827");

export default function StaffingReportPage() {
  const { user } = usePosAuth();
  const [staffing, setStaffing] = useState<Staffing | null>(null);
  const [shopName, setShopName] = useState("Casias Muffler and Tire Shop");
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState("");

  const load = useCallback(async () => {
    const sp = new URLSearchParams(window.location.search);
    const q = new URLSearchParams();
    if (sp.get("from")) q.set("from", sp.get("from")!);
    if (sp.get("to")) q.set("to", sp.get("to")!);
    const res = await fetch(`/api/pos/reports/business?${q}`);
    if (!res.ok) {
      setError("Could not load the figures");
      return;
    }
    const d = await res.json();
    setStaffing(d.staffing ?? null);
    if (d.shopName) setShopName(d.shopName);
  }, []);

  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
    void load();
  }, [load]);

  if (error) return <div className="p-6 text-red-700">{error}</div>;
  if (!staffing) return <div className="p-6 text-brand-300">Reading the weeks…</div>;

  const weeks = Math.max(
    1,
    Math.round(
      (Date.parse(`${staffing.to}T00:00:00Z`) - Date.parse(`${staffing.from}T00:00:00Z`)) /
        (7 * 86_400_000),
    ),
  );
  const busiestDay = [...staffing.days].sort((a, b) => b.tickets - a.tickets)[0];
  const quietestDay = [...staffing.days]
    .filter((d) => d.tickets > 0)
    .sort((a, b) => a.tickets - b.tickets)[0];

  return (
    <div className="dr">
      <div className="dr-bar no-print">
        <div>
          <strong>Staffing</strong> · {longDate(staffing.from)} to {longDate(staffing.to)}
        </div>
        <PrintButton />
      </div>

      <header className="dr-masthead">
        <div className="dr-mast-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="dr-logo" />
          <div>
            <div className="dr-shop">{shopName}</div>
            <div className="dr-doc">Staffing — how many people the week needs</div>
          </div>
        </div>
        <div className="dr-mast-right">
          <div className="dr-mast-date">
            {longDate(staffing.from)} — {longDate(staffing.to)}
          </div>
          <dl className="dr-meta">
            <dt>Covers</dt>
            <dd>
              {weeks} week{weeks === 1 ? "" : "s"} · {staffing.tickets.toLocaleString()} customers
            </dd>
            <dt>Printed</dt>
            <dd>{printedAt}</dd>
            <dt>By</dt>
            <dd>{user?.name ?? "—"}</dd>
          </dl>
        </div>
      </header>

      {/* ══════════ THE ANSWER ══════════ */}
      <div className="dr-verdict">
        <div className="dr-verdict-tag">The bottom line</div>
        <div className="dr-verdict-head">
          {busiestDay && quietestDay
            ? `${DAY_NAMES[busiestDay.weekday]} carries ${Math.round(
                (busiestDay.tickets / Math.max(1, quietestDay.tickets)) * 10,
              ) / 10}× the customers of ${DAY_NAMES[quietestDay.weekday]}`
            : "The week's work is spread evenly"}
        </div>
        <div className="dr-verdict-body">
          The shop serves about {Math.round(staffing.tickets / weeks)} customers a week, and they do
          not arrive evenly. This report says where they actually land, so people can be rostered
          against the load rather than against the calendar.
        </div>
      </div>

      {/* ══════════ 1. WHEN ══════════ */}
      <section className="dr-sec">
        <h2 className="dr-h2">
          <span className="dr-h2-n">1</span>Customers to expect, hour by hour
        </h2>
        <p className="dr-lead">
          The average number of customers who walk in during each hour of each day, counted off
          every ticket the shop rang over this window. Darker is busier. This is the part of the
          report that is measured rather than assumed.
        </p>
        <table className="dr-heat">
          <thead>
            <tr>
              <th />
              {staffing.hours.map((h) => (
                <th key={h}>{hourLabel(h)}</th>
              ))}
              <th>All day</th>
            </tr>
          </thead>
          <tbody>
            {DAY_NAMES.map((name, wd) => {
              const d = staffing.days.find((x) => x.weekday === wd);
              return (
                <tr key={wd}>
                  <th>{name.slice(0, 3)}</th>
                  {staffing.hours.map((h) => {
                    const slot = staffing.slots.find((x) => x.weekday === wd && x.hour === h);
                    const n = slot?.avgTickets ?? 0;
                    const share = slot?.share ?? 0;
                    return (
                      <td
                        key={h}
                        style={{ background: n < 0.05 ? "#f9fafb" : busyColor(share) }}
                      >
                        <span style={{ color: n < 0.05 ? "#9ca3af" : busyInk(share) }}>
                          {n < 0.05 ? "" : n.toFixed(1)}
                        </span>
                      </td>
                    );
                  })}
                  <td style={{ fontWeight: 700 }}>{d ? Math.round(d.tickets) : 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="dr-foot">
          Averages, not totals — what to expect on a given day, not what happened across the whole
          window. The reddest square is the busiest hour of the week and everything else is shaded
          against it.
        </p>
      </section>

      {/* ══════════ 2. HOW MANY ══════════ */}
      <section className="dr-sec">
        <h2 className="dr-h2">
          <span className="dr-h2-n">2</span>How many technicians that takes
        </h2>
        <p className="dr-lead">
          Customers per hour becomes people on the floor once you know how long a job takes. The
          shop knows that better than this report does, so the table gives the answer at four
          paces — read the line that matches what actually happens in the bay.
        </p>

        {!staffing.paceFromData && (
          <div className="dr-callout">
            <div className="dr-callout-head">Why the shop is being asked instead of told</div>
            <p className="dr-callout-body">
              This could be worked out from the shop&apos;s own records — customers served divided
              by technician-hours clocked — but over this window the time clock recorded only{" "}
              <strong>{staffing.techHours.toFixed(1)} technician hours</strong> against{" "}
              {staffing.tickets.toLocaleString()} customers. That is not enough to divide by; one
              person&apos;s odd afternoon would set the pace for the whole shop.
            </p>
            <p className="dr-callout-body">
              <strong>If the technicians clocked in and out, this page would answer it by
              itself</strong> — and it would keep answering it as the shop changes, without anybody
              having to estimate again.
            </p>
          </div>
        )}

        <table className="dr-table">
          <thead>
            <tr>
              <th>If one technician handles</th>
              {DAY_NAMES.map((d) => (
                <th key={d} className="num">
                  {d.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staffing.atPace.map((row) => (
              <tr key={row.perHour}>
                <td>
                  <strong>{row.perHour} customers an hour</strong>
                  <div className="dr-note">{row.label}</div>
                </td>
                {row.peak.map((c) => (
                  <td key={c.weekday} className="num" style={{ fontWeight: 700 }}>
                    {c.techs || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dr-foot">
          <strong>This is cover for the BUSIEST hour of each day, rounded up.</strong> Half a
          technician cannot fit a tire, and the cost of rounding down is a customer sitting in the
          lobby. Away from the peak the same days need fewer — the grid above shows exactly where,
          and the difference between the two is the case for a split shift rather than a second
          full one.
        </p>
      </section>

      {/* ══════════ 3. THE WEEK ══════════ */}
      <section className="dr-sec">
        <h2 className="dr-h2">
          <span className="dr-h2-n">3</span>The week, busiest day first
        </h2>
        <p className="dr-lead">
          The order to staff the week in. The gap between the top of this list and the bottom is
          the argument for moving somebody&apos;s day off.
        </p>
        <table className="dr-table">
          <thead>
            <tr>
              <th>Day</th>
              <th className="num">Customers</th>
              <th className="num">Busiest hour</th>
              <th className="num">At its busiest</th>
              <th className="num">Trading hours</th>
              <th className="dr-bullet-h">Against the busiest day</th>
            </tr>
          </thead>
          <tbody>
            {[...staffing.days]
              .sort((a, b) => b.tickets - a.tickets)
              .map((d) => (
                <tr key={d.weekday}>
                  <td>{DAY_NAMES[d.weekday]}</td>
                  <td className="num dr-now">{Math.round(d.tickets)}</td>
                  <td className="num">{hourLong(d.peakHour)}</td>
                  <td className="num">{d.peakTickets.toFixed(1)}</td>
                  <td className="num">{d.openHours}</td>
                  <td className="dr-bullet-h">
                    <div className="dr-bullet">
                      <div
                        className="dr-bullet-bar"
                        style={{
                          width: `${(d.tickets / Math.max(1, busiestDay?.tickets ?? 1)) * 100}%`,
                          background: busyColor(
                            d.tickets / Math.max(1, busiestDay?.tickets ?? 1),
                          ),
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      {/* ══════════ APPENDIX ══════════ */}
      {/*
        THE ONLY PAGE HERE NOT MADE FROM THE SHOP'S OWN RECORDS, and fenced off
        as an appendix for that reason. Everything above can be traced to a
        ticket; this cannot. It is what other employers in San Antonio were
        advertising and reporting in August 2026, and it will drift — so it is
        printed with its date and its sources on the page, where somebody
        reading it in two years will see them.
      */}
      <section className="dr-sec dr-break">
        <h2 className="dr-h2">
          <span className="dr-h2-n">A</span>Appendix — what technicians are paid in San Antonio
        </h2>
        <p className="dr-lead">
          What other shops in this town were paying, as of August 2026 — for setting wages against,
          and for costing the cover in section 2. This is the one page here that does not come from
          the shop&apos;s own books.
        </p>

        <table className="dr-table">
          <thead>
            <tr>
              <th>Role, and who is reporting it</th>
              <th className="num">Hourly</th>
              <th className="num">A year, full time</th>
              <th>What it covers</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Tire technician — San Antonio average</strong>
                <div className="dr-note">ZipRecruiter, July 2026</div>
              </td>
              <td className="num dr-now">$16.00</td>
              <td className="num">$33,300</td>
              <td>
                Most fall between <strong>$14.09</strong> and <strong>$17.36</strong>
              </td>
            </tr>
            <tr>
              <td>
                Tire technician — Texas average
                <div className="dr-note">ZipRecruiter, June 2026</div>
              </td>
              <td className="num">$16.53</td>
              <td className="num">$34,400</td>
              <td>Slightly above the San Antonio figure</td>
            </tr>
            <tr>
              <td>
                Discount Tire, San Antonio
                <div className="dr-note">Indeed, reported by staff</div>
              </td>
              <td className="num">$15.64</td>
              <td className="num">$32,500</td>
              <td>Their own postings run $15.00–$16.00</td>
            </tr>
            <tr>
              <td>
                Costco, San Antonio
                <div className="dr-note">Indeed, reported by staff</div>
              </td>
              <td className="num">$25.32</td>
              <td className="num">$52,700</td>
              <td>The top of the tire-fitting market here</td>
            </tr>
            <tr>
              <td>
                <strong>Automotive service technician — San Antonio</strong>
                <div className="dr-note">Indeed, May 2026</div>
              </td>
              <td className="num">$26.67</td>
              <td className="num">$55,500</td>
              <td>A qualified mechanic, not a tire fitter</td>
            </tr>
            <tr>
              <td>
                Automotive technician — San Antonio
                <div className="dr-note">Glassdoor, 2026</div>
              </td>
              <td className="num">$30.00</td>
              <td className="num">$62,600</td>
              <td>Same role, second source, higher</td>
            </tr>
            <tr>
              <td>
                Automotive service technicians — national median
                <div className="dr-note">US Bureau of Labor Statistics, May 2024</div>
              </td>
              <td className="num">$23.88</td>
              <td className="num">$49,670</td>
              <td>Across the whole country</td>
            </tr>
          </tbody>
        </table>

        <p className="dr-foot">
          <strong>Two different jobs are on this table, and the gap between them is the point.</strong>{" "}
          A tire technician in San Antonio is a $15–$17 hire. A qualified automotive technician is a
          $26–$30 one — close to double. Which of the two the shop is hiring for moves the wage bill
          far more than haggling over a dollar inside either band.
        </p>
        <p className="dr-foot">
          <strong>Costing the cover.</strong> At the San Antonio tire-technician average of $16.00,
          one technician on the floor for a ten-hour day is about <strong>$160</strong> in wages
          before tax and overhead — roughly <strong>$1,120</strong> a week for one person across
          seven days. Read that against section 2: the peak needs more people than the lulls do, and
          the grid in section 1 is where the case for a short shift over a long one is made.
        </p>
        <p className="dr-foot">
          Gathered August 2026 from ZipRecruiter, Indeed, Glassdoor and the US Bureau of Labor
          Statistics. Advertised and self-reported pay both run ahead of and behind what is really
          paid, so read these as the shape of the market rather than as quotes — and check them
          again before any hiring decision, because the market moves and this page does not.
        </p>
      </section>

      <footer className="dr-colophon">
        {shopName} · staffing over {longDate(staffing.from)} to {longDate(staffing.to)} · printed{" "}
        {printedAt} by {user?.name ?? "—"}
      </footer>
    </div>
  );
}
