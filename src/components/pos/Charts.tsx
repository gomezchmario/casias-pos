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
// 0.55 rather than 0.35: composited over white that is 3.5:1 against 2.1:1,
// and both places it is used carry meaning — the ring's caption and the
// sentence that says there is nothing to compare against.
const MUTED = "rgba(10,37,64,0.55)";

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

/**
 * The heat scale: quiet is cool, busy is hot.
 *
 * ONE HUE WOULD BE SAFER AND IS WORSE HERE. A single colour fading from pale to
 * dark only separates cleanly at the two ends — the middle two thirds of a
 * navy ramp are a smear, and the whole question this grid is asked is which of
 * two middling hours is busier. Changing hue as well as darkness gives every
 * step of the scale a name a person can hold: blue morning, green hour, amber
 * hour, red hour.
 *
 * The stops are the brand's own navy-blue through to the red the rest of the
 * app already uses for "this needs attention", so the grid reads as part of
 * this program rather than as a weather map dropped into it. Darkness climbs
 * with the hue rather than resetting, so the shape still survives being
 * photocopied, printed in grey, or looked at by somebody who cannot separate
 * red from green.
 */
const HEAT: [number, [number, number, number]][] = [
  [0.0, [219, 232, 244]],
  [0.3, [109, 163, 209]],
  [0.55, [72, 165, 133]],
  [0.78, [222, 158, 54]],
  [1.0, [193, 47, 55]],
];

export function heatColor(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < HEAT.length; i++) {
    const [hi, top] = HEAT[i];
    if (x > hi && i < HEAT.length - 1) continue;
    const [lo, bottom] = HEAT[i - 1];
    const k = hi === lo ? 0 : (x - lo) / (hi - lo);
    const c = bottom.map((b, j) => Math.round(b + (top[j] - b) * k));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }
  return `rgb(${HEAT[0][1].join(", ")})`;
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
  const step = labelStep(data.length);

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
            <div className="rp-bar-lab">{(data.length - 1 - i) % step === 0 ? d.label : ""}</div>
            {d.sub && <div className="rp-bar-sub">{d.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * How many bars per printed label, so thirty daily dates do not fuse into
 * one unreadable string in a half-width panel. Anchored at the LAST bar —
 * today — and stepped backwards from it, because today's date is the one
 * label somebody actually reads and the rest are a ruler. Every bar still
 * says its own date in words on hover, and keeps its empty label element so
 * thinning changes nothing about the geometry.
 */
function labelStep(n: number, most = 12): number {
  return Math.max(1, Math.ceil(n / most));
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
                title={`${d.label} · ${labels[0]} ${format(d.a)}`}
                style={{ height: `${Math.max(2, (d.a / max) * height)}px`, background: NAVY }}
              />
              <div
                className="rp-bar"
                title={`${d.label} · ${labels[1]} ${format(d.b)}`}
                style={{ height: `${Math.max(2, (d.b / max) * height)}px`, background: AMBER }}
              />
            </div>
            {/* Thinned the same way BarChart's are — see labelStep. */}
            <div className="rp-bar-lab">
              {(data.length - 1 - i) % labelStep(data.length) === 0 ? d.label : ""}
            </div>
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
  quietLabel = "Quiet",
  busyLabel = "Busiest",
  showValues = false,
}: {
  cells: { weekday: number; hour: number; value: number }[];
  /** The hours to draw, so a shop open 8–6 does not get a grid of empty nights. */
  hours: number[];
  format: (n: number) => string;
  emptyLabel?: string;
  quietLabel?: string;
  busyLabel?: string;
  /**
   * Print the figure inside each square as well as colouring it.
   *
   * Off by default, and that default is right for a heatmap of raw counts: a
   * grid of four-digit totals is a table wearing a colour scheme, and the whole
   * point of the shape is that it is read at a glance rather than digit by
   * digit.
   *
   * On where the figures are small and ACTIONABLE — an average of 8.6 customers
   * in an hour is a number somebody rosters against, and having to hover a
   * square to read it makes the grid useless on paper and awkward on a screen
   * somebody is pointing at with another person beside them.
   */
  showValues?: boolean;
}) {
  if (cells.length === 0) return <Empty label={emptyLabel} />;
  const max = Math.max(...cells.map((c) => c.value), 1);
  const at = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c.value]));

  const hourLabel = (h: number) =>
    h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;

  return (
    <>
      <div className="rp-heat" style={{ gridTemplateColumns: `36px repeat(${hours.length}, 1fr)` }}>
        <div />
        {hours.map((h) => (
          <div key={`h${h}`} className="rp-heat-hour">
            {hourLabel(h)}
          </div>
        ))}
        {DAYS.map((d, w) => (
          <Row
            key={d}
            day={d}
            weekday={w}
            hours={hours}
            at={at}
            max={max}
            format={format}
            showValues={showValues}
          />
        ))}
      </div>

      {/* A key, which the single-hue version did not need and this one does.
          "Darker is more" explains itself; "green is more than blue" does not,
          and a scale nobody can read is a decoration. */}
      <div className="rp-heat-key">
        <span>{quietLabel}</span>
        <div className="rp-heat-ramp" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <i key={i} style={{ background: heatColor(i / 23) }} />
          ))}
        </div>
        <span>
          {busyLabel} · {format(max)}
        </span>
      </div>
    </>
  );
}

function Row({
  day,
  weekday,
  hours,
  at,
  max,
  format,
  showValues,
}: {
  day: string;
  weekday: number;
  hours: number[];
  at: Map<string, number>;
  max: number;
  format: (n: number) => string;
  showValues?: boolean;
}) {
  return (
    <>
      <div className="rp-heat-day">{day}</div>
      {hours.map((h) => {
        const v = at.get(`${weekday}-${h}`) ?? 0;
        const share = v === 0 ? 0 : 0.08 + (v / max) * 0.92;
        return (
          <div
            key={`${weekday}-${h}`}
            className={`rp-heat-cell${showValues ? " rp-heat-cell-n" : ""}`}
            title={`${day} ${h}:00 · ${format(v)}`}
            style={{
              // An hour with nothing in it is left almost white rather than
              // given the bottom of the scale: "shut" and "one ticket" are
              // different facts and the coldest colour has to mean the second.
              background: v === 0 ? "rgba(10,37,64,0.045)" : heatColor(share),
              // White type once the square is dark enough to swallow navy.
              color: share > 0.62 ? "#fff" : "#0a2540",
            }}
          >
            {showValues && v !== 0 ? v : ""}
          </div>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * One or two series as lines.
 *
 * THE EXCEPTION TO THIS FILE'S OWN RULE that bars beat lines. Bars are right
 * when each one is a total for a period — a line between Tuesday and Wednesday
 * implies values in between and there are none. But a rolling average is not a
 * total for a period; it is a reading that exists at every point, and drawing
 * it as separate columns hides exactly the thing it was computed to show, which
 * is whether it is turning.
 *
 * So this is used for rolling figures and rates, and BarChart for everything
 * that is a sum.
 */
export function LineChart({
  series,
  labels,
  format,
  height = 130,
  emptyLabel = "Nothing to draw yet.",
}: {
  series: { name: string; values: (number | null)[]; color?: string }[];
  labels: string[];
  format: (n: number) => string;
  height?: number;
  emptyLabel?: string;
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (all.length === 0) return <Empty label={emptyLabel} />;

  const max = Math.max(...all, 1);
  // Floored at zero rather than at the minimum. A line chart zoomed to its own
  // range turns a 3% wobble into a cliff, which is the commonest way a chart
  // lies without anybody meaning it to.
  const W = 100;
  const at = (i: number) => (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * W);
  const y = (v: number) => height - (v / max) * height;

  return (
    <div className="rp-line-wrap">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="rp-line"
        style={{ height }}
        role="img"
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={0}
            x2={W}
            y1={height * g}
            y2={height * g}
            stroke="rgba(10,37,64,0.08)"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s, si) => {
          // Broken into runs so a month with no record leaves a GAP rather than
          // a straight line drawn across it. A line joined over a hole asserts
          // a value that was never recorded.
          const runs: string[] = [];
          let cur: string[] = [];
          s.values.forEach((v, i) => {
            if (v === null) {
              if (cur.length) runs.push(cur.join(" "));
              cur = [];
              return;
            }
            cur.push(`${cur.length ? "L" : "M"}${at(i).toFixed(2)},${y(v).toFixed(2)}`);
          });
          if (cur.length) runs.push(cur.join(" "));
          return runs.map((d, ri) => (
            <path
              key={`${si}-${ri}`}
              d={d}
              fill="none"
              stroke={s.color ?? SERIES[si % SERIES.length]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ));
        })}
      </svg>
      {/* The scale, said once. No y-axis: nobody reads one at a glance, and
          the top of the chart plus both ends of the span is what a person
          actually needs to read a shape. */}
      <div className="rp-line-axis">
        <span>{labels[0]}</span>
        <span>{format(max)}</span>
        <span>{labels.at(-1)}</span>
      </div>
      {series.length > 1 && (
        <div className="rp-legend">
          {series.map((s, i) => (
            <span key={s.name}>
              <i style={{ background: s.color ?? SERIES[i % SERIES.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a figure got from one value to another, one cause at a time.
 *
 * A BRIDGE, and it is the only honest way to draw a decomposition. Two bars
 * labelled "then" and "now" show that something changed; this shows what
 * changed it, with each step's height being that cause's share of the whole
 * move. Because the steps are built to sum exactly to the difference, there is
 * no residual bar labelled "other" for somebody to argue about.
 */
export function Bridge({
  start,
  steps,
  end,
  endLabel = "Now",
  format,
  height = 120,
}: {
  start: { label: string; value: number };
  steps: { label: string; delta: number }[];
  /**
   * The true finishing figure, when the caller has one.
   *
   * Each step is rounded to the cent on its way in, so adding them up lands a
   * few cents from where the real total sits — and the same figure appearing as
   * $3,368.49 here and $3,368.72 in the tile above it is exactly the kind of
   * discrepancy that makes somebody stop trusting a financial page. The steps
   * still show what they show; only the last column is pinned to the truth.
   */
  end?: number;
  endLabel?: string;
  format: (n: number) => string;
  height?: number;
}) {
  const points: { label: string; base: number; size: number; delta: number | null; value: number }[] =
    [];
  let running = start.value;
  points.push({ label: start.label, base: 0, size: start.value, delta: null, value: start.value });
  for (const s of steps) {
    const from = running;
    running += s.delta;
    points.push({
      label: s.label,
      base: Math.min(from, running),
      size: Math.abs(s.delta),
      delta: s.delta,
      value: running,
    });
  }
  const finish = end ?? running;
  points.push({ label: endLabel, base: 0, size: finish, delta: null, value: finish });

  const max = Math.max(...points.map((p) => p.base + p.size), 1);

  return (
    <div className="rp-bridge" style={{ height: height + 46 }}>
      {points.map((p, i) => (
        <div key={p.label + i} className="rp-bridge-col" title={`${p.label} · ${format(p.value)}`}>
          <div className="rp-bridge-val">
            {p.delta === null ? format(p.value) : `${p.delta > 0 ? "+" : "−"}${format(Math.abs(p.delta))}`}
          </div>
          <div className="rp-bridge-track" style={{ height }}>
            <div
              className="rp-bridge-bar"
              style={{
                height: `${Math.max(1.5, (p.size / max) * 100)}%`,
                bottom: `${(p.base / max) * 100}%`,
                background:
                  p.delta === null ? NAVY : p.delta >= 0 ? GREEN : RED,
                opacity: p.delta === null ? 1 : 0.85,
              }}
            />
          </div>
          <div className="rp-bridge-lab">{p.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A year of shape, small enough to sit in a table cell.
 *
 * WITHOUT THIS, EVERY FIGURE BESIDE A NAME IS AMBIGUOUS. A technician who
 * brought in $900 a day either always has, or has just climbed, or is on the
 * way down — three different conversations, and the number alone cannot tell
 * them apart. The bars are unlabelled on purpose: this is a direction, not a
 * reading, and anybody who wants the figures has the table around it.
 *
 * Every sparkline on a page shares one maximum, passed in by the caller, so the
 * rows can be compared with each other. Scaled to its own maximum each row
 * would be the same height whatever the person earned, which is the one thing
 * this must not say.
 */
export function Spark({
  values,
  max,
  labels,
  format,
  color = NAVY,
}: {
  values: number[];
  max: number;
  labels?: string[];
  format?: (n: number) => string;
  color?: string;
}) {
  if (values.length === 0) return null;
  const top = Math.max(max, 1);
  return (
    <div className="rp-spark" role="img">
      {values.map((v, i) => (
        <i
          key={i}
          title={labels && format ? `${labels[i]} · ${format(v)}` : undefined}
          style={{
            // A floor of 2%, so a month with nothing in it still draws a
            // baseline. A gap where a bar should be reads as a rendering fault;
            // a flat sliver reads as a bad month, which is what it was.
            height: `${Math.max(2, (v / top) * 100)}%`,
            background: v === 0 ? "rgba(10,37,64,0.14)" : color,
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shares of a whole, over time.
 *
 * The one question a row of separate bars cannot answer: whether the shop is
 * selling a different mix than it used to. Totals rise and fall for a dozen
 * reasons, so each column here is normalised to its own full height and only
 * the proportions are drawn — the money is in the tooltip and in the charts
 * above. What the eye is meant to catch is a band getting thicker across the
 * page.
 */
export function StackedBars({
  columns,
  format,
  emptyLabel = "Nothing to compare yet.",
}: {
  columns: { label: string; parts: { label: string; value: number }[] }[];
  format: (n: number) => string;
  emptyLabel?: string;
}) {
  const drawable = columns.filter((c) => c.parts.some((p) => p.value > 0));
  if (drawable.length === 0) return <Empty label={emptyLabel} />;
  const names = drawable[0].parts.map((p) => p.label);

  return (
    <div className="rp-stack-wrap">
      <div className="rp-stack">
        {drawable.map((c) => {
          const total = c.parts.reduce((n, p) => n + Math.max(0, p.value), 0) || 1;
          return (
            <div key={c.label} className="rp-stack-col">
              <div className="rp-stack-bar">
                {c.parts.map((p, i) => (
                  <div
                    key={p.label}
                    title={`${c.label} · ${p.label} · ${format(p.value)} (${Math.round((p.value / total) * 100)}%)`}
                    style={{
                      height: `${(Math.max(0, p.value) / total) * 100}%`,
                      background: SERIES[i % SERIES.length],
                    }}
                  />
                ))}
              </div>
              <div className="rp-stack-lab">{c.label}</div>
            </div>
          );
        })}
      </div>
      <div className="rp-legend">
        {names.map((n, i) => (
          <span key={n}>
            <i style={{ background: SERIES[i % SERIES.length] }} />
            {n}
          </span>
        ))}
      </div>
    </div>
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
  /** A node, not a string, so a tile can carry a "see the full list →" link. */
  sub?: React.ReactNode;
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
