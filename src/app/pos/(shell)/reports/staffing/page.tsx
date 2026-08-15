"use client";

import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { PrintButton } from "@/components/pos/PrintButton";
import { translate, type Lang } from "@/lib/i18n";
import type { Staffing, SeasonalHours } from "@/lib/reports-bi";
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

/*
  THE SHOP'S OWN DAY, and it is the input every figure in Appendix B rests on.

  Open 8 to 7 with an hour for lunch: eleven hours on the premises, ten of them
  paid. Written here as one constant rather than typed into each sum, because if
  the shop changes its hours the wage table has to move with it or it becomes
  the most confidently wrong page in the report.
*/
const OPEN_HOUR = 8;
const CLOSE_HOUR = 19;
const LUNCH_HOURS = 1;
const PAID_HOURS_A_DAY = CLOSE_HOUR - OPEN_HOUR - LUNCH_HOURS;

/** Overtime starts after this many hours in a WEEK — see Appendix B. */
const OT_AFTER = 40;
const OT_MULTIPLIER = 1.5;

/**
 * The rates worth costing: the band the shop is choosing inside, and the two
 * big-box employers it is competing with for the same people.
 */
const WAGE_ROWS: { rate: number; label: string }[] = [
  { rate: 16, label: "" },
  { rate: 17, label: "" },
  { rate: 18, label: "" },
  { rate: 19, label: "" },
  { rate: 25.32, label: "Costco" },
  { rate: 26, label: "Walmart Auto Care" },
];

const usd = (n: number) =>
  `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  const [seasonal, setSeasonal] = useState<SeasonalHours | null>(null);
  /*
    THE LANGUAGE OF THE DOCUMENT, held here rather than taken from the app.

    The register's own toggle is a preference for whoever is standing at the
    counter, and it is remembered. This is a property of one printout: an owner
    who prints a Spanish copy for a technician has not asked for the till to
    change language, and taking the shared setting would mean the act of
    printing quietly reconfigured the shop.
  */
  const [docLang, setDocLang] = useState<Lang>("en");
  const t = (str: string) => translate(docLang, str);
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
    setSeasonal(d.seasonal ?? null);
    if (d.shopName) setShopName(d.shopName);
  }, []);

  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
    void load();
  }, [load]);

  if (error) return <div className="p-6 text-red-700">{error}</div>;
  if (!staffing) return <div className="p-6 text-brand-300">{t("Reading the weeks…")}</div>;

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
          <strong>{t("Staffing")}</strong> · {longDate(staffing.from)} to {longDate(staffing.to)}
        </div>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/*
            Which language the SHEET comes out in.

            Two buttons rather than a toggle, because a toggle has to be read to
            know which way it is set and this decides what somebody hands to a
            technician. It changes this document only — the register's own
            language is a preference for whoever is at the counter, and printing
            a Spanish copy is not a request to reconfigure the shop.
          */}
          <span className="dr-lang no-print">
            {(["en", "es"] as const).map((l) => (
              <button
                key={l}
                type="button"
                className={docLang === l ? "is-on" : undefined}
                onClick={() => setDocLang(l)}
              >
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </span>
          <PrintButton />
        </span>
      </div>

      <header className="dr-masthead">
        <div className="dr-mast-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="dr-logo" />
          <div>
            <div className="dr-shop">{shopName}</div>
            <div className="dr-doc">{t("Staffing — how many people the week needs")}</div>
          </div>
        </div>
        <div className="dr-mast-right">
          <div className="dr-mast-date">
            {longDate(staffing.from)} — {longDate(staffing.to)}
          </div>
          <dl className="dr-meta">
            <dt>{t("Covers")}</dt>
            <dd>
              {weeks} week{weeks === 1 ? "" : "s"} · {staffing.tickets.toLocaleString()} customers
            </dd>
            <dt>{t("Printed")}</dt>
            <dd>{printedAt}</dd>
            <dt>By</dt>
            <dd>{user?.name ?? "—"}</dd>
          </dl>
        </div>
      </header>

      {/* ══════════ THE ANSWER ══════════ */}
      <div className="dr-verdict">
        <div className="dr-verdict-tag">{t("The bottom line")}</div>
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

      {/*
        THE FLOOR, NOT THE DEMAND — and it says so before the first table
        rather than in a footnote after the last one. See the note in the
        scripted edit that added this: under-staffing hides itself, so this
        caveat has to be read before the numbers are, not after.
      */}
      <div className="dr-callout">
        <div className="dr-callout-head">
          {t("These are the customers the shop SERVED — not the ones who wanted serving")}
        </div>
        <p className="dr-callout-body">
          {t("Every figure here is counted off tickets, and a ticket only exists for somebody who waited. The customer who looked at the queue on a Saturday morning and drove to the shop down the road left no ticket and no trace, so they are not in any of these squares.")}
        </p>
        <p className="dr-callout-body">
          <strong>{t("That does not cut both ways.")}</strong> {t("The busier an hour is, the more people it turns away — so the busiest hours are the ones most understated, which is exactly where this report is being used to decide cover.")} <strong>{t("Read every number below as a floor.")}</strong> {t("The real demand at the peak is higher by however many people left, and nobody knows that figure.")}
        </p>
      </div>

      {/* ══════════ 1. WHEN ══════════ */}
      <section className="dr-sec">
        <h2 className="dr-h2">
          <span className="dr-h2-n">1</span>{t("Customers to expect, hour by hour")}
        </h2>
        <p className="dr-lead">
          {t("The average number of customers who walk in during each hour of each day, counted off every ticket the shop rang over this window. Darker is busier. This is the part of the report that is measured rather than assumed.")}
        </p>
        <table className="dr-heat">
          <thead>
            <tr>
              <th />
              {staffing.hours.map((h) => (
                <th key={h}>{hourLabel(h)}</th>
              ))}
              <th>{t("All day")}</th>
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
          {t("Averages, not totals — what to expect on a given day, not what happened across the whole window. The reddest square is the busiest hour of the week and everything else is shaded against it. Every square counts customers served; anybody who left rather than wait is in none of them.")}
        </p>
      </section>

      {/* ══════════ 2. HOW MANY ══════════ */}
      <section className="dr-sec">
        <h2 className="dr-h2">
          <span className="dr-h2-n">2</span>{t("How many technicians that takes")}
        </h2>
        <p className="dr-lead">
          {t("Customers per hour becomes people on the floor once you know how long a job takes. The shop knows that better than this report does, so the table gives the answer at four paces — read the line that matches what actually happens in the bay.")}
        </p>

        {/*
          FIRST, NOT LAST, and in red.

          It was the closing footnote under the table, which is where a reader
          arrives having already decided what the numbers mean. The warning is
          about how to READ the table, so it has to be read before it: every
          figure below counts the customers who stayed, and staffing exactly to
          them keeps the shop exactly as busy as it already is — turning away
          whoever it is already turning away, invisibly, for as long as the
          roster is set from this page.

          Red rather than amber. The other callouts on this report say "here is
          something the figures cannot tell you"; this one says "the figures
          will mislead you if you read them the obvious way", which is a
          different order of warning and the only one on the page that can cost
          the shop money by being skipped.
        */}
        <div className="dr-alert">
          <div className="dr-alert-head">{t("These are minimums, not targets")}</div>
          <p className="dr-alert-body">
            The customers counted are the ones who stayed. Staffing exactly to this table keeps the
            shop exactly as busy as it already is — and keeps turning away whoever it is already
            turning away, without that ever showing up in a figure.{" "}
            <strong>
              {t("Staffing one above it is how the shop finds out whether there is more work than it has been seeing.")}
            </strong>
          </p>
        </div>

        {!staffing.paceFromData && (
          <div className="dr-callout">
            <div className="dr-callout-head">{t("Why the shop is being asked instead of told")}</div>
            <p className="dr-callout-body">
              This could be worked out from the shop&apos;s own records — customers served divided
              by technician-hours clocked — but over this window the time clock recorded only{" "}
              <strong>{staffing.techHours.toFixed(1)} technician hours</strong> against{" "}
              {staffing.tickets.toLocaleString()} customers. That is not enough to divide by; one
              person&apos;s odd afternoon would set the pace for the whole shop.
            </p>
            <p className="dr-callout-body">
              <strong>{t("If the technicians clocked in and out, this page would answer it by itself")}</strong> — and it would keep answering it as the shop changes, without anybody
              having to estimate again.
            </p>
          </div>
        )}

        <table className="dr-table">
          <thead>
            <tr>
              <th>{t("If one technician handles")}</th>
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
          <strong>{t("This is cover for the BUSIEST hour of each day, rounded up.")}</strong> {t("Half a technician cannot fit a tire, and the cost of rounding down is a customer sitting in the lobby. Away from the peak the same days need fewer — the grid above shows exactly where, and the difference between the two is the case for a split shift rather than a second full one.")}
        </p>
      </section>

      {/* ══════════ 3. THE WEEK ══════════ */}
      <section className="dr-sec">
        <h2 className="dr-h2">
          <span className="dr-h2-n">3</span>{t("The week, busiest day first")}
        </h2>
        <p className="dr-lead">
          {t("The order to staff the week in. The gap between the top of this list and the bottom is the argument for moving somebody&apos;s day off.")}
        </p>
        <table className="dr-table">
          <thead>
            <tr>
              <th>Day</th>
              <th className="num">{t("Customers")}</th>
              <th className="num">{t("Busiest hour")}</th>
              <th className="num">{t("At its busiest")}</th>
              <th className="num">{t("Trading hours")}</th>
              <th className="dr-bullet-h">{t("Against the busiest day")}</th>
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

      {/* ══════════ APPENDIX A — THE SAME WEEKS, EVERY YEAR ══════════ */}
      {/*
        A DIFFERENT QUESTION FROM SECTION 1, and the reason it earns a page.

        Section 1 reads four weeks: how the shop is trading NOW, which is the
        right basis for next week's roster and no basis at all for anything
        seasonal. A late-July grid cannot tell you that late July is itself
        busy, because it has nothing to compare against. The same calendar
        weeks across every year on record can — and in a tire shop, where heat
        and holidays move the work, that is the difference between rostering
        for the season and rostering for last Tuesday.

        It shows what each year contributed rather than smoothing it away. This
        shop's older years were kept in a workbook rather than on this register
        and one of them holds twice the tickets of the next, which may be a
        busier year or may be a better-kept one. An average that hid that would
        be a confident figure resting on a difference in bookkeeping.
      */}
      {seasonal && seasonal.years.length > 0 && (
        <section className="dr-sec dr-break">
          <h2 className="dr-h2">
            <span className="dr-h2-n">A</span>{t("Appendix — this time of year, across every year on record")}
          </h2>
          <p className="dr-lead">
            The same calendar weeks — {seasonal.fromMD.replace("-", "/")} to{" "}
            {seasonal.toMD.replace("-", "/")} — in every year the shop has records for, as customers
            an hour. Section 1 says how the shop is trading now; this says what this part of the
            year usually asks for.
          </p>

          <table className="dr-table dr-compact">
            <thead>
              <tr>
                <th>{t("Year")}</th>
                <th className="num">{t("Days traded")}</th>
                <th className="num">{t("Customers")}</th>
                <th className="num">{t("A day")}</th>
              </tr>
            </thead>
            <tbody>
              {seasonal.years.map((y) => (
                <tr key={y.year}>
                  <td>{y.year}</td>
                  <td className="num">{y.days}</td>
                  <td className="num">{y.tickets.toLocaleString()}</td>
                  <td className="num">{(y.tickets / Math.max(1, y.days)).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t("All of it")}</td>
                <td className="num">{seasonal.dayCount.reduce((a, b) => a + b, 0)}</td>
                <td className="num">{seasonal.totalTickets.toLocaleString()}</td>
                <td className="num">
                  {(
                    seasonal.totalTickets /
                    Math.max(1, seasonal.dayCount.reduce((a, b) => a + b, 0))
                  ).toFixed(1)}
                </td>
              </tr>
            </tfoot>
          </table>

          <h3 className="dr-h3">{t("Customers an hour, averaged over every year")}</h3>
          <table className="dr-heat">
            <thead>
              <tr>
                <th />
                {seasonal.hours.map((h) => (
                  <th key={h}>{hourLabel(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_NAMES.map((name, wd) => (
                <tr key={wd}>
                  <th>{name.slice(0, 3)}</th>
                  {seasonal.hours.map((h) => {
                    const slot = seasonal.slots.find((x) => x.weekday === wd && x.hour === h);
                    const n = slot?.avgTickets ?? 0;
                    const share = slot?.share ?? 0;
                    return (
                      <td key={h} style={{ background: n < 0.05 ? "#f9fafb" : busyColor(share) }}>
                        <span style={{ color: n < 0.05 ? "#9ca3af" : busyInk(share) }}>
                          {n < 0.05 ? "" : n.toFixed(1)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="dr-foot">
            Averaged over the {seasonal.dayCount.reduce((a, b) => a + b, 0)} days the shop actually
            traded in this window across all those years — days it was shut are not counted against
            it as quiet days.
          </p>
          <p className="dr-foot">
            <strong>{t("Read this against section 1 rather than instead of it.")}</strong> {t("Where the two agree, the shape is the shop&apos;s and it is worth rostering to. Where they differ, something has changed — and which of the two is right depends on whether the change is the season or the business.")}
          </p>
        </section>
      )}

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
          <span className="dr-h2-n">B</span>{t("Appendix — what technicians are paid in San Antonio")}
        </h2>
        <p className="dr-lead">
          {t("What other shops in this town were paying, as of August 2026 — for setting wages against, and for costing the cover in section 2. This is the one page here that does not come from the shop&apos;s own books.")}
        </p>

        <table className="dr-table">
          <thead>
            <tr>
              <th>{t("Role, and who is reporting it")}</th>
              <th className="num">{t("Hourly")}</th>
              <th className="num">{t("A year, full time")}</th>
              <th>{t("What it covers")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>{t("Tire technician — San Antonio average")}</strong>
                <div className="dr-note">{t("ZipRecruiter, July 2026")}</div>
              </td>
              <td className="num dr-now">$16.00</td>
              <td className="num">$33,300</td>
              <td>
                {t("Most fall between")} <strong>$14.09</strong> and <strong>$17.36</strong>
              </td>
            </tr>
            <tr>
              <td>
                {t("Tire technician — Texas average")}
                <div className="dr-note">{t("ZipRecruiter, June 2026")}</div>
              </td>
              <td className="num">$16.53</td>
              <td className="num">$34,400</td>
              <td>{t("Slightly above the San Antonio figure")}</td>
            </tr>
            <tr>
              <td>
                {t("Discount Tire, San Antonio")}
                <div className="dr-note">{t("Indeed, reported by staff")}</div>
              </td>
              <td className="num">$15.64</td>
              <td className="num">$32,500</td>
              <td>{t("Their own postings run $15.00–$16.00")}</td>
            </tr>
            <tr>
              <td>
                {t("Walmart Auto Care, San Antonio")}
                <div className="dr-note">{t("ZipRecruiter and Glassdoor postings, 2026")}</div>
              </td>
              <td className="num">$26.00</td>
              <td className="num">$54,100</td>
              <td>
                {t("Advertised")} <strong>$22–$30</strong>, plus shift premiums of up to $3
              </td>
            </tr>
            <tr>
              <td>
                {t("Costco, San Antonio")}
                <div className="dr-note">{t("Indeed, reported by staff")}</div>
              </td>
              <td className="num">$25.32</td>
              <td className="num">$52,700</td>
              <td>{t("The other big-box shop, and about the same money")}</td>
            </tr>
            <tr>
              <td>
                <strong>{t("Automotive service technician — San Antonio")}</strong>
                <div className="dr-note">{t("Indeed, May 2026")}</div>
              </td>
              <td className="num">$26.67</td>
              <td className="num">$55,500</td>
              <td>{t("A qualified mechanic, not a tire fitter")}</td>
            </tr>
            <tr>
              <td>
                {t("Automotive technician — San Antonio")}
                <div className="dr-note">{t("Glassdoor, 2026")}</div>
              </td>
              <td className="num">$30.00</td>
              <td className="num">$62,600</td>
              <td>{t("Same role, second source, higher")}</td>
            </tr>
            <tr>
              <td>
                {t("Automotive service technicians — national median")}
                <div className="dr-note">{t("US Bureau of Labor Statistics, May 2024")}</div>
              </td>
              <td className="num">$23.88</td>
              <td className="num">$49,670</td>
              <td>{t("Across the whole country")}</td>
            </tr>
          </tbody>
        </table>

        <p className="dr-foot">
          <strong>{t("Two different jobs are on this table, and the gap between them is the point.")}</strong>{" "}
A tire technician at an independent shop in San Antonio is a $15–$17 hire. A qualified
          automotive technician is a $26–$30 one — close to double. Which of the two the shop is
          hiring for moves the wage bill far more than haggling over a dollar inside either band.
        </p>
        <p className="dr-foot">
          <strong>{t("The big-box shops sit with the mechanics, not with the tire fitters.")}</strong>{" "}
          Walmart and Costco both pay around $25–$26 for what is largely tire work. That is who a
          good fitter is being recruited away by, and it is roughly $9 an hour above the
          independent average — about $18,000 a year on one person.
        </p>
        <p className="dr-foot">
          <strong>{t("Costing the cover.")}</strong> {t("At the San Antonio tire-technician average of $16.00, one technician on the floor for a ten-hour day is about")} <strong>$160</strong> in wages
          before tax and overhead — roughly <strong>$1,120</strong> a week for one person across
          seven days. Read that against section 2: the peak needs more people than the lulls do, and
          the grid in section 1 is where the case for a short shift over a long one is made.
        </p>
        <p className="dr-foot">
          {t("Gathered August 2026 from ZipRecruiter, Indeed, Glassdoor and the US Bureau of Labor Statistics. Advertised and self-reported pay both run ahead of and behind what is really paid, so read these as the shape of the market rather than as quotes — and check them again before any hiring decision, because the market moves and this page does not.")}
        </p>
      </section>

      {/* ══════════ APPENDIX B — WHAT A DAY COSTS ══════════ */}
      {/*
        THE CORRECTION THIS PAGE EXISTS TO MAKE.

        The shop's assumption going in was that a 10-hour day earns overtime by
        being long. In Texas it does not: there is no state overtime law and the
        federal rule counts WEEKS, not days — nothing is owed until the week
        passes forty hours, however the hours are stacked inside it.

        That correction cuts both ways and both halves are worth printing. A
        five-day week of these shifts is 50 hours and already carries 10 hours
        of overtime; a six-day week is 60 and carries 20. So the shop probably
        owes MORE than it thinks rather than less — just on a different trigger
        than the one it had in mind.
      */}
      <section className="dr-sec dr-break">
        <h2 className="dr-h2">
          <span className="dr-h2-n">C</span>{t("Appendix — what a day costs, and when overtime starts")}
        </h2>
        <p className="dr-lead">
          The shop is open {hourLong(OPEN_HOUR)} to {hourLong(CLOSE_HOUR)}, which is{" "}
          {CLOSE_HOUR - OPEN_HOUR} hours on the premises and{" "}
          <strong>{PAID_HOURS_A_DAY} paid hours</strong> once an hour of lunch comes out. Every
          figure below is built on that day.
        </p>

        <div className="dr-callout">
          <div className="dr-callout-head">
            {t("A long day is not overtime in Texas — a long WEEK is")}
          </div>
          <p className="dr-callout-body">
            {t("Texas has no overtime law of its own and follows the federal rule, which counts hours by the week rather than by the day.")} <strong>Nothing is owed for working {PAID_HOURS_A_DAY}{" "}
            hours in a day.</strong> Overtime starts once somebody passes{" "}
            <strong>{OT_AFTER} hours in a week</strong>, and from there every extra hour is paid at{" "}
            <strong>one and a half times</strong> their normal rate. California has a daily rule;
            Texas does not.
          </p>
          <p className="dr-callout-body">
            <strong>{t("That is worse for the shop, not better.")}</strong> Five of these shifts is{" "}
            {PAID_HOURS_A_DAY * 5} hours, which is already {PAID_HOURS_A_DAY * 5 - OT_AFTER} hours
            of overtime. Six is {PAID_HOURS_A_DAY * 6}, which is{" "}
            {PAID_HOURS_A_DAY * 6 - OT_AFTER}. Weeks cannot be averaged against each other either —
            a heavy week followed by a light one still owes the overtime from the heavy one.
          </p>
        </div>

        <h3 className="dr-h3">One {PAID_HOURS_A_DAY}-hour day</h3>
        <table className="dr-table">
          <thead>
            <tr>
              <th>{t("Pay rate")}</th>
              <th className="num">{t("Straight time")}</th>
              {/*
                The heading says WHEN, because the rate on its own invites the
                wrong reading. Forty hours is exactly four of these shifts, so
                the fifth day a technician works is the first one paid at time
                and a half — start to finish, not just its last hours. Computed
                from the shift length rather than written as "four", so it stays
                true if the shop's hours change.
              */}
              <th className="num">
                {t("At the overtime rate")}
                <div className="dr-note" style={{ fontWeight: 400 }}>
                  from day {Math.floor(OT_AFTER / PAID_HOURS_A_DAY) + 1} of the week, on{" "}
                  {PAID_HOURS_A_DAY}-hour days
                </div>
              </th>
              <th className="num">{t("The difference")}</th>
            </tr>
          </thead>
          <tbody>
            {WAGE_ROWS.map((w) => {
              const straight = w.rate * PAID_HOURS_A_DAY;
              const over = w.rate * OT_MULTIPLIER * PAID_HOURS_A_DAY;
              return (
                <tr key={w.rate}>
                  <td>
                    <strong>{usd(w.rate)} an hour</strong>
                    {w.label && <div className="dr-note">{w.label}</div>}
                  </td>
                  <td className="num dr-now">{usd(straight)}</td>
                  <td className="num">{usd(over)}</td>
                  <td className="num">+{usd(over - straight)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="dr-foot">
          The middle column is what the day costs once that person is already past {OT_AFTER} hours
          for the week — the last days of a busy week, not the first. A day early in the week costs
          the straight-time column.
        </p>

        <h3 className="dr-h3">{t("A whole week of them")}</h3>
        <table className="dr-table">
          <thead>
            <tr>
              <th>{t("Pay rate")}</th>
              <th className="num">5 days · {PAID_HOURS_A_DAY * 5} hrs</th>
              <th className="num">of which overtime</th>
              <th className="num">6 days · {PAID_HOURS_A_DAY * 6} hrs</th>
              <th className="num">of which overtime</th>
            </tr>
          </thead>
          <tbody>
            {WAGE_ROWS.map((w) => {
              const week = (days: number) => {
                const hours = PAID_HOURS_A_DAY * days;
                const otHours = Math.max(0, hours - OT_AFTER);
                const base = Math.min(hours, OT_AFTER) * w.rate;
                const extra = otHours * w.rate * OT_MULTIPLIER;
                return { total: base + extra, otHours, extra };
              };
              const five = week(5);
              const six = week(6);
              return (
                <tr key={w.rate}>
                  <td>
                    <strong>{usd(w.rate)} an hour</strong>
                    {w.label && <div className="dr-note">{w.label}</div>}
                  </td>
                  <td className="num dr-now">{usd(five.total)}</td>
                  <td className="num">
                    {five.otHours} hrs
                    <div className="dr-note">{usd(five.extra)}</div>
                  </td>
                  <td className="num dr-now">{usd(six.total)}</td>
                  <td className="num">
                    {six.otHours} hrs
                    <div className="dr-note">{usd(six.extra)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="dr-foot">
          <strong>{t("Read the two overtime columns before anything else.")}</strong> On a six-day roster
          a third of the week is paid at time and a half, so a $16 technician costs{" "}
          {usd(WAGE_ROWS[0].rate * OT_AFTER + (PAID_HOURS_A_DAY * 6 - OT_AFTER) * WAGE_ROWS[0].rate * OT_MULTIPLIER)}{" "}
          a week rather than the {usd(WAGE_ROWS[0].rate * PAID_HOURS_A_DAY * 6)} a straight
          multiplication suggests. Two people on shorter weeks can cost less than one person on a
          long one, which is the case the staffing grid in section 1 is really making.
        </p>
        <p className="dr-foot">
          <strong>{t("This is a rate calculation, not legal advice.")}</strong> {t("It assumes an hourly, non-exempt employee on a standard workweek and ignores everything else that lands on a wage — payroll taxes, insurance, breaks, and any agreement with the employee themselves. Have an accountant confirm it before it is used to set anybody&apos;s pay. Rule checked August 2026 against the Texas Workforce Commission&apos;s position and the federal Fair Labor Standards Act.")}
        </p>
      </section>

      <footer className="dr-colophon">
        {shopName} · staffing over {longDate(staffing.from)} to {longDate(staffing.to)} · printed{" "}
        {printedAt} by {user?.name ?? "—"}
      </footer>
    </div>
  );
}
