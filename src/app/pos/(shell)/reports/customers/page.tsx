"use client";

import Link from "next/link";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { RankedBars, Stat } from "@/components/pos/Charts";
import { formatCents } from "@/lib/money";
import {
  ExperimentalNote,
  Panel,
  RangeBar,
  ReportsNav,
  Section,
  useSuite,
} from "../shared";
import "../reports.css";

/**
 * Customers & Fleet: who comes back, who stopped, and the accounts with a
 * company name on them.
 *
 * THE HONESTY BANNER COMES FIRST because it bounds every figure on the page:
 * the register only began taking names in 2026, so the customer book is weeks
 * old sitting on top of years of anonymous history. The numbers are real and
 * they are the shop's own — there are just not many of them yet, and a page
 * that printed "repeat rate 41%" without saying "of seventy tickets" would be
 * lying with true figures. Every panel here grows more trustworthy by itself
 * as the counter keeps taking names.
 *
 * WINDOWED AND LIFETIME FIGURES ARE KEPT IN SEPARATE SECTIONS. "Who came in
 * this window" obeys the dates at the top; "who ever comes back" cannot — a
 * fortnight says nothing about return visits. The lifetime sections say they
 * ignore the window, in their own words, rather than quietly disagreeing
 * with the control above them.
 */
export default function CustomersReportPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const { data, error, win } = useSuite();

  if (!can("viewBusinessReports"))
    return (
      <div className="text-brand-400">{tr("Your account can't see the management reports.")}</div>
    );
  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">{tr("Adding it up…")}</div>;

  const r = data.retention;
  const f = data.fleet;
  const namedPct =
    data.customers.named + data.customers.anonymous > 0
      ? Math.round(
          (data.customers.named / (data.customers.named + data.customers.anonymous)) * 100,
        )
      : 0;

  return (
    <div className="max-w-6xl mx-auto rp">
      <ExperimentalNote />
      <RangeBar
        title={tr("Customers & Fleet")}
        blurb={tr("Who the shop sells to, who comes back, and the commercial accounts.")}
        data={data}
        win={win}
        printTitle={tr("Customer report")}
      />
      <ReportsNav win={win} />

      {/* Said before any figure is read, because it bounds all of them. */}
      <div className="rp-note rp-note-warn">
        <strong>{tr("The customer book is young.")}</strong>{" "}
        {tr("The register only started taking names on tickets in")}{" "}
        {r.firstNamedSale ? r.firstNamedSale.slice(0, 7) : "—"}
        {tr(" — in this window, ")}
        {namedPct}% {tr("of tickets carry one. Everything on this page describes only the tickets that took a name, and it gets more trustworthy every week the counter keeps asking.")}
      </div>

      {/* ── THIS WINDOW ─────────────────────────────────────────────────── */}
      <Section
        id="window"
        title={tr("In this window")}
        note={tr("New means the window holds their first ticket ever — a customer of three years who happens not to have been in since January is not a new customer.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Tickets with a name")}
            value={`${data.customers.named}`}
            sub={`${data.customers.anonymous} ${tr("without one")}`}
          />
          <Stat label={tr("New customers")} value={String(data.customers.newCustomers)} tone="good" />
          <Stat label={tr("Came back")} value={String(data.customers.returningCustomers)} />
          <Stat
            label={tr("Repeat share")}
            value={
              data.customers.newCustomers + data.customers.returningCustomers > 0
                ? `${Math.round(
                    (data.customers.returningCustomers /
                      (data.customers.newCustomers + data.customers.returningCustomers)) *
                      100,
                  )}%`
                : "—"
            }
            sub={tr("of named customers had been in before")}
          />
        </div>
        <Panel title={tr("Who spends the most")}>
          <RankedBars
            data={data.customers.top.map((c) => ({
              label: c.name,
              value: c.spentCents,
              note: ` · ${c.tickets} ${c.tickets === 1 ? tr("ticket") : tr("tickets")}`,
            }))}
            format={formatCents}
            emptyLabel={tr("No named customers in this window.")}
          />
        </Panel>
      </Section>

      {/* ── THE BOOK, WHOLE ─────────────────────────────────────────────── */}
      <Section
        id="book"
        title={tr("The book, whole")}
        note={tr("Lifetime figures, not windowed — whether somebody comes back is the one question a date range cannot answer.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Customers on file")}
            value={String(r.onFile)}
            sub={`${r.vehiclesOnFile} ${tr("vehicles on file")}`}
          />
          <Stat
            label={tr("Have bought something")}
            value={String(r.withVisit)}
            sub={`${r.avgVisits} ${tr("visits each, on average")}`}
          />
          <Stat
            label={tr("Came back at least once")}
            value={r.withVisit > 0 ? `${Math.round((r.repeat / r.withVisit) * 100)}%` : "—"}
            sub={`${r.repeat} ${tr("of")} ${r.withVisit}`}
            tone={r.withVisit > 0 && r.repeat / r.withVisit >= 0.4 ? "good" : undefined}
          />
          <Stat
            label={tr("Worth so far, each")}
            value={formatCents(r.avgLifetimeCents)}
            sub={tr("lifetime spend, averaged over the book")}
          />
        </div>

        <div className="rp-two">
          <Panel
            title={tr("How often they have been in")}
            note={tr("The shape to watch: a healthy book grows the right-hand bars.")}
          >
            <RankedBars
              data={[
                { label: tr("Once"), value: r.visitSpread.one },
                { label: tr("Twice"), value: r.visitSpread.two },
                { label: tr("3–5 times"), value: r.visitSpread.threeToFive },
                { label: tr("6 or more"), value: r.visitSpread.sixUp },
              ]}
              format={(n) => `${n}`}
              emptyLabel={tr("Nobody named yet.")}
            />
          </Panel>
          <Panel title={tr("Worth the most, lifetime")}>
            <RankedBars
              data={r.top.map((c) => ({
                label: c.name,
                value: c.lifetimeCents,
                note: ` · ${c.visits} ${c.visits === 1 ? tr("visit") : tr("visits")}${c.isFleet ? ` · ${tr("fleet")}` : ""}`,
              }))}
              format={formatCents}
              emptyLabel={tr("Nobody named yet.")}
            />
          </Panel>
        </div>

        <Panel
          title={tr("Worth a phone call")}
          note={tr("Came at least twice, then sixty days of silence. One visit and gone is a walk-in the shop never had; two visits is a habit that stopped, and a habit that stopped has a reason.")}
        >
          {r.lapsed.length === 0 ? (
            <div className="rp-empty">{tr("Nobody with a habit has gone quiet.")}</div>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("Customer")}</th>
                  <th>{tr("Phone")}</th>
                  <th className="r">{tr("Visits")}</th>
                  <th className="r">{tr("Spent, lifetime")}</th>
                  <th className="r">{tr("Last in")}</th>
                  <th className="r">{tr("Days quiet")}</th>
                </tr>
              </thead>
              <tbody>
                {r.lapsed.map((c) => (
                  <tr key={c.customerId}>
                    <td>{c.name}</td>
                    <td>{c.phone ?? "—"}</td>
                    <td className="r n">{c.visits}</td>
                    <td className="r n" style={{ fontWeight: 600 }}>
                      {formatCents(c.lifetimeCents)}
                    </td>
                    <td className="r n">{c.lastSeen}</td>
                    <td
                      className="r n"
                      style={{ color: c.daysSince > 180 ? "#b91c1c" : "#b45309", fontWeight: 600 }}
                    >
                      {c.daysSince}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div className="rp-no-print" style={{ marginTop: 4 }}>
          <Link
            className="btn btn-outline"
            style={{ height: 36, fontSize: 13, display: "inline-flex", alignItems: "center" }}
            href="/pos/customers"
          >
            {tr("Open the customer file")}
          </Link>
        </div>
      </Section>

      {/* ── FLEET & COMMERCIAL ──────────────────────────────────────────── */}
      <Section
        id="fleet"
        title={tr("Fleet & commercial")}
        note={tr("One row per account. Window and lifetime side by side on purpose — a fleet is a relationship, and quiet this month only means something next to what it has been worth so far.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Accounts")}
            value={String(f.accounts)}
            sub={`${f.creditApproved} ${tr("approved for credit")}`}
          />
          <Stat
            label={tr("This window")}
            value={formatCents(f.windowCents)}
            sub={`${f.windowTickets} ${f.windowTickets === 1 ? tr("ticket") : tr("tickets")}`}
          />
          <Stat
            label={tr("Owed by fleets")}
            value={formatCents(f.owedCents)}
            tone={f.owedCents > 0 ? "warn" : undefined}
            sub={tr("open ticket balances")}
          />
        </div>

        {f.rows.length === 0 ? (
          <div className="rp-empty">{tr("No fleet accounts on file yet.")}</div>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                <th>{tr("Account")}</th>
                <th className="r">{tr("Vehicles")}</th>
                <th className="r">{tr("This window")}</th>
                <th className="r">{tr("Tickets")}</th>
                <th className="r">{tr("Lifetime")}</th>
                <th className="r">{tr("Owed")}</th>
                <th className="r">{tr("Last in")}</th>
              </tr>
            </thead>
            <tbody>
              {f.rows.map((a) => (
                <tr key={a.customerId}>
                  <td>
                    {a.name}
                    {a.creditApproved ? (
                      <span className="rp-pill" style={{ marginLeft: 6 }}>
                        {tr("credit")}
                      </span>
                    ) : null}
                  </td>
                  <td className="r n">{a.vehicles || "—"}</td>
                  <td className="r n">{a.windowCents ? formatCents(a.windowCents) : "—"}</td>
                  <td className="r n">{a.windowTickets || "—"}</td>
                  <td className="r n" style={{ fontWeight: 600 }}>
                    {formatCents(a.lifetimeCents)}
                  </td>
                  <td
                    className="r n"
                    style={a.owedCents > 0 ? { color: "#b45309", fontWeight: 600 } : undefined}
                  >
                    {a.owedCents ? formatCents(a.owedCents) : "—"}
                  </td>
                  <td className="r n">{a.lastSeen ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="rp-no-print" style={{ marginTop: 12 }}>
          <Link
            className="btn btn-outline"
            style={{ height: 36, fontSize: 13, display: "inline-flex", alignItems: "center" }}
            href="/pos/fleets"
          >
            {tr("Open the fleet accounts")}
          </Link>
        </div>
      </Section>

      <p className="rp-foot">
        {tr("The window sections cover")} {data.from} → {data.to}
        {tr("; the book and fleet lifetime figures read the whole history on purpose, and every figure describes only tickets that took a name.")}
      </p>
    </div>
  );
}
