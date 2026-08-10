"use client";

import { useId } from "react";

/**
 * The charts, drawn by hand in SVG.
 *
 * NO CHARTING LIBRARY, and that is a deliberate choice rather than a limitation
 * being made the best of. The register runs on one PC with no internet
 * guarantee, so every byte has to ship in the bundle; the four shapes this page
 * needs are a few hundred lines between them, and a library that draws forty
 * shapes would be two hundred kilobytes to draw four. It would also bring its
 * own opinions about colour, type and spacing, and this app already has those.
 *
 * The rules every chart here follows:
 *
 *   NO Y-AXIS. Nobody reads one at a glance. Each chart labels the bar that
 *   matters and puts the maximum somewhere legible, which is how a person
 *   actually reads a shape — this one against that one, and roughly how big.
 *
 *   THE SHAPE IS THE POINT, the number is the footnote. If a chart needs its
 *   figures read to be understood it should have been a table, and several
 *   things on this page are tables for exactly that reason.
 *
 *   NOTHING ANIMATES. A dashboard that moves when it loads is a dashboard
 *   somebody waits for.
 *
 *   EMPTY IS A STATE. A shop with no data for a window gets a sentence saying
 *   so, never an axis with nothing on it — a blank chart reads as broken.
 */

const NAVY = "#0a2540";
const AMBER = "#b45309";
const GREEN = "#15803d";
const RED = "#b91c1c";
const MUTED = "rgba(10,37,64,0.35)";

/** The palette for anything categorical, in the order it gets handed out. */
export const SERIES = [
  "#0a2540",
  "#b45309",
  "#1f7a8c",
  "#7a5af8",
  "#15803d",
  "#b91c1c",
  "#0891b2",
  "#a16207",
];

function Empty({ label }: { label: string }) {
  return <div className="rp-empty">{label}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A run of bars over time.
 *
 * Bars rather than a line, because each one is a total for a period rather than
 * a reading on a continuum — a line between Tuesday and Wednesday implies
 * values in between, and there are none.
 *
 * The last bar is the one being read against the others and is drawn solid;
 * the rest are the context and are drawn lighter. That is the whole visual
 * argument of the chart and it needs no legend.
 */
export function BarChart({
  data,
  format,
  height = 120,
  highlightLast = true,
  color = NAVY,
  emptyLabel = "Nothing in this window.",
}: {
  data: { label: string; value: number; sub?: string }[];
  format: (n: number) => string;
  height?: number;
  highlightLast?: boolean;
  color?: string;
  emptyLabel?: string;
}) {
  if (data.length === 0) return <Empty label={emptyLabel} />;
  const max = Math.max(...data.map((d) => d.value), 1);
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a));

  return (
    <div className="rp-bars" style={{ height: height + 34 }}>
      {data.map((d, i) => {
        const solid = highlightLast ? i === data.length - 1 : true;
        return (
          <div key={d.label + i} className="rp-bar-col" title={`${d.label} · ${format(d.value)}`}>
            <div className="rp-bar-val">
              {/* Only the tallest and the last get a number. Every bar labelled
                  is a row of digits nobody reads; two labelled is a scale. */}
              {d.value > 0 && (d === peak || i === data.length - 1) ? format(d.value) : ""}
            </div>
            <div
              className="rp-bar"
              style={{
                height: `${Math.max(2, (d.value / max) * height)}px`,
                background: color,
                opacity: solid ? 1 : 0.32,
              }}
            />
            <div className="rp-bar-lab">{d.label}</div>
            {d.sub && <div className="rp-bar-sub">{d.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two series over the same buckets, side by side.
 *
 * For the one comparison this page makes constantly: what was SOLD against what
 * was COLLECTED. They are different numbers on purpose — a deposit taken today
 * on last week's order is in one and not the other — and the gap between the
 * pair is the thing worth seeing.
 */
export function PairedBars({
  data,
  format,
  labels,
  height = 130,
  emptyLabel = "Nothing in this window.",
}: {
  data: { label: string; a: number; b: number }[];
  format: (n: number) => string;
  labels: [string, string];
  height?: number;
  emptyLabel?: string;
}) {
  if (data.length === 0) return <Empty label={emptyLabel} />;
  const max = Math.max(...data.flatMap((d) => [d.a, d.b]), 1);

  return (
    <>
      <div className="rp-legend">
        <span>
          <i style={{ background: NAVY }} /> {labels[0]}
        </span>
        <span>
          <i style={{ background: AMBER }} /> {labels[1]}
        </span>
      </div>
      <div className="rp-bars" style={{ height: height + 22 }}>
        {data.map((d, i) => (
          <div key={d.label + i} className="rp-bar-col">
            <div className="rp-pair">
              <div
                className="rp-bar"
                title={`${labels[0]} ${format(d.a)}`}
                style={{ height: `${Math.max(2, (d.a / max) * height)}px`, background: NAVY }}
              />
              <div
                className="rp-bar"
                title={`${labels[1]} ${format(d.b)}`}
                style={{ height: `${Math.max(2, (d.b / max) * height)}px`, background: AMBER }}
              />
            </div>
            <div className="rp-bar-lab">{d.label}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ranked list as horizontal bars.
 *
 * The right shape whenever the categories have names rather than positions —
 * brands, sizes, technicians, tenders. Vertical bars with rotated labels are
 * the commonest chart mistake there is: the label is the thing being compared,
 * and turning it on its side makes it the hardest part to read.
 */
export function RankedBars({
  data,
  format,
  max: forcedMax,
  emptyLabel = "Nothing to rank yet.",
}: {
  data: { label: string; value: number; note?: string; color?: string }[];
  format: (n: number) => string;
  max?: number;
  emptyLabel?: string;
}) {
  if (data.length === 0) return <Empty label={emptyLabel} />;
  const max = forcedMax ?? Math.max(...data.map((d) => Math.abs(d.value)), 1);

  return (
    <div className="rp-ranked">
      {data.map((d, i) => (
        <div key={d.label + i} className="rp-rank-row">
          <div className="rp-rank-lab" title={d.label}>
            {d.label}
          </div>
          <div className="rp-rank-track">
            <div
              className="rp-rank-fill"
              style={{
                width: `${Math.max(1, (Math.abs(d.value) / max) * 100)}%`,
                background: d.color ?? SERIES[i % SERIES.length],
              }}
            />
          </div>
          <div className="rp-rank-val">
            {format(d.value)}
            {d.note && <span className="rp-rank-note">{d.note}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A share, as a ring.
 *
 * Used sparingly and only where the parts genuinely make a whole — the sales
 * mix, the tender mix. A ring rather than a pie because the hole holds the
 * total, which is the number somebody wants first and which a pie has nowhere
 * to put.
 *
 * Anything under three per cent is folded into "Other" rather than drawn as a
 * sliver with a label pointing at it. A slice too small to see is a slice that
 * only makes the legend longer.
 */
export function Donut({
  data,
  total,
  totalLabel,
  format,
  size = 168,
  emptyLabel = "Nothing sold in this window.",
}: {
  data: { label: string; value: number }[];
  total: number;
  totalLabel: string;
  format: (n: number) => string;
  size?: number;
  emptyLabel?: string;
}) {
  const id = useId();
  const live = data.filter((d) => d.value > 0);
  if (live.length === 0 || total <= 0) return <Empty label={emptyLabel} />;

  const big = live.filter((d) => d.value / total >= 0.03);
  const rest = live.filter((d) => d.value / total < 0.03);
  const slices = rest.length
    ? [...big, { label: "Other", value: rest.reduce((n, d) => n + d.value, 0) }]
    : big;

  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="rp-donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((d, i) => {
            const frac = d.value / total;
            const dash = `${frac * c} ${c}`;
            const el = (
              <circle
                key={d.label + i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={20}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              >
                <title>{`${d.label} · ${format(d.value)} · ${Math.round(frac * 100)}%`}</title>
              </circle>
            );
            offset += frac * c;
            return el;
          })}
        </g>
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          style={{ fontSize: 17, fontWeight: 700, fill: NAVY }}
        >
          {format(total)}
        </text>
        <text
          x="50%"
          y="60%"
          textAnchor="middle"
          style={{ fontSize: 10, fill: MUTED, textTransform: "uppercase", letterSpacing: "0.08em" }}
        >
          {totalLabel}
        </text>
      </svg>
      <ul className="rp-donut-key" aria-describedby={id}>
        {slices.map((d, i) => (
          <li key={d.label + i}>
            <i style={{ background: SERIES[i % SERIES.length] }} />
            <span className="rp-key-lab">{d.label}</span>
            <span className="rp-key-val">
              {format(d.value)}
              <em>{Math.round((d.value / total) * 100)}%</em>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The week as a grid of intensity: which hours of which days carry the shop.
 *
 * The one chart on this page that answers a question nobody can answer from
 * memory. A shop feels busy when there is a queue, and a queue is about how
 * many people are behind the counter rather than about how much money is coming
 * over it — so "we are rushed on Saturday" and "we take our money on Thursday"
 * are both frequently true, and only this can tell them apart.
 *
 * Empty hours are drawn as empty cells rather than dropped. The gaps are the
 * information: they are when the shop is not earning, which is when it can
 * afford to be short-handed.
 */
export function Heatmap({
  cells,
  hours,
  format,
  emptyLabel = "No tickets in this window.",
}: {
  cells: { weekday: number; hour: number; value: number }[];
  /** The hours to draw, so a shop open 8–6 does not get a grid of empty nights. */
  hours: number[];
  format: (n: number) => string;
  emptyLabel?: string;
}) {
  if (cells.length === 0) return <Empty label={emptyLabel} />;
  const max = Math.max(...cells.map((c) => c.value), 1);
  const at = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c.value]));

  const hourLabel = (h: number) =>
    h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;

  return (
    <div className="rp-heat" style={{ gridTemplateColumns: `36px repeat(${hours.length}, 1fr)` }}>
      <div />
      {hours.map((h) => (
        <div key={`h${h}`} className="rp-heat-hour">
          {hourLabel(h)}
        </div>
      ))}
      {DAYS.map((d, w) => (
        <Row key={d} day={d} weekday={w} hours={hours} at={at} max={max} format={format} />
      ))}
    </div>
  );
}

function Row({
  day,
  weekday,
  hours,
  at,
  max,
  format,
}: {
  day: string;
  weekday: number;
  hours: number[];
  at: Map<string, number>;
  max: number;
  format: (n: number) => string;
}) {
  return (
    <>
      <div className="rp-heat-day">{day}</div>
      {hours.map((h) => {
        const v = at.get(`${weekday}-${h}`) ?? 0;
        return (
          <div
            key={`${weekday}-${h}`}
            className="rp-heat-cell"
            title={`${day} ${h}:00 · ${format(v)}`}
            style={{
              // Floored at a visible tint so a cell with one ticket in it does
              // not read as an empty hour.
              background:
                v === 0 ? "rgba(10,37,64,0.04)" : `rgba(10,37,64,${0.12 + (v / max) * 0.78})`,
            }}
          />
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A figure with the same figure from before beside it.
 *
 * The delta is the reason this component exists. A number on its own — $3,140 —
 * is not information; it is a good week or a disaster depending on the week
 * before it, and the person reading this is the one who knows which. So the
 * comparison is not an optional extra on these tiles, it is the tile.
 */
export function Stat({
  label,
  value,
  deltaPct,
  deltaLabel,
  sub,
  tone,
  invert,
}: {
  label: string;
  value: string;
  /**
   * The change against the previous window, ALREADY as a percentage — see
   * `changePct`, which returns null when there is no earlier figure to divide
   * by. Named for what it holds rather than for what it came from: this was
   * called `prior`, which read as "the previous value" and is not what it is.
   */
  deltaPct?: number;
  /** What the change is against — "on the window before". */
  deltaLabel?: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
  /** True where going UP is the bad direction — discounts, voids, money owed. */
  invert?: boolean;
}) {
  return (
    <div className="rp-stat">
      <div className="rp-stat-lab">{label}</div>
      <div
        className="rp-stat-val"
        style={{
          color: tone === "good" ? GREEN : tone === "bad" ? RED : tone === "warn" ? AMBER : NAVY,
        }}
      >
        {value}
      </div>
      {sub && <div className="rp-stat-sub">{sub}</div>}
      {deltaPct !== undefined && deltaLabel && (
        <div className="rp-stat-sub">
          <Delta pct={deltaPct} invert={invert} /> {deltaLabel}
        </div>
      )}
    </div>
  );
}

/**
 * A percentage change, coloured.
 *
 * Null when there is nothing to compare against — a first week has no honest
 * percentage change from zero, and rendering one as +100% would put a number on
 * the page that means nothing. "New" is the truthful answer and it is short.
 */
export function Delta({ pct, invert }: { pct: number | null; invert?: boolean }) {
  if (pct === null) return <span style={{ color: MUTED }}>no earlier figure</span>;
  const good = invert ? pct <= 0 : pct >= 0;
  return (
    <span style={{ color: good ? GREEN : RED, fontWeight: 600 }}>
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
  );
}

/** Percentage change from `before` to `now`, or null when there is no base. */
export function changePct(now: number, before: number): number | null {
  if (before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}
