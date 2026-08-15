"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatCents } from "@/lib/money";
import { useLang } from "@/components/pos/LangToggle";

/**
 * Counting the drawer, one denomination at a time.
 *
 * WHAT IT REPLACES is a phone calculator and a person doing 12 × 20 in their
 * head at nine at night, then typing one number into the count box with nothing
 * behind it. Two things go wrong with that and this fixes both: the arithmetic,
 * and the fact that a single typed figure cannot be checked afterwards — if the
 * drawer is out by forty dollars there is no way to tell a miscount from a
 * mis-key without counting the whole thing again.
 *
 * BILLS FIRST AND BIGGEST FIRST, because that is the order money is stacked in
 * a drawer and the order a person counts it. A form that asks for pennies
 * before hundreds makes somebody hunt for the row they want on every line.
 *
 * NOTHING IS SAVED. It is a calculator that happens to know what a nickel is
 * worth; the only thing that leaves it is the total, and only when somebody
 * presses the button. The count itself is recorded by the register log, which
 * is the ledger — this is the paper it gets worked out on.
 */

/** Cents, and the words the shop uses. Bills before coin, biggest first. */
const DENOMS: { cents: number; label: string; kind: "bill" | "coin" }[] = [
  { cents: 10000, label: "$100", kind: "bill" },
  { cents: 5000, label: "$50", kind: "bill" },
  { cents: 2000, label: "$20", kind: "bill" },
  { cents: 1000, label: "$10", kind: "bill" },
  { cents: 500, label: "$5", kind: "bill" },
  { cents: 200, label: "$2", kind: "bill" },
  { cents: 100, label: "$1", kind: "bill" },
  { cents: 100, label: "$1 coin", kind: "coin" },
  { cents: 50, label: "50¢", kind: "coin" },
  { cents: 25, label: "Quarters", kind: "coin" },
  { cents: 10, label: "Dimes", kind: "coin" },
  { cents: 5, label: "Nickels", kind: "coin" },
  { cents: 1, label: "Pennies", kind: "coin" },
];

export function CashCounter({
  open,
  onClose,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  /** Hands the total back as cents, so nobody retypes it into the count box. */
  onUse: (cents: number) => void;
}) {
  const { t: tr } = useLang();
  /** Keyed by row index rather than by value — a $1 bill and a $1 coin share a value. */
  const [qty, setQty] = useState<Record<number, string>>({});

  const rows = useMemo(
    () =>
      DENOMS.map((d, i) => {
        const n = parseInt(qty[i] ?? "", 10);
        const count = Number.isFinite(n) && n > 0 ? n : 0;
        return { ...d, i, count, cents: count * d.cents };
      }),
    [qty],
  );

  const total = rows.reduce((s, r) => s + r.cents, 0);
  const bills = rows.filter((r) => r.kind === "bill").reduce((s, r) => s + r.cents, 0);
  const coins = total - bills;
  const anything = rows.some((r) => r.count > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("Count the drawer")}
      footer={
        <>
          <button type="button" className="btn btn-ghost mr-auto" onClick={() => setQty({})}>
            {tr("Start over")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {tr("Close")}
          </button>
          {/* The only way anything leaves this window. Disabled while it is
              empty, because putting $0.00 in the count box is a real claim
              about the drawer and not one anybody makes by accident. */}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!anything}
            onClick={() => {
              onUse(total);
              onClose();
            }}
          >
            {tr("Use")} {formatCents(total)}
          </button>
        </>
      }
    >
      <div className="cc">
        <p className="text-sm text-brand-400 mb-3">
          {tr(
            "Type how many of each you have. Leave a row empty if you have none of it — the total adds itself up as you go.",
          )}
        </p>

        <table className="cc-table">
          <thead>
            <tr>
              <th>{tr("What")}</th>
              <th className="cc-n">{tr("How many")}</th>
              <th className="cc-r">{tr("Comes to")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i} className={r.count > 0 ? "cc-has" : undefined}>
                <td>
                  {r.label}
                  {/* The first coin row gets a rule above it, so the eye finds
                      the change without a second heading taking up a line. */}
                </td>
                <td className="cc-n">
                  <input
                    className="input text-right tabular-nums"
                    inputMode="numeric"
                    placeholder="0"
                    value={qty[r.i] ?? ""}
                    onChange={(e) =>
                      setQty((q) => ({ ...q, [r.i]: e.target.value.replace(/\D/g, "") }))
                    }
                  />
                </td>
                <td className="cc-r tabular-nums">
                  {r.count > 0 ? formatCents(r.cents) : <span className="cc-dim">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {/* Bills and coin split out. They are counted by different methods
                — notes in the hand, change usually by weight or by roll — and
                when a drawer is out it is nearly always one or the other, so
                the two subtotals are the first thing worth seeing. */}
            <tr className="cc-sub">
              <td>{tr("Bills")}</td>
              <td />
              <td className="cc-r tabular-nums">{formatCents(bills)}</td>
            </tr>
            <tr className="cc-sub">
              <td>{tr("Coin")}</td>
              <td />
              <td className="cc-r tabular-nums">{formatCents(coins)}</td>
            </tr>
            <tr className="cc-total">
              <td>{tr("In the drawer")}</td>
              <td />
              <td className="cc-r tabular-nums">{formatCents(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Modal>
  );
}
