"use client";

import type { StandingsPeriod, TechScore } from "@/lib/leaderboard";

/**
 * The top three, and what they can be ranked on.
 *
 * Shared rather than owned by the dashboard because the shop has two of these
 * now — the one on the register and the one on the wall — and they have to be
 * the same board. A technician who reads "most used tires" on the monitor and
 * then hears a different answer at the counter has been given two scoreboards,
 * which is worse than having none: the argument is no longer about the work.
 */

/**
 * How a podium is allowed to print money.
 *
 * Two of them, because income and tips are withheld under different rules and
 * always have been: income is owner-only and blanked on the server, while a tip
 * is only ever hidden from the room by a button on the screen. One formatter for
 * both would have to pick the stricter of the two and would hide from a cashier
 * the tip they counted into somebody's hand an hour ago.
 */
export type PodiumFmt = {
  income: (cents: number, pct: number) => string;
  tips: (cents: number, pct: number) => string;
};

/**
 * What the podium can be ranked on.
 *
 * New and used tires get their own entries and are never blended into the
 * headline "most tires" alone, because they are different work: a used tire is
 * priced at the counter off its condition, a new one comes off a lot with a
 * cost. Someone who moves twenty used tires and someone who fits five sets of
 * four have both had a good week, and only separate boards say so.
 *
 * `score` is what ranks; anything at or below zero is off the board entirely,
 * which for improvement means only genuine improvements place. Ranking a week
 * where everybody fell as if someone had won it is how a leaderboard stops
 * being believed.
 */
export type PodiumMetric = {
  key: string;
  label: string;
  /** Word under the big number on the block. */
  unit: string;
  score: (t: TechScore) => number | null;
  show: (t: TechScore, fmt: PodiumFmt) => string;
};

export const PODIUM_METRICS: PodiumMetric[] = [
  {
    key: "tires",
    label: "Most tires sold",
    unit: "tires",
    score: (t) => t.newTires + t.usedTires,
    show: (t) => String(t.newTires + t.usedTires),
  },
  {
    key: "newTires",
    label: "Most new tires sold",
    unit: "new tires",
    score: (t) => t.newTires,
    show: (t) => String(t.newTires),
  },
  {
    key: "usedTires",
    label: "Most used tires sold",
    unit: "used tires",
    score: (t) => t.usedTires,
    show: (t) => String(t.usedTires),
  },
  {
    key: "serviceMoney",
    label: "Most services by money",
    unit: "in service work",
    // Ranked on the share, not the cents, because the cents are zeroed for
    // anyone below owner and ranking on them would put the board in a
    // meaningless order for everyone else. The share survives the gate.
    score: (t) => t.otherIncomePct,
    show: (t, fmt) => fmt.income(t.otherIncomeCents, t.otherIncomePct),
  },
  {
    key: "serviceCount",
    label: "Most services by count",
    // "services", not "jobs". The figure counts qty — a mount and balance on
    // three tires scores three, the same way the tire boards above count the
    // same column — and calling three tires off one car "3 jobs" would be the
    // label disagreeing with the number under it.
    unit: "services",
    score: (t) => t.otherCount,
    show: (t) => String(t.otherCount),
  },
  {
    key: "tickets",
    label: "Most tickets",
    unit: "tickets",
    score: (t) => t.ticketCount,
    show: (t) => String(t.ticketCount),
  },
  {
    key: "improvement",
    label: "Best improvement",
    unit: "up on last time",
    score: (t) => t.improvementPct,
    show: (t) => `+${(t.improvementPct ?? 0).toFixed(0)}%`,
  },
  /**
   * The same board twice, in the two currencies it can be read in.
   *
   * Not redundant, and the difference is who is standing in front of the screen.
   * The money board is what the shop asks at the end of a week. The share board
   * is the one that can be left up with customers walking past it, and it is the
   * only honest way to publish tips at all: it keeps the order and the
   * proportions — everybody can see exactly how they are doing against everybody
   * else — while saying nothing about what anyone took home.
   *
   * The share is deliberately not affected by a Hide money button. Somebody who
   * picked this metric asked for percentages; toggling the button back would
   * otherwise turn the board into dollars under a heading that says otherwise.
   */
  {
    key: "tipMoney",
    label: "Tips gained (Money)",
    unit: "in tips",
    score: (t) => t.tipCents,
    show: (t, fmt) => fmt.tips(t.tipCents, t.tipPct),
  },
  {
    key: "tipPct",
    label: "Tips gained (Percentage)",
    unit: "of the shop's tips",
    score: (t) => t.tipPct,
    show: (t) => `${t.tipPct.toFixed(1)}%`,
  },
];

export const PODIUM_PERIODS: readonly StandingsPeriod[] = ["day", "week", "month"];

/**
 * What a podium was last set to, kept on the machine it was set on.
 *
 * Neither of the screens this appears on is a personal computer — one is the
 * register the whole floor walks past, the other is a monitor on a wall — and
 * the two dropdowns are a decision about what the shop is watching this month,
 * not a preference belonging to whoever is signed in. Somebody sets it to used
 * tires on a Monday and everyone reads used tires all week; going back and
 * finding it reset to the factory default is how a control stops being trusted
 * to mean what it says.
 *
 * `localStorage` rather than a settings row for exactly that reason: it is a
 * property of the screen, so the wall can watch the month's tips while the
 * register watches today's tires without the two arguing about it. Callers pass
 * their own key prefix to keep them apart.
 */
export function readPref(key: string, allowed: readonly string[], fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  // Validated rather than trusted. A metric renamed in a later version leaves
  // yesterday's key behind in the browser, and an unrecognised period would drop
  // through a board's ternary and quietly show the month under a title saying
  // week.
  return v && allowed.includes(v) ? v : fallback;
}

export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing, or a full quota. The dropdown still works for this
    // visit; forgetting the choice is not worth breaking the page over.
  }
}

/**
 * Everybody who placed on `metric`, best first — not pre-cut to three.
 *
 * `includeZero` keeps the people who scored nothing, and nothing currently asks
 * for it. The register never did: it is a working screen and a row saying
 * somebody sold no tires answers nothing anybody asked it. The wall did for a
 * while, on the argument that the whole shop side by side is more use than a
 * top three — until it was pointed out that what it really prints is a man's
 * zero, on a wall, in the largest type in the building. Kept because the flag
 * is right for a report somebody reads sitting down; it is the audience that
 * was wrong, not the option.
 *
 * Negatives are dropped either way. `improvement` is the only metric that can go
 * below zero, and a board that ranks a week where everybody fell as if somebody
 * had won it is a board that stops being believed.
 */
export function rankBy(
  techs: TechScore[],
  metric: PodiumMetric,
  fmt: PodiumFmt,
  { includeZero = false }: { includeZero?: boolean } = {},
): PodiumEntry[] {
  return techs
    .map((x) => ({ ...x, podiumScore: metric.score(x) ?? 0 }))
    .filter((x) => (includeZero ? x.podiumScore >= 0 : x.podiumScore > 0))
    // Income breaks ties. For a viewer who may not see it the cents are all
    // zero, but the server sorted the list by the real figures before blanking
    // them, so a stable sort still lands ties in the same order an owner sees.
    .sort((a, b) => b.podiumScore - a.podiumScore || b.incomeCents - a.incomeCents)
    .map((x) => ({
      employeeId: x.employeeId,
      name: x.name,
      value: metric.show(x, fmt),
      sub: `${x.newTires} new · ${x.usedTires} used · ${x.otherCount} service`,
      score: x.podiumScore,
    }));
}

export type PodiumEntry = {
  employeeId: number;
  name: string;
  value: string;
  sub: string;
  /**
   * What ranked them, carried through so a caller can tell a winner from
   * somebody the board is merely listing.
   *
   * `includeZero` puts the whole shop on the wall, which is the point of it —
   * a man who is not on the board cannot tell whether he is last or whether
   * the board has never heard of him. But it also seats somebody at zero, and
   * on a morning before the first tire is fitted that would hand a gold medal
   * to whoever happens to sort first. A medal is for scoring, so the emoji
   * asks this.
   */
  score: number;
};

/** First, second, third. Read from across the shop before any of the words are. */
export const MEDALS = ["🥇", "🥈", "🥉"] as const;

/**
 * The medal for a placing, or nothing — for the top three who actually scored.
 *
 * Exported because the wall puts the same three medals beside the same three
 * names down in the ticket list, and two places deciding separately who is
 * winning is two places to disagree.
 */
export function medalFor(entries: PodiumEntry[], name: string): string {
  const i = entries.findIndex((e) => e.name === name);
  return i >= 0 && i < 3 && entries[i].score > 0 ? MEDALS[i] : "";
}

/**
 * Left-to-right seating for `n` blocks: the winner in the middle, everybody else
 * stepping down and outwards — 4th, 2nd, 1st, 3rd, 5th. Odd places to the left,
 * even to the right, which is the shape a podium has always had and the reason
 * it can be read without reading the numbers on it.
 */
function podiumOrder(n: number): number[] {
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 1; i < n; i++) (i % 2 ? left : right).push(i);
  return [...left.reverse(), ...(n > 0 ? [0] : []), ...right];
}

function ordinal(n: number): string {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * Top three on whatever the dropdowns are asking for.
 *
 * Deliberately renders even with nobody on it, unlike most empty states here:
 * the dropdowns live in this card, and a component that disappears when its
 * metric has no winners takes the only means of choosing a different metric
 * away with it.
 *
 * `scale` is the one concession to the wall monitor. It multiplies the block
 * heights and the type, because the same podium is read from eighteen inches at
 * the register and from across a workshop on a television, and a board nobody
 * can read from where they are standing is a board nobody looks at.
 *
 * `allBlocks` is the other difference between the two screens. The register cuts
 * at three and hides the rest behind the eye, because it is a working screen
 * where the podium is one card among several and the question is who is winning.
 * The wall is the shop looking at itself: everybody gets a block, in one row,
 * descending. Fourth place as a line in a table below the picture is not being
 * on the board, and the point of hanging it up is that every man on the floor
 * can find himself on it from where he is standing.
 */
export function Podium({
  title,
  span,
  unit,
  entries,
  control,
  showAll = false,
  onToggleAll,
  scale = 1,
  dark = false,
  allBlocks = false,
  className,
}: {
  title: string;
  span: string;
  unit: string;
  entries: PodiumEntry[];
  control?: React.ReactNode;
  showAll?: boolean;
  onToggleAll?: () => void;
  scale?: number;
  dark?: boolean;
  allBlocks?: boolean;
  /** For a caller that owns the spacing around it — see wall mode. */
  className?: string;
}) {
  const medals = [
    { bg: "linear-gradient(160deg,#f7e08a,#d4af37)", fg: "#4a3803", h: 132, label: "1st" },
    { bg: "linear-gradient(160deg,#e6ebf0,#a8b3bd)", fg: "#3a4149", h: 108, label: "2nd" },
    { bg: "linear-gradient(160deg,#e0b48c,#c08457)", fg: "#4a2c12", h: 92, label: "3rd" },
  ];
  /**
   * The medal beside the name, for the top three who actually scored.
   *
   * The blocks are already gold, silver and bronze, so this is saying a second
   * time what the colour says — on purpose. The colour only means anything
   * beside the other two, which is fine on the wall and useless in the ticket
   * list below it, where the same three names turn up one at a time with
   * nothing to compare against. Carrying the medal up here as well is what
   * makes the two halves of the board obviously the same three people.
   */
  const medal = (i: number) => (i < 3 && (top[i]?.score ?? 0) > 0 ? MEDALS[i] : "");
  const top = allBlocks ? entries : entries.slice(0, 3);
  const order = podiumOrder(top.length);
  const rest = allBlocks ? [] : entries.slice(3);

  /**
   * How much the type has to give so a shopful fits one row.
   *
   * Six across is where a full-width block stops fitting a wall monitor, and the
   * shop has run thirteen technicians before now, so this cannot be sized for
   * the three or four working today. Past six everything comes down together and
   * the line of counts under each name goes with it: from across a workshop the
   * name and the number are the whole message, and a caption nobody can read
   * only costs the number the room it needed.
   */
  const crowded = allBlocks && top.length > 6;
  const fit = allBlocks ? Math.min(1, 6 / Math.max(top.length, 1)) : 1;
  const nameFs = Math.max(14, 16 * scale * fit);
  const valueFs = Math.max(18, 30 * scale * fit);
  const labelFs = Math.max(9, 11 * Math.min(scale, 1.8) * fit);

  /**
   * Bronze steps down to last place, and last place is exactly as short as the
   * type inside it allows — measured from the figures above rather than picked,
   * because a floor guessed in pixels is a floor that clips the number the
   * moment somebody changes `scale` or the shop hires a fourth technician. The
   * 1.6 is the label's line box; the 14 is the pair of gaps around it.
   */
  const minH = (valueFs + labelFs * 1.6 + 14) / scale;
  const step = allBlocks && top.length > 3 ? (92 - minH) / (top.length - 3) : 9;

  // Past bronze the blocks stop being medals and just keep stepping down, so the
  // order still reads at a glance. Rank, not the figure — a block sized to a
  // value would leave whoever sold one tire with a sliver nobody can put a
  // number on, and the number is the thing being checked.
  const block = (i: number) =>
    medals[i] ?? {
      bg: dark ? "rgba(255,255,255,0.10)" : "#e8edf2",
      fg: dark ? "rgba(255,255,255,0.88)" : "#0a2540",
      h: Math.max(minH, 92 - (i - 2) * step),
      label: ordinal(i + 1),
    };

  const muted = dark ? "rgba(255,255,255,0.55)" : undefined;
  const strong = dark ? "#fff" : undefined;

  return (
    <div
      className={`rounded-2xl shadow-sm p-4 mb-6 ${className ?? ""}`}
      style={{
        background: dark ? "rgba(255,255,255,0.05)" : "#fff",
        border: dark ? "1px solid rgba(255,255,255,0.10)" : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          {/* What the podium is actually ranking, and it is not a caption.
              Read from across the shop, three names on a podium mean nothing
              until you know whether they are up there for tickets, for tips or
              for takings — so the line that says which is the first thing that
              has to be legible, not the last. Full white and bold against the
              muted date under it, which IS a caption.

              White only on the dark board. On a light card it would be a line
              of nothing, and the muted brand colour stays right there. */}
          <div
            className="text-xs uppercase tracking-wider text-brand-300"
            style={{
              color: dark ? "#fff" : muted,
              fontWeight: 700,
              fontSize: 14 * Math.min(scale, 1.6),
            }}
          >
            {title}
          </div>
          <div
            className="text-xs text-brand-300 opacity-70 mt-0.5"
            style={{ color: muted, fontSize: 12 * Math.min(scale, 1.6) }}
          >
            {span}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Only offered when there is a fourth person to show. An eye that
              opens nothing is a control that teaches people it does nothing. */}
          {rest.length > 0 && (
            <button
              type="button"
              onClick={onToggleAll}
              title={
                showAll ? "Back to the top three" : `Show all ${entries.length} who placed`
              }
              aria-label={showAll ? "Show the top three" : "Show everybody who placed"}
              aria-pressed={showAll}
              className="rounded-lg flex items-center justify-center"
              style={{
                height: 32,
                width: 34,
                border: dark
                  ? "1px solid rgba(255,255,255,0.25)"
                  : "1px solid rgba(10,37,64,0.18)",
                background: showAll ? (dark ? "#fff" : "#0a2540") : dark ? "transparent" : "#fff",
                color: showAll
                  ? dark
                    ? "#0a2540"
                    : "#fff"
                  : dark
                    ? "rgba(255,255,255,0.65)"
                    : "rgba(10,37,64,0.55)",
              }}
            >
              <EyeIcon open={showAll} />
            </button>
          )}
          {control}
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="py-8 text-center text-brand-300 text-sm" style={{ color: muted }}>
          Nobody has placed on this yet.
        </div>
      ) : (
        <div className="flex items-end justify-center gap-4" style={{ gap: crowded ? 8 : undefined }}>
          {order.map((i) => {
            const e = top[i];
            const m = block(i);
            return (
              <div
                key={e.employeeId}
                className="flex flex-col items-center"
                style={
                  // Fixed width for three; share the row for a shopful. Eight
                  // blocks at the register's width would run off any monitor.
                  allBlocks
                    ? { flex: "1 1 0", minWidth: 0, maxWidth: 170 * scale }
                    : { width: 170 * scale }
                }
              >
                <div
                  className="font-semibold text-brand-500 text-center"
                  style={{ color: strong, fontSize: nameFs }}
                >
                  {medal(i) && <span style={{ fontSize: nameFs * 1.15 }}>{medal(i)} </span>}
                  {e.name}
                </div>
                {!crowded && (
                  <div
                    className="text-xs text-brand-300 mb-2 text-center"
                    style={{ color: muted, fontSize: 12 * Math.min(scale, 1.6) }}
                  >
                    {e.sub}
                  </div>
                )}
                <div
                  className="w-full rounded-t-xl flex flex-col items-center justify-center"
                  style={{
                    background: m.bg,
                    color: m.fg,
                    height: m.h * scale,
                    marginTop: crowded ? 8 : undefined,
                  }}
                >
                  <div
                    className="font-bold tabular-nums leading-none"
                    style={{ fontSize: valueFs }}
                  >
                    {e.value}
                  </div>
                  <div
                    className="uppercase tracking-wider mt-1 opacity-80"
                    style={{ fontSize: labelFs }}
                  >
                    {/* The unit goes when the row is crowded. It is already in
                        the title above, and it is what pushes a short label
                        onto three lines inside a block that has no room. */}
                    {crowded ? m.label : `${m.label} · ${unit}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fourth downwards, as a list rather than more blocks.
          Past third the question stops being "who won" and becomes "where am
          I", and a list answers that in a way five diminishing coloured boxes
          never could — the places are numbered, the figures line up in a
          column, and it costs about as much height as one more block. */}
      {showAll && rest.length > 0 && (
        <div
          className="mt-5 pt-4"
          style={{
            borderTop: dark
              ? "1px solid rgba(255,255,255,0.12)"
              : "1px solid rgba(10,37,64,0.08)",
          }}
        >
          <table className="w-full text-sm" style={{ fontSize: 14 * Math.min(scale, 1.5) }}>
            <tbody>
              {rest.map((e, i) => (
                <tr
                  key={e.employeeId}
                  style={{
                    borderTop: dark
                      ? "1px solid rgba(255,255,255,0.10)"
                      : "1px solid rgba(0,0,0,0.05)",
                  }}
                >
                  <td className="py-2 text-brand-300 tabular-nums" style={{ width: 44, color: muted }}>
                    {i + 4}
                  </td>
                  <td className="py-2 font-medium text-brand-500" style={{ color: strong }}>
                    {e.name}
                  </td>
                  <td className="py-2 text-xs text-brand-300" style={{ color: muted }}>
                    {e.sub}
                  </td>
                  <td className="py-2 text-right tabular-nums font-semibold" style={{ color: strong }}>
                    {e.value}
                    <span className="text-xs font-normal" style={{ color: muted }}> {unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The eye. Open when the thing behind it is showing, struck through when it is
 * not — the slash is what makes the two states tell apart at a glance, since an
 * eye on its own reads as "look here" either way.
 */
export function EyeIcon({ open, size = 18 }: { open: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
      {!open && <path d="M4 20 20 4" />}
    </svg>
  );
}
