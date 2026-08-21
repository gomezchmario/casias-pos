"use client";

import Link from "next/link";
import { useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { PairedBars, RankedBars, Stat } from "@/components/pos/Charts";
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

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Inventory & Tires: the money on the racks, and the tires that were not there.
 *
 * Four questions, in the order they cost the shop money: where the cash is
 * standing (stock value, dead stock), what is about to run out (reorder,
 * restock), what the year does to tires (the season), and what walked out
 * unsold (the misses). The demand study, the standing-still list and the
 * to-order sheet each keep their own page for working in — this page is where
 * they are READ together.
 */
export default function TiresReportPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const { data, error, win } = useSuite();
  /**
   * Whether the searched-for list shows the keystrokes as well as the
   * questions. Off by default: the search box logs every character, so one
   * customer asking for a 215/45/17 leaves half a dozen partial strings behind.
   */
  const [showPartial, setShowPartial] = useState(false);
  /**
   * Reorder points set from this page, by product. Held here rather than
   * reloading the whole report after each one.
   */
  const [applied, setApplied] = useState<Record<number, number>>({});
  const [applying, setApplying] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function applyReorder(productId: number, reorderPoint: number) {
    setApplying(productId);
    const res = await fetch(`/api/pos/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorderPoint }),
    });
    setApplying(null);
    if (!res.ok) {
      setApplyError("Could not set that reorder point");
      return;
    }
    setApplied((a) => ({ ...a, [productId]: reorderPoint }));
  }

  if (!can("viewBusinessReports"))
    return (
      <div className="text-brand-400">{tr("Your account can't see the management reports.")}</div>
    );
  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">{tr("Adding it up…")}</div>;

  return (
    <div className="max-w-6xl mx-auto rp">
      <ExperimentalNote />
      <RangeBar
        title={tr("Inventory & Tires")}
        blurb={tr("The money on the racks, what is running out, and the tires people asked for that were not there.")}
        data={data}
        win={win}
        printTitle={tr("Inventory report")}
      />
      <ReportsNav win={win} />

      {applyError && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 rp-no-print" style={{ marginBottom: 12 }}>
          {applyError}
        </div>
      )}

      {/* ── THE RACKS ───────────────────────────────────────────────────── */}
      <Section
        id="racks"
        title={tr("The racks")}
        note={tr("Stock is valued at what it actually cost — the weighted average of everything received — not at what the next one is expected to cost.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Stock on hand")}
            value={formatCents(data.stock.totalCostCents)}
            sub={`${data.stock.totalUnits} ${tr("units, at cost")}`}
          />
          <Stat
            label={tr("Standing still")}
            value={formatCents(data.deadTotal.costCents)}
            sub={
              <>
                {data.deadTotal.sizes} {tr("sizes with no sale in 45 days")} ·{" "}
                <Link href="/pos/standing-still" className="underline rp-no-print">
                  {tr("the full list")} →
                </Link>
              </>
            }
            tone={data.deadTotal.sizes > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("At the reorder point")}
            value={String(data.reorder.length)}
            sub={tr("sizes to order")}
            tone={data.reorder.length > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("Bought over the counter")}
            value={formatCents(data.purchases.costCents)}
            sub={`${data.purchases.units} ${tr("used tires taken in")}`}
          />
        </div>

        <div
          className="rp-no-print"
          style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <Link className="btn btn-outline" style={{ height: 36, fontSize: 13, display: "inline-flex", alignItems: "center" }} href="/pos/to-order">
            {tr("The order sheet")}
          </Link>
          <Link className="btn btn-outline" style={{ height: 36, fontSize: 13, display: "inline-flex", alignItems: "center" }} href="/pos/standing-still">
            {tr("Standing still, in full")}
          </Link>
          <Link className="btn btn-outline" style={{ height: 36, fontSize: 13, display: "inline-flex", alignItems: "center" }} href="/pos/demand">
            {tr("The demand study")}
          </Link>
          <Link className="btn btn-outline" style={{ height: 36, fontSize: 13, display: "inline-flex", alignItems: "center" }} href="/pos/web-searches">
            {tr("Tires looked for on the website")}
          </Link>
        </div>

        <div className="rp-two">
          <Panel title={tr("Where the money is, by brand")}>
            <RankedBars
              data={data.stock.byBrand.slice(0, 10).map((b) => ({
                label: b.key,
                value: b.costCents,
                note: ` · ${b.units}`,
              }))}
              format={formatCents}
              emptyLabel={tr("Nothing on the racks.")}
            />
          </Panel>
          <Panel title={tr("By rim size")}>
            <RankedBars
              data={data.stock.byRim.slice(0, 10).map((b) => ({
                label: b.key,
                value: b.costCents,
                note: ` · ${b.units}`,
              }))}
              format={formatCents}
              emptyLabel={tr("Nothing on the racks.")}
            />
          </Panel>
        </div>

        <Panel
          title={tr("Money standing still")}
          note={tr("On the racks, not sold in 45 days. Ranked by what it cost rather than by how long — the question is where the cash is.")}
        >
          {data.dead.length === 0 ? (
            <div className="rp-empty">{tr("Everything on the racks has moved recently.")}</div>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("Tire")}</th>
                  <th className="r">{tr("On hand")}</th>
                  <th className="r">{tr("Tied up")}</th>
                  <th className="r">{tr("Last sold")}</th>
                  <th className="r">{tr("On the shelf")}</th>
                </tr>
              </thead>
              <tbody>
                {data.dead.map((d) => (
                  <tr key={d.productId}>
                    <td>{d.name}</td>
                    <td className="r n">{d.onHand}</td>
                    <td className="r n" style={{ fontWeight: 600 }}>
                      {formatCents(d.costCents)}
                    </td>
                    <td className="r n">
                      {d.daysSinceSale === null ? (
                        <span style={{ color: "#b91c1c", fontWeight: 600 }}>{tr("never")}</span>
                      ) : (
                        `${d.daysSinceSale} ${tr("days ago")}`
                      )}
                    </td>
                    <td className="r n" style={{ color: "rgba(10,37,64,0.4)" }}>
                      {d.daysOnShelf === null ? "—" : `${d.daysOnShelf} ${tr("days")}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={tr("To order")} note={tr("At or under the reorder point, with how fast it has been going.")}>
          {data.reorder.length === 0 ? (
            <div className="rp-empty">{tr("Nothing is at its reorder point.")}</div>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("Tire")}</th>
                  <th className="r">{tr("On hand")}</th>
                  <th className="r">{tr("Reorder at")}</th>
                  <th className="r">{tr("Sold in 90 days")}</th>
                </tr>
              </thead>
              <tbody>
                {data.reorder.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.name}</td>
                    <td
                      className="r n"
                      style={{ color: r.onHand <= 0 ? "#b91c1c" : "#b45309", fontWeight: 600 }}
                    >
                      {r.onHand}
                    </td>
                    <td className="r n">{r.reorderPoint}</td>
                    <td className="r n">{r.sold90 || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {/* The mirror of the dead-stock list. "To order" can only warn about
            tires that already have a reorder point set — a size nobody ever set
            one on is invisible to it however fast it sells. This starts from
            what is SELLING and asks whether the shop has arranged to keep
            having it. */}
        <Panel
          title={tr("Worth keeping in stock")}
          note={tr("Selling steadily, with no standing level set — or one set too low.")}
        >
          {data.restock.length === 0 ? (
            <div className="rp-empty">
              {tr("Everything that sells has a reorder point that fits it.")}
            </div>
          ) : (
            <>
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>{tr("Tire")}</th>
                    <th className="r">{tr("On hand")}</th>
                    <th className="r">{tr("Sold")}</th>
                    <th className="r">{tr("Days of cover")}</th>
                    <th className="r">{tr("Reorder at")}</th>
                    <th className="r">{tr("Suggest")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.restock.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.name}</td>
                      <td
                        className="r n"
                        style={{
                          color: r.onHand <= 0 ? "#b91c1c" : undefined,
                          fontWeight: r.onHand <= 0 ? 600 : undefined,
                        }}
                      >
                        {r.onHand}
                      </td>
                      <td className="r n">
                        {r.sold90}
                        <span style={{ color: "rgba(10,37,64,0.4)" }}>
                          {" "}
                          / {r.overDays}
                          {tr("d")}
                        </span>
                      </td>
                      <td
                        className="r n"
                        style={{
                          color:
                            r.daysOfCover === null
                              ? "#b91c1c"
                              : r.daysOfCover < 14
                                ? "#b45309"
                                : undefined,
                          fontWeight: r.daysOfCover === null ? 600 : undefined,
                        }}
                      >
                        {r.daysOfCover === null ? tr("none left") : `${r.daysOfCover}`}
                      </td>
                      <td className="r n" style={{ color: "rgba(10,37,64,0.4)" }}>
                        {applied[r.productId] ?? r.reorderPoint ?? "—"}
                      </td>
                      <td className="r n" style={{ fontWeight: 600 }}>
                        {applied[r.productId] === r.suggested ? (
                          <span style={{ color: "#15803d" }}>{tr("set")}</span>
                        ) : can("manageProducts") ? (
                          <button
                            type="button"
                            className="rp-apply"
                            disabled={applying === r.productId}
                            title={`${tr("Set the reorder point to")} ${r.suggested}`}
                            onClick={() => void applyReorder(r.productId, r.suggested)}
                          >
                            {applying === r.productId ? "…" : `${tr("set")} ${r.suggested}`}
                          </button>
                        ) : (
                          <span style={{ color: "#15803d" }}>{r.suggested}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="rp-note" style={{ marginTop: 10, marginBottom: 0 }}>
                {tr(
                  "The suggestion is about a fortnight of sales at the rate above — a starting figure, not an answer. A fortnight is right only if the truck comes in a fortnight, which this cannot know. Set it on the tire in Inventory and it starts appearing in To order.",
                )}
              </p>
            </>
          )}
        </Panel>
      </Section>

      {/* ── THE SEASON ──────────────────────────────────────────────────── */}
      <Section
        id="season"
        title={tr("The season")}
        note={tr("Every year on record folded into one — tires sold per trading day, month by month. Per trading day on purpose: the history has stretches nobody wrote down, and dividing by the calendar would invent a collapse that never happened.")}
      >
        <Panel
          title={tr("Tires a day, by month of the year")}
          note={tr("New and used, averaged over the days the shop actually traded.")}
        >
          <PairedBars
            data={data.seasonalCats
              .filter((m) => m.tradingDays > 0)
              .map((m) => ({
                label: MONTH_SHORT[Number(m.mm) - 1] ?? m.mm,
                a: Math.round((m.newUnits / m.tradingDays) * 10) / 10,
                b: Math.round((m.usedUnits / m.tradingDays) * 10) / 10,
              }))}
            labels={[tr("New tires"), tr("Used tires")]}
            format={(n) => `${n}`}
            emptyLabel={tr("Nothing on record yet.")}
          />
        </Panel>
        <div className="rp-two">
          <Panel
            title={tr("Strongest tire months")}
            note={tr("Tire money per trading day, so a short month competes fairly with a long one.")}
          >
            <RankedBars
              data={data.seasonalCats
                .filter((m) => m.tradingDays > 0)
                .map((m) => ({
                  label: MONTH_SHORT[Number(m.mm) - 1] ?? m.mm,
                  value: Math.round(m.tireCents / m.tradingDays),
                  note: ` · ${m.tradingDays} ${tr("days on record")}`,
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 6)}
              format={formatCents}
              emptyLabel={tr("Nothing on record yet.")}
            />
          </Panel>
          <Panel
            title={tr("The rest of the shop, by month")}
            note={tr("Everything that is not a tire, per trading day — the floor under a slow tire month.")}
          >
            <RankedBars
              data={data.seasonalCats
                .filter((m) => m.tradingDays > 0)
                .map((m) => ({
                  label: MONTH_SHORT[Number(m.mm) - 1] ?? m.mm,
                  value: Math.round(m.otherCents / m.tradingDays),
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 6)}
              format={formatCents}
              emptyLabel={tr("Nothing on record yet.")}
            />
          </Panel>
        </div>
      </Section>

      {/* ── MISSED ──────────────────────────────────────────────────────── */}
      <Section
        id="missed"
        title={tr("What walked out")}
        note={tr("Two different qualities of evidence, kept apart. A recorded lost sale is somebody watching a customer leave; an empty search is a keystroke.")}
      >
        <div className="rp-two">
          <Panel title={tr("Asked for and not in stock")} note={tr("From the counter's study.")}>
            <RankedBars
              data={data.lost.recorded.slice(0, 10).map((r) => ({
                label: r.size,
                value: r.tires,
                note:
                  r.onHand === null || r.onHand <= 0
                    ? ` · ${tr("still none")}`
                    : ` · ${r.onHand} ${tr("now on hand")}`,
                color: r.onHand === null || r.onHand <= 0 ? "#b91c1c" : "#15803d",
              }))}
              format={(n) => `${n}`}
              emptyLabel={tr("Nothing recorded in this window.")}
            />
            <Link href="/pos/demand" className="rp-more rp-no-print">
              {tr("The whole study")} →
            </Link>
          </Panel>
          <Panel
            title={tr("Searched for and not found")}
            note={tr("Sizes the register was asked for and could not show.")}
          >
            {/* The eye: the only list with debris in it — the search box logs on
                every keystroke, so one 215/45/17 leaves "21545" behind. */}
            <button
              type="button"
              className="rp-eye rp-no-print"
              aria-pressed={showPartial}
              aria-label={tr("Show half-typed searches")}
              title={
                showPartial
                  ? tr("Showing half-typed searches as well as whole sizes")
                  : tr("Also show half-typed searches and other odd entries")
              }
              onClick={() => setShowPartial((v) => !v)}
            >
              <svg
                viewBox="0 0 24 24"
                width={16}
                height={16}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z" />
                <circle cx="12" cy="12" r="3.1" />
                {!showPartial && <path d="M3.5 20.5 20.5 3.5" />}
              </svg>
            </button>
            <RankedBars
              data={data.lost.searched
                .filter((r) => showPartial || r.complete)
                .slice(0, 10)
                .map((r) => ({
                  label: r.size,
                  value: r.asks,
                  note: r.complete ? undefined : ` · ${tr("half-typed")}`,
                  color: r.complete ? undefined : "rgba(10,37,64,0.3)",
                }))}
              format={(n) => `${n}`}
              emptyLabel={tr("Every search found a size we had.")}
            />
          </Panel>
        </div>
      </Section>

      <p className="rp-foot">
        {tr("Every figure here covers")} {data.from} → {data.to}
        {tr(", is bucketed by the shop's own business day, and excludes voided tickets except where they are being counted.")}{" "}
        {tr("The season panel is the one exception — it reads the whole history on purpose.")}
      </p>
    </div>
  );
}
