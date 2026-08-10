"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { formatCents } from "@/lib/money";
import type { AccountMonth } from "@/lib/credit-accounts";
import "./month.css";

/**
 * The month's house accounts, on one sheet.
 *
 * The customer book answers "what does this person owe". This answers the other
 * question, the one asked once a month by somebody sitting down with the books:
 * what is out there in total, what went out this month, and what came back.
 *
 * FOUR COLUMNS THAT RECONCILE — opening, charged, paid, closing — because the
 * fourth is checkable against the other three. A page that listed only today's
 * balances would be a list of numbers with nothing to test them against, and an
 * account page nobody can test is an account page nobody can trust. Every row
 * on this sheet adds up left to right, and the foot adds up down.
 *
 * Its own page rather than a panel, because it is read at a different time by a
 * different person for a different reason. The book is opened mid-afternoon
 * with somebody on the phone; this is opened on the first of the month with a
 * printer switched on.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "August 2026" — a month said the way somebody says it out loud. */
function monthWords(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? month} ${y}`;
}

/**
 * The last twelve months, newest first.
 *
 * A `<select>` rather than `<input type="month">`, which looks tidier and hides
 * its arrows behind a picker somebody has to open. Twelve options is the whole
 * useful range of this page and they fit in one glance; anything older than a
 * year is a question for the filed sheets, not for a screen.
 */
function recentMonths(from: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}-01T00:00:00Z`);
  for (let i = 0; i < 12; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

export default function AccountMonthPage() {
  const { can } = usePosAuth();
  const [month, setMonth] = useState("");
  // The shop name rides along with the figures — see the route — so the
  // letterhead can never print blank because a second request was still in
  // flight when somebody hit Print.
  const [data, setData] = useState<(AccountMonth & { shopName: string }) | null>(null);
  const [printedOn, setPrintedOn] = useState("");

  // The browser's own idea of the month, set after mount. The server has no
  // idea what day it is where the accountant is sitting, and rendering a date
  // during the server pass would mismatch on hydration.
  useEffect(() => {
    const now = new Date();
    setMonth(now.toISOString().slice(0, 7));
    setPrintedOn(now.toLocaleDateString());
  }, []);

  const load = useCallback(async () => {
    if (!month) return;
    const res = await fetch(`/api/pos/customers/account-month?month=${month}`);
    if (!res.ok) return;
    setData(await res.json());
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can("manageCreditAccounts"))
    return (
      <div className="text-brand-400">
        Your account can&apos;t see what customers owe on account.
      </div>
    );

  const t = data?.totals;
  /**
   * Does the month add up?
   *
   * Opening + charged − paid must equal closing, and it does by construction —
   * all four are sums over the same ledger. Checked anyway and said out loud
   * when it fails, because the day this stops being true is the day something
   * is wrong with the data underneath, and a page that quietly printed a wrong
   * total would be the last place anybody looked.
   */
  const reconciles =
    !t || t.openingCents + t.chargedCents - t.paidCents === t.closingCents;

  return (
    <div className="max-w-5xl mx-auto am">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 am-hide-on-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">
            Accounts for the month
          </h1>
          <p className="text-brand-400 text-sm">
            What was owed, what went on the tab, and what came in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Month"
          >
            {recentMonths(new Date().toISOString().slice(0, 7)).map((m) => (
              <option key={m} value={m}>
                {monthWords(m)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!data}
            onClick={() => window.print()}
          >
            Print
          </button>
          <Link href="/pos/customers" className="btn btn-outline">
            ← Customers
          </Link>
        </div>
      </div>

      {/* The letterhead, on paper only. A sheet filed with the month's
          paperwork has to say whose shop it came from and which month it is —
          the screen has both in the controls above, and the page has neither. */}
      <div className="am-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>{data?.shopName ?? ""}</div>
          <div style={{ fontSize: "9pt" }}>
            House accounts · {data ? monthWords(data.month) : ""} · printed {printedOn}
          </div>
        </div>
      </div>

      {!data ? (
        <div className="text-brand-300 py-10 text-center">Adding it up…</div>
      ) : data.rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-brand-300 am-block">
          Nobody had an account balance or put anything on a tab in{" "}
          {monthWords(data.month)}.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 am-block">
            <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
              What each account did
            </div>
            <table className="w-full text-sm am-table">
              <thead>
                <tr className="text-brand-300 text-xs uppercase tracking-wider">
                  <th className="text-left py-2 font-medium">Customer</th>
                  <th className="text-right py-2 font-medium pl-4">Owed at the 1st</th>
                  <th className="text-right py-2 font-medium pl-4">Went on</th>
                  <th className="text-right py-2 font-medium pl-4">Came in</th>
                  <th className="text-right py-2 font-medium pl-4">Owed at the end</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr
                    key={r.customerId}
                    className="border-t border-black/5"
                    style={i % 2 === 1 ? { background: "rgba(10,37,64,0.02)" } : undefined}
                  >
                    <td className="py-2">
                      {/* The star is the same one the book uses, and it means
                          the same thing: somebody approved this person for
                          credit. An account with no star is a tab nobody agreed
                          to, which is the single most useful thing this page can
                          say about a name. */}
                      {r.creditApproved === 1 && (
                        <span className="text-amber-500 mr-1" title="Approved for credit">
                          ★
                        </span>
                      )}
                      <span className="text-brand-500 font-medium">{r.name}</span>
                      <span className="text-brand-300 text-xs"> · {r.customerNo}</span>
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums text-brand-400">
                      {r.openingCents ? formatCents(r.openingCents) : "—"}
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums">
                      {r.chargedCents ? formatCents(r.chargedCents) : "—"}
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums text-green-700">
                      {r.paidCents ? formatCents(r.paidCents) : "—"}
                    </td>
                    <td
                      className={`py-2 pl-4 text-right tabular-nums font-semibold ${
                        r.closingCents > 0 ? "text-red-700" : "text-brand-400"
                      }`}
                    >
                      {formatCents(r.closingCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black/20 font-semibold">
                  <td className="py-2">
                    {data.rows.length} account{data.rows.length === 1 ? "" : "s"}
                  </td>
                  <td className="py-2 pl-4 text-right tabular-nums">
                    {formatCents(t!.openingCents)}
                  </td>
                  <td className="py-2 pl-4 text-right tabular-nums">
                    {formatCents(t!.chargedCents)}
                  </td>
                  <td className="py-2 pl-4 text-right tabular-nums text-green-700">
                    {formatCents(t!.paidCents)}
                  </td>
                  <td className="py-2 pl-4 text-right tabular-nums text-red-700">
                    {formatCents(t!.closingCents)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {!reconciles && (
              <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                <strong>These columns do not add up.</strong> Owed at the 1st plus
                what went on, less what came in, should equal what is owed at the
                end. It does not, which means something under this page is wrong
                — do not file this sheet until somebody has looked.
              </div>
            )}

            {/* The month in one sentence, for whoever reads the sheet standing
                up. The table above is the evidence; this is the finding. */}
            <p className="text-sm text-brand-400 mt-3 am-summary">
              {formatCents(t!.chargedCents)} went onto tabs in{" "}
              {monthWords(data.month)} and {formatCents(t!.paidCents)} came in
              against them, so what is owed{" "}
              {t!.closingCents > t!.openingCents
                ? `grew by ${formatCents(t!.closingCents - t!.openingCents)}`
                : t!.closingCents < t!.openingCents
                  ? `fell by ${formatCents(t!.openingCents - t!.closingCents)}`
                  : "finished where it started"}
              , at {formatCents(t!.closingCents)}.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 am-block">
            <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
              Every payment in {monthWords(data.month)}
            </div>
            {data.payments.length === 0 ? (
              <div className="text-sm text-brand-300">
                No money came in against an account this month.
              </div>
            ) : (
              <table className="w-full text-sm am-table">
                <tbody>
                  {data.payments.map((p, i) => (
                    <tr
                      key={p.id}
                      className="border-t border-black/5"
                      style={{
                        ...(i % 2 === 1 ? { background: "rgba(10,37,64,0.02)" } : {}),
                        // A payment that was undone, and the row that undid it.
                        // Both stay on the sheet: "why is this month's total
                        // lower than the receipts I have" is a question the
                        // paperwork has to be able to answer.
                        ...(p.reversedById || p.reversesId ? { opacity: 0.55 } : {}),
                      }}
                    >
                      <td className="py-1.5 whitespace-nowrap tabular-nums text-brand-300">
                        {p.paidAt.slice(0, 10)}
                      </td>
                      <td className="py-1.5 pl-4 text-brand-500">
                        {p.customerName}
                        <span className="text-brand-300 text-xs"> · {p.customerNo}</span>
                      </td>
                      <td className="py-1.5 pl-4 text-brand-400">
                        {[p.how, p.toAccount].filter(Boolean).join(" · ") || "—"}
                        <div className="text-xs text-brand-300">
                          {p.byName}
                          {p.note ? ` · ${p.note}` : ""}
                        </div>
                      </td>
                      <td className="py-1.5 pl-4 text-right tabular-nums whitespace-nowrap">
                        {formatCents(p.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-black/20 font-semibold">
                    <td className="py-2" colSpan={3}>
                      {data.payments.length} payment
                      {data.payments.length === 1 ? "" : "s"}
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums text-green-700">
                      {formatCents(t!.paidCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* The same caveat the stocked-tire sheet carries, and for the same
              reason: this page can only be as right as what was typed into it.
              A month that looks wrong is more often a payment nobody recorded
              than a customer who did not pay. */}
          <div className="am-note">
            Assuming every payment was recorded against the right account. A
            balance that looks wrong is usually money that came in and was never
            entered.
          </div>
        </>
      )}
    </div>
  );
}
