"use client";

import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { RankedBars, Stat } from "@/components/pos/Charts";
import { formatCents, parseCents } from "@/lib/money";
import type { CloseoutV2 } from "@/lib/day-report";
import "../reports/reports.css";
import "./closeout3.css";

/**
 * Close-out V3 — the close-out everyone will eventually use.
 *
 * Owner-only while it is being shaped (see the nav gate); the destination is
 * the whole floor, so every control here is built for a tired cashier at nine
 * at night, not for the owner reading at leisure:
 *
 *   ONE COLUMN, THREE NUMBERED STEPS, ONE LIT BUTTON. Skimming is the enemy —
 *   this page fights it by never offering two things to do at once. Count,
 *   log, print. Everything else on screen is reading, visibly secondary.
 *
 *   BLIND, PER TENDER. The expectation for cash and the card batch each stay
 *   covered until THEIR OWN count is logged — the same rule the old close-out
 *   learned the hard way. The owner is exempt (`skipBlindCount`), because the
 *   owner is who the control reports to, not who it controls.
 *
 *   THE PRINT IS THE PRODUCT. Page one carries only what gets filed and
 *   signed: the register verdict, the reconciliation table, the tips line,
 *   two signatures. Everything else — and by print time it can be everything,
 *   because the reconciliation is already logged and whatever happened has
 *   happened — follows on the pages behind it. Print is refused until the
 *   register is logged, which is what makes page one worth signing.
 *
 * WHEN THIS OPENS TO THE FLOOR, two things must change first, and they are
 * marked below: the margin block leaves the printout (costs are the owner's
 * book), and the data route needs a floor-safe gate instead of
 * `viewBusinessReports`.
 */

type Data = CloseoutV2 & { today: string };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Which side of a difference can be wrong — the shop's own convention, copied
 * from the original close-out where it is documented at length: on a drawer
 * the money is the suspect (minus = cash not there); on a terminal the batch
 * is ground truth, so the sign flips and a plus reads as "the register logged
 * a payment that never happened".
 */
const shownVariance = (varianceCents: number, isCard: number) =>
  isCard ? -varianceCents : varianceCents;
const varianceWords = (cents: number) =>
  cents === 0 ? formatCents(0) : `${cents > 0 ? "+" : "−"}${formatCents(Math.abs(cents))}`;

export default function CloseoutV3Page() {
  const { can, user } = usePosAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printedOn, setPrintedOn] = useState("");
  /** Typed counts, by tender code. Only cash and cc take one. */
  const [counts, setCounts] = useState<{ cash: string; cc: string }>({ cash: "", cc: "" });
  /** Codes whose count has been logged this sequence — the per-tender covers. */
  const [logged, setLogged] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => setPrintedOn(new Date().toLocaleString()), []);

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/reports/closeout");
    if (!res.ok) {
      setError("Could not load the day");
      return;
    }
    setData(await res.json());
    setError(null);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // The nav already gates this; the render gate is for the URL typed by hand.
  if (!can("manageSettings"))
    return <div className="text-brand-400">Close-out V3 is still being built — owner only for now.</div>;
  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">Adding it up…</div>;

  const weekday = DAY_NAMES[new Date(`${data.businessDate}T12:00:00`).getDay()];
  const liveChecks = data.drawer.checks.filter((c) => !c.deleted);
  /** The verdict is read off the LAST live log — the one the paper certifies. */
  const finalCheck = liveChecks.at(-1) ?? null;
  const countable = data.tenders.filter((t) => t.code === "cash" || t.code === "cc");
  const blind = !can("skipBlindCount");
  const show = (code: string) => !blind || logged.has(code);

  const registerLogged = liveChecks.length > 0;
  const outBy = finalCheck
    ? finalCheck.lines.reduce(
        (n, l) => n + Math.abs(shownVariance(l.varianceCents, l.isCard)),
        0,
      )
    : 0;
  const cashLine = finalCheck?.lines.find((l) => l.isCard === 0) ?? null;
  const shortByExactlyTips =
    !!cashLine && data.totals.tipCents > 0 && cashLine.varianceCents === -data.totals.tipCents;

  async function logRegister() {
    if (busy) return;
    const payload = countable
      .map((t) => ({
        methodId: t.methodId,
        countedCents: parseCents(counts[t.code as "cash" | "cc"] ?? "") ?? -1,
      }))
      .filter((c) => c.countedCents >= 0);
    if (payload.length === 0) {
      setError("Type what is in the drawer and on the terminal first");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pos/register-checks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counts: payload }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not log the register");
      return;
    }
    setError(null);
    setLogged(
      new Set(
        countable
          .filter((t) => payload.some((p) => p.methodId === t.methodId))
          .map((t) => t.code),
      ),
    );
    await load();
  }

  return (
    <div className="max-w-4xl mx-auto rp cv3">
      {/* ═══ SCREEN: the procedure ═══════════════════════════════════════ */}
      <div className="cv3-screen">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-brand-500">
            Close the day · {weekday} {data.businessDate}
          </h1>
          <p className="text-brand-400 text-sm">
            Three steps, top to bottom. The printout is refused until the register is logged.
          </p>
        </div>

        {/* ── Step 1 · Count ─────────────────────────────────────────────── */}
        <div className="cv3-step">
          <div className="cv3-step-head">
            <span className="cv3-step-no">1</span>
            <span className="cv3-step-title">Count the drawer and the terminal</span>
          </div>
          <p className="text-sm text-brand-400 mb-2">
            Count the cash in hand. Settle and read the batch total off the card terminal.
            {blind && " What the register expects stays covered until you log your count — that is the point of counting."}
          </p>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Tender</th>
                <th className="r">Expected</th>
                <th className="r">Counted</th>
                <th className="r">Difference</th>
              </tr>
            </thead>
            <tbody>
              {countable.map((t) => {
                const typed = parseCents(counts[t.code as "cash" | "cc"] ?? "");
                const variance = typed === null ? null : typed - t.expectedCents;
                return (
                  <tr key={t.methodId}>
                    <td>
                      {t.label}
                      <span className="text-xs text-brand-300 ml-2">
                        {t.count} payment{t.count === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="r n">
                      {show(t.code) ? (
                        formatCents(t.expectedCents)
                      ) : (
                        <span className="text-brand-300">– – –</span>
                      )}
                    </td>
                    <td className="r">
                      <input
                        className="input text-right tabular-nums w-28"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={counts[t.code as "cash" | "cc"] ?? ""}
                        onChange={(e) => {
                          // Any change to a count re-covers and restarts the
                          // sequence — a second attempt is still a count.
                          setLogged(new Set());
                          setCounts((c) => ({ ...c, [t.code]: e.target.value }));
                        }}
                      />
                    </td>
                    <td className="r n">
                      {!show(t.code) || variance === null ? (
                        <span className="text-brand-300">—</span>
                      ) : (
                        <span
                          style={{
                            color:
                              shownVariance(variance, t.isCard) < 0 ? "#b91c1c" : "#15803d",
                            fontWeight: 600,
                          }}
                        >
                          {varianceWords(shownVariance(variance, t.isCard))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* The rest of the tenders, in the open — nothing to count, nothing
              to hide. See the close-out's per-tender rule. */}
          <p className="rp-note">
            {data.tenders
              .filter((t) => t.code !== "cash" && t.code !== "cc" && t.takingsCents !== 0)
              .map((t) => `${t.label} ${formatCents(t.takingsCents)}`)
              .join(" · ") || "No other tenders today."}
          </p>
          <button
            type="button"
            className="btn btn-primary mt-2"
            disabled={busy}
            onClick={() => void logRegister()}
          >
            {busy ? "Working…" : "Log Register"}
          </button>
        </div>

        {/* ── Step 2 · The verdict ───────────────────────────────────────── */}
        <div className={`cv3-step ${registerLogged ? "" : "cv3-step-waiting"}`}>
          <div className="cv3-step-head">
            <span className="cv3-step-no">2</span>
            <span className="cv3-step-title">Read the verdict</span>
          </div>
          {!registerLogged ? (
            <p className="text-sm text-brand-300">Appears once the register is logged.</p>
          ) : (
            <>
              <div className={`cv3-verdict ${outBy === 0 || shortByExactlyTips ? "is-good" : "is-bad"}`}>
                {outBy === 0
                  ? "BALANCED"
                  : shortByExactlyTips
                    ? `SHORT BY EXACTLY THE TIPS (${formatCents(data.totals.tipCents)}) — that is not a shortage`
                    : `OUT BY ${formatCents(outBy)}`}
              </div>
              {finalCheck && (
                <table className="rp-table">
                  <tbody>
                    {finalCheck.lines.map((l) => (
                      <tr key={l.methodId}>
                        <td>{l.label}</td>
                        <td className="r n">{formatCents(l.countedCents)} counted</td>
                        <td className="r n">{formatCents(l.expectedCents)} expected</td>
                        <td
                          className="r n"
                          style={{
                            color:
                              shownVariance(l.varianceCents, l.isCard) < 0
                                ? "#b91c1c"
                                : "#15803d",
                            fontWeight: 700,
                          }}
                        >
                          {varianceWords(shownVariance(l.varianceCents, l.isCard))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.exceptions.length > 0 && (
                <div className="rp-concerns mt-2">
                  {data.exceptions.map((x, i) => (
                    <div key={i} className={`rp-concern ${x.severity}`}>
                      <div className="rp-concern-head">
                        <span className="rp-concern-tag">
                          {x.severity === "serious" ? "Serious" : "Watch"}
                        </span>
                        <span className="rp-concern-find">{x.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Step 3 · Print and sign ────────────────────────────────────── */}
        <div className={`cv3-step ${registerLogged ? "" : "cv3-step-waiting"}`}>
          <div className="cv3-step-head">
            <span className="cv3-step-no">3</span>
            <span className="cv3-step-title">Print and sign</span>
          </div>
          <p className="text-sm text-brand-400 mb-2">
            Page one is the verdict and the signatures; the full day rides behind it.
            Settle the terminal batch before signing — the printed line for it is ticked
            by hand, because paper is the only witness the terminal has.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!registerLogged}
            title={registerLogged ? "Print the close-out" : "Log the register first"}
            onClick={() => window.print()}
          >
            Print the close-out
          </button>
        </div>
      </div>

      {/* ═══ PRINT: page one — the sheet that gets signed ════════════════ */}
      <div className="cv3-print">
        <div className="cv3-page1">
          <div className="cv3-letterhead">
            <ShopLogo size={48} priority />
            <div>
              <div style={{ fontWeight: 700, fontSize: "14pt" }}>
                Casias Muffler and Tire Shop · Close-out
              </div>
              <div style={{ fontSize: "9.5pt" }}>
                {weekday} {data.businessDate} · printed {printedOn} · by {user.name}
              </div>
            </div>
          </div>

          {/* The register, first and biggest — this is what the sheet certifies. */}
          <div className={`cv3-verdict ${outBy === 0 || shortByExactlyTips ? "is-good" : "is-bad"}`}>
            {!registerLogged
              ? "REGISTER NOT LOGGED — THIS SHEET CERTIFIES NOTHING"
              : outBy === 0
                ? "REGISTER BALANCED"
                : shortByExactlyTips
                  ? `SHORT BY EXACTLY THE TIPS (${formatCents(data.totals.tipCents)}) — NOT A SHORTAGE`
                  : `OUT BY ${formatCents(outBy)}`}
          </div>

          {finalCheck && (
            <table className="rp-table cv3-recon">
              <thead>
                <tr>
                  <th>Tender</th>
                  <th className="r">Expected</th>
                  <th className="r">Counted</th>
                  <th className="r">Difference</th>
                </tr>
              </thead>
              <tbody>
                {finalCheck.lines.map((l) => (
                  <tr key={l.methodId}>
                    <td>{l.label}</td>
                    <td className="r n">{formatCents(l.expectedCents)}</td>
                    <td className="r n">{formatCents(l.countedCents)}</td>
                    <td className="r n" style={{ fontWeight: 700 }}>
                      {varianceWords(shownVariance(l.varianceCents, l.isCard))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* The drawer explained in one line each — the three numbers that
              produced Expected, so a signature is never against a mystery. */}
          <table className="rp-table">
            <tbody>
              <tr>
                <td>Opening float</td>
                <td className="r n">{formatCents(data.drawer.floatCents)}</td>
              </tr>
              <tr>
                <td>Cash from customers</td>
                <td className="r n">+{formatCents(data.drawer.cashSalesCents)}</td>
              </tr>
              <tr>
                <td>
                  Cash moved in / out
                  {data.drawer.movements.length > 0 &&
                    ` (${data.drawer.movements.map((m) => m.reason).join(", ")})`}
                </td>
                <td className="r n">
                  {data.drawer.movementsCents >= 0 ? "+" : "−"}
                  {formatCents(Math.abs(data.drawer.movementsCents))}
                </td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>Cash the drawer should hold</td>
                <td className="r n">{formatCents(data.drawer.expectedCents)}</td>
              </tr>
              <tr>
                <td>Tips paid out to technicians</td>
                <td className="r n">−{formatCents(data.totals.tipCents)}</td>
              </tr>
            </tbody>
          </table>

          {/* The day in four figures — enough for the file, no more. */}
          <div className="rp-stats cv3-day">
            <Stat label="Sold" value={formatCents(data.totals.goodsCents)} />
            <Stat label="Collected" value={formatCents(data.totals.collectedCents)} />
            <Stat label="Tickets" value={String(data.totals.saleCount)} />
            <Stat
              label="Voids / refunds"
              value={`${data.tickets.voided} / ${data.tickets.refunds.length}`}
            />
          </div>

          {/* Hand-ticked, not database-claimed: the system cannot verify the
              terminal was settled, so the paper says a human did. */}
          <div className="cv3-manual-ticks">
            <div>☐ Terminal batch settled, slip stapled to this sheet</div>
            <div>☐ Cash drop / deposit prepared</div>
          </div>

          <div className="cv3-signatures">
            <div>
              <div className="cv3-sigline" />
              <div>Counted and closed by</div>
            </div>
            <div>
              <div className="cv3-sigline" />
              <div>Reviewed by</div>
            </div>
          </div>
        </div>

        {/* ═══ PRINT: the evidence, behind the signature page ═════════════ */}
        <div className="cv3-evidence">
          <h2 className="rp-h2">The day in full</h2>

          <h3 className="cv3-h3">Where the money came from</h3>
          <table className="rp-table">
            <tbody>
              {data.tenders
                .filter((t) => t.count > 0 || t.takingsCents !== 0)
                .map((t) => (
                  <tr key={t.methodId}>
                    <td>{t.label}</td>
                    <td className="r n">{t.count}</td>
                    <td className="r n">{formatCents(t.takingsCents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="rp-note">
            Tax inside {formatCents(data.totals.taxIncludedCents)} · disposal fees{" "}
            {formatCents(data.sold.disposalCents)} · on house accounts{" "}
            {formatCents(data.owed.houseChargedTodayCents)}
          </p>

          {liveChecks.length > 1 && (
            <>
              <h3 className="cv3-h3">Every register log today</h3>
              <table className="rp-table">
                <tbody>
                  {liveChecks.map((c) => (
                    <tr key={c.id}>
                      <td className="n">{c.checkedAt.slice(11, 16)}</td>
                      <td>{c.checkedByName}</td>
                      <td className="r">
                        {c.balanced
                          ? "balanced"
                          : c.lines
                              .filter((l) => l.varianceCents !== 0)
                              .map(
                                (l) =>
                                  `${l.label} ${varianceWords(shownVariance(l.varianceCents, l.isCard))}`,
                              )
                              .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {(data.tickets.voids.length > 0 ||
            data.tickets.refunds.length > 0 ||
            data.tickets.discounts.length > 0 ||
            data.tickets.unpaid.length > 0) && (
            <>
              <h3 className="cv3-h3">Corrections and balances</h3>
              <table className="rp-table">
                <tbody>
                  {data.tickets.voids.map((v) => (
                    <tr key={`v${v.saleId}`}>
                      <td>VOID</td>
                      <td className="n">{v.saleNo}</td>
                      <td className="r n">{formatCents(v.totalCents)}</td>
                      <td>
                        {v.voidedByName ?? "—"} · {v.reason ?? "no reason given"}
                      </td>
                    </tr>
                  ))}
                  {data.tickets.refunds.map((r) => (
                    <tr key={`r${r.saleId}-${r.createdAt}`}>
                      <td>REFUND</td>
                      <td className="n">{r.saleNo}</td>
                      <td className="r n">−{formatCents(Math.abs(r.amountCents))}</td>
                      <td>{r.byName ?? "—"}</td>
                    </tr>
                  ))}
                  {data.tickets.discounts.map((d) => (
                    <tr key={`d${d.saleId}`}>
                      <td>DISCOUNT</td>
                      <td className="n">{d.saleNo}</td>
                      <td className="r n">−{formatCents(d.discountCents)}</td>
                      <td>{d.byName ?? "—"}</td>
                    </tr>
                  ))}
                  {data.tickets.unpaid.map((u) => (
                    <tr key={`u${u.saleId}`}>
                      <td>UNPAID</td>
                      <td className="n">{u.saleNo}</td>
                      <td className="r n">{formatCents(u.balanceCents)}</td>
                      <td>{u.customerName ?? "no name"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3 className="cv3-h3">Who did the work</h3>
          <RankedBars
            data={data.mechanics.map((m) => ({
              label: m.name,
              value: m.salesCents,
              note: ` · ${m.lineCount} lines`,
            }))}
            format={formatCents}
            emptyLabel="Nobody credited."
          />

          <h3 className="cv3-h3">What sold</h3>
          <p className="rp-note">
            New tires {data.sold.newTires.units} ({formatCents(data.sold.newTires.cents)}) ·
            used {data.sold.usedTires.units} ({formatCents(data.sold.usedTires.cents)}) ·
            service lines {data.sold.service.lines} ({formatCents(data.sold.service.cents)}) ·
            tire attachment {data.sold.attachmentPct.toFixed(0)}%
          </p>
          <RankedBars
            data={data.sold.topProducts.slice(0, 6).map((p) => ({
              label: p.label,
              value: p.qty,
              note: ` · ${formatCents(p.cents)}`,
            }))}
            format={(n) => String(n)}
            emptyLabel="No products sold."
          />

          {data.stock.oversellRows.length > 0 && (
            <>
              <h3 className="cv3-h3">Oversells to review — where, exactly</h3>
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Tire</th>
                    <th>Ticket</th>
                    <th>Rung by</th>
                    <th className="r">Sold short</th>
                    <th className="r">On hand now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stock.oversellRows.map((o, i) => (
                    <tr key={i}>
                      <td>{o.productName}</td>
                      <td className="n">{o.saleNo ?? "—"}</td>
                      <td>{o.byName ?? "—"}</td>
                      <td className="r n">{o.short}</td>
                      <td
                        className="r n"
                        style={o.onHand < 0 ? { color: "#b91c1c", fontWeight: 700 } : undefined}
                      >
                        {o.onHand}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="rp-note">
                The register sold these while its count said the rack was empty. Either the
                count was wrong (walk over and count that size) or the tire came from
                somewhere the system does not know about. Review each on the Inventory tab —
                reviewing records the answer, it does not change stock.
              </p>
            </>
          )}

          <h3 className="cv3-h3">Stock and what is owed</h3>
          <p className="rp-note">
            Tires on tickets {data.stock.unitsSoldOnTickets} · off the racks{" "}
            {data.stock.unitsOut}
            {data.stock.fulfilledForEarlierUnits > 0 &&
              ` (${data.stock.fulfilledForEarlierUnits} fitted for earlier orders)`}
            {data.stock.awaitingFulfillmentUnits > 0 &&
              ` (${data.stock.awaitingFulfillmentUnits} sold as orders, not yet fitted)`}{" "}
            · oversells to review {data.stock.unreviewedOversells} · outstanding on tickets{" "}
            {formatCents(data.owed.outstandingTicketCents)} ({data.owed.outstandingTicketCount})
          </p>

          {/* OWNER-ONLY BLOCK: must come off this sheet before V3 opens to the
              floor — costs are the owner's book, and this printout will be in
              a cashier's hands. */}
          <h3 className="cv3-h3">Margin (owner copy only)</h3>
          <p className="rp-note">
            {data.margin.marginPct.toFixed(0)}% ({formatCents(data.margin.marginCents)}) on the{" "}
            {data.margin.coveragePct}% of sales with a cost.
          </p>
        </div>
      </div>
    </div>
  );
}
