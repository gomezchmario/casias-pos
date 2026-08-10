import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { logActorAudit, type Actor } from "./audit";
import { normalizeTireSize } from "./tire-size";
import { getSetting } from "./settings";
import type { PosUser } from "./pos-session";

/**
 * What the shop was asked for and could not sell.
 *
 * See `migrations/030_tire_demand.sql` for why this is its own table and not
 * `product_searches`. The short version: a search is a keystroke, and this is a
 * person deciding that a real customer really did leave without a real size.
 *
 * The whole design here is subordinate to one fact: it will only ever be used
 * if it costs a couple of seconds at a counter with somebody standing at it. So
 * there is one required field, the record is written the moment it is typed,
 * and nothing about it blocks or interrupts anything else on the screen. A
 * study that has to be filled in properly is a study with three entries in it.
 */

export type DemandEntry = {
  id: number;
  sizeRaw: string;
  sizeNorm: string;
  qty: number;
  note: string | null;
  businessDate: string;
  byName: string;
  createdAt: string;
};

export type DemandSize = {
  sizeNorm: string;
  /** The commonest spelling somebody actually typed, for reading back. */
  sizeRaw: string;
  /** Tires wanted, not times asked — see the migration. */
  tires: number;
  /** How many separate customers. Both, because they answer different things. */
  asks: number;
  firstAsked: string;
  lastAsked: string;
  /** Is this size on the shelf now? Null when the shop has never carried it. */
  onHand: number | null;
};

export type DemandReport = {
  from: string;
  to: string;
  sizes: DemandSize[];
  entries: DemandEntry[];
  totals: { tires: number; asks: number; sizes: number };
};

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

const actorOf = (user: PosUser): Actor => ({
  type: "employee",
  employeeId: user.employeeId,
  name: user.name,
  role: user.role,
});

/** Is the shop currently running the study? */
export function tireDemandEnabled(): boolean {
  return getSetting("tire_demand_enabled") === "1";
}

/**
 * Write one down.
 *
 * Anybody who can ring a sale can record one, deliberately: the person who
 * watched the customer leave is whoever was at the counter, and routing this
 * through a manager would mean it is written down an hour later by somebody who
 * was told about it, or not at all.
 *
 * The size is stored as typed AND normalised. Normalising alone would throw
 * away the shop's own shorthand, and storing only the raw text would rank
 * "245/45R20" and "245 45 20" as two different sizes — which is precisely the
 * error that would make the report say nothing.
 */
export function recordDemand(
  user: PosUser,
  args: { size: string; qty?: number; note?: string | null },
): Result<{ entry: DemandEntry }> {
  const raw = args.size?.trim();
  if (!raw) return { ok: false, error: "What size were they after?" };
  if (raw.length > 60) return { ok: false, error: "That does not look like a tire size" };

  const norm = normalizeTireSize(raw);
  // Four is a set and the commonest answer after one; anything past that is
  // very probably a typed digit that ran on.
  const qty = Math.min(Math.max(Math.round(args.qty ?? 1), 1), 24);

  return inTx(() => {
    const db = getDb();
    const now = nowLocalIso();
    const info = db
      .prepare(
        `INSERT INTO tire_demand
           (size_raw, size_norm, qty, note, business_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(raw, norm, qty, args.note?.trim() || null, currentBusinessDate(), user.employeeId, now);
    const id = Number(info.lastInsertRowid);

    logActorAudit(actorOf(user), {
      action: "tire_demand.record",
      targetType: "tire_demand",
      targetId: id,
      details: { size: raw, normalized: norm, qty, note: args.note?.trim() || null },
    });

    return {
      ok: true as const,
      entry: {
        id,
        sizeRaw: raw,
        sizeNorm: norm,
        qty,
        note: args.note?.trim() || null,
        businessDate: currentBusinessDate(),
        byName: user.name,
        createdAt: now,
      },
    };
  });
}

/**
 * The study, over a window.
 *
 * Ranked by TIRES rather than by asks, because the question the report exists to
 * answer is "what should I buy", and four tires wanted once is a purchase while
 * one tire wanted four times is a conversation. Both figures are on the row so
 * the difference is visible rather than decided here.
 *
 * `onHand` is joined in on purpose, and it is the column that stops the report
 * being read wrong. A size that has been asked for eleven times and has six on
 * the rack today is not a buying signal — it is a size the shop already fixed,
 * and without this it would sit at the top of the list forever.
 */
export function demandReport(from: string, to: string): DemandReport {
  const db = getDb();

  const sizes = db
    .prepare(
      `SELECT d.size_norm                       AS sizeNorm,
              COALESCE(SUM(d.qty), 0)           AS tires,
              COUNT(*)                          AS asks,
              MIN(d.business_date)              AS firstAsked,
              MAX(d.business_date)              AS lastAsked,
              -- The spelling used most often; ties break on the most recent,
              -- which is the one the counter is currently in the habit of.
              (SELECT r.size_raw FROM tire_demand r
                WHERE r.size_norm = d.size_norm
             GROUP BY r.size_raw
             ORDER BY COUNT(*) DESC, MAX(r.id) DESC
                LIMIT 1)                        AS sizeRaw,
              -- What is on the rack today for that size, across every product
              -- that carries it. Null when the shop has never had one on the
              -- books at all, which is a different answer from zero.
              (SELECT SUM(mv.qty_delta)
                 FROM inventory_movements mv
                 JOIN products p ON p.id = mv.product_id
                WHERE p.deleted = 0 AND p.size = d.size_norm) AS onHand
         FROM tire_demand d
        WHERE d.business_date BETWEEN ? AND ?
     GROUP BY d.size_norm
     ORDER BY tires DESC, asks DESC, lastAsked DESC`,
    )
    .all(from, to) as DemandSize[];

  const entries = db
    .prepare(
      `SELECT d.id, d.size_raw AS sizeRaw, d.size_norm AS sizeNorm, d.qty, d.note,
              d.business_date AS businessDate, e.name AS byName,
              d.created_at AS createdAt
         FROM tire_demand d
         JOIN employees e ON e.id = d.created_by
        WHERE d.business_date BETWEEN ? AND ?
     ORDER BY d.business_date DESC, d.id DESC`,
    )
    .all(from, to) as DemandEntry[];

  return {
    from,
    to,
    sizes,
    entries,
    // Footed off the rows the page draws, so the total and the column above it
    // cannot tell different stories.
    totals: {
      tires: sizes.reduce((n, s) => n + s.tires, 0),
      asks: sizes.reduce((n, s) => n + s.asks, 0),
      sizes: sizes.length,
    },
  };
}
