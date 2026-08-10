"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EyeIcon,
  PODIUM_METRICS,
  PODIUM_PERIODS,
  Podium,
  rankBy,
  readPref,
  writePref,
} from "@/components/pos/Podium";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { formatCents } from "@/lib/money";
import type { RecentTicket, Standings, StandingsPeriod } from "@/lib/leaderboard";

/**
 * The board on the wall.
 *
 * A screen of its own, hung where the floor can see it, with nobody standing in
 * front of it. Everything here follows from that: no PIN, because a board you
 * sign in to read is a board nobody reads; big type, because it is read from
 * across a workshop; dark, because it is on all day next to a bay door; and it
 * refreshes itself, because there is nobody there to press anything.
 *
 * Two questions it answers, in the order the shop asks them:
 *
 *   Who is ahead — the podium, the same component and the same categories as the
 *   register's, so the wall and the counter can never give two answers.
 *
 *   Did that ticket go through right — today's tickets, newest first, big, with
 *   what they were rung for and who they were rung against. This is the floor's
 *   own check on the register, and it is the reason the totals are the largest
 *   thing on the screen: a $80 job rung as $8 is obvious to the man who did it
 *   and invisible in a month-end report. Today's only: yesterday's work pushing
 *   this morning's off the bottom is the one way this list could mislead.
 *
 * Tips are the delicate part. They are shown as a share of the shop's tips, not
 * in dollars, because a customer waiting on a tire can read this screen and a
 * customer who learns what the technicians made today may decide to keep his
 * five dollars. The eye puts the dollars up for whoever asked — and takes them
 * down again on its own, see `REVEAL_MS`, because the failure mode of that
 * button is somebody pressing it and walking away.
 */

type PublicBoard = Omit<Standings, "techs"> & { techs: Standings["techs"] };

type Data = {
  today: string;
  boards: Record<StandingsPeriod, PublicBoard>;
  tickets: RecentTicket[];
};

/** How long the dollars stay up after somebody asks for them. */
const REVEAL_MS = 60_000;

/** How often the board re-asks. Nobody is here to press F5. */
const REFRESH_MS = 30_000;

/**
 * The canvas wall mode is laid out on: a 1080p panel, exactly.
 *
 * Named as a pair of constants and used as literal pixels rather than as
 * percentages of the window, because the arrangement inside was composed
 * against these two numbers — the podium is full width because 1920 is enough
 * for a row of blocks, the tickets are two columns because 1920 is enough for
 * two, and twelve of them come to 1080 minus the header. Composed against a
 * variable viewport it would be none of those things.
 *
 * On a screen that is not 1080p the whole canvas is scaled to fit, so the
 * proportions hold and only the size changes.
 */
const TV_WIDTH = 1920;
const TV_HEIGHT = 1080;

/**
 * One ticket row on the wall, tipped or not — see where it is applied.
 *
 * Named because the arithmetic that decides everything else on this screen runs
 * through it: four rows of this plus the panel's own heading is what the ticket
 * list needs, and what is left over is what the podium above it is allowed to
 * be. Change this and `TV_PODIUM` is the number that has to give.
 */
const TV_ROW = 112;

/**
 * How big the podium is on the wall.
 *
 * Sized to what is left after the ticket list has taken its four rows, not
 * chosen for looks — the blocks are capped at `170 * scale` each, so a scale
 * this side of 1.6 leaves a shop of four filling half of 1920 with empty navy
 * beside it, and the other side of 1.6 starts eating rows off the list below.
 */
const TV_PODIUM = 1.6;

function shortDate(businessDate: string): string {
  const [y, m, d] = businessDate.split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
}

function shortTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function WallLeaderboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [showTipCash, setShowTipCash] = useState(false);

  // Its own keys, not the register's. The wall and the counter are two screens
  // watching two different questions on purpose — see `readPref`.
  const [metricKey, setMetricKey] = useState(() =>
    readPref("wall.podium.metric", PODIUM_METRICS.map((m) => m.key), "tires"),
  );
  const [period, setPeriod] = useState<StandingsPeriod>(
    () => readPref("wall.podium.period", PODIUM_PERIODS, "week") as StandingsPeriod,
  );

  /**
   * Wall mode: the whole board laid out for the panel over the bay door.
   *
   * Not the same idea as shrinking the ordinary page until it fits, which is
   * what this button used to do. That took a layout built for a browser window
   * — one narrow column, the podium above the tickets, half the width empty —
   * and made all of it smaller. Everything was on screen and nothing was any
   * easier to read from the floor, which is the only thing this screen is for.
   *
   * So wall mode is a second arrangement rather than a smaller first one. The
   * podium goes full width, where a row of blocks belongs; the tickets go into
   * two columns underneath, at full size rather than shrunk to make them all
   * fit; tonight's tips take the corner the list was never going to use.
   * Nothing is cropped and nothing scrolls, because the canvas is a fixed
   * 1920×1080 and everything on it was sized against those two numbers — see
   * `TV_ROW` and `TV_PODIUM`, which are the two that had to agree.
   *
   * Off by default and remembered per screen — the same page gets opened on a
   * phone to settle an argument, and that is not what this is.
   */
  const [tv, setTv] = useState(() => {
    /**
     * `?wall=1` turns it on without anybody clicking anything.
     *
     * The button is fine for trying it, but the screen this mode exists for is
     * a panel with no keyboard and no mouse, driven by whatever stick or player
     * is taped to the back of it. Those things open a URL on boot and that is
     * the whole of their configuration — so the URL has to be able to say what
     * the screen is, or somebody has to find a mouse every time the power
     * blinks.
     *
     * It does NOT write the pref. A link pasted into a chat gets opened on a
     * phone once, and a URL that quietly rewrote how that browser shows the
     * board from then on would be a link with a side effect. The param says
     * what THIS page load is; the button is what sets a screen permanently.
     */
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("wall") === "1"
    )
      return true;
    return readPref("wall.tv", ["on", "off"], "off") === "on";
  });
  const [scale, setScale] = useState(1);

  /**
   * One division, and no measuring at all.
   *
   * The canvas is exactly 1920×1080 whatever is on it, so the scale is the
   * ratio of the screen to that and nothing else — 1.0 on the panel it was
   * built for, and correctly proportioned on anything else. The old version had
   * to measure its own content and was one feedback loop away from oscillating;
   * a fixed canvas cannot have that problem, because nothing inside it can
   * change its size.
   */
  useEffect(() => {
    if (!tv) {
      setScale(1);
      return;
    }
    const fitToScreen = () =>
      setScale(Math.min(window.innerWidth / TV_WIDTH, window.innerHeight / TV_HEIGHT));
    fitToScreen();
    window.addEventListener("resize", fitToScreen);
    return () => window.removeEventListener("resize", fitToScreen);
  }, [tv]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/public/leaderboard");
      if (!res.ok) {
        setError(true);
        return;
      }
      setData(await res.json());
      setError(false);
    } catch {
      // A board that blanks itself because one poll missed is worse than one
      // showing figures a minute old, so the last good data stays on screen and
      // only the stamp in the corner goes red.
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  /**
   * The dollars put themselves away.
   *
   * Without this the eye is a trap: a technician asks to see the figures at
   * eleven, walks off, and the shop spends the afternoon showing every customer
   * in the waiting area what its people earn in tips — which is the exact thing
   * the percentages are there to prevent.
   */
  const revealedAt = useRef(0);
  useEffect(() => {
    if (!showTipCash) return;
    revealedAt.current = Date.now();
    const id = setTimeout(() => setShowTipCash(false), REVEAL_MS);
    return () => clearTimeout(id);
  }, [showTipCash]);

  if (!data) {
    return (
      <div style={shell} className="flex items-center justify-center">
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 24 }}>
          {error ? "Cannot reach the register." : "Loading…"}
        </div>
      </div>
    );
  }

  const board = data.boards[period];
  const metric = PODIUM_METRICS.find((m) => m.key === metricKey) ?? PODIUM_METRICS[0];

  const tipText = (cents: number, pct: number) =>
    showTipCash ? formatCents(cents) : `${pct.toFixed(1)}%`;

  /**
   * Only the people who are on something.
   *
   * A block is a placing, and nothing is not a placing. Zeros were on here so
   * that a man who came fourth of eight could still find himself, but what it
   * actually produced was a row of blocks reading 0 next to the winner's — and
   * standing under "Employee of the week" with a zero on your name in the
   * largest type in the building is not a nudge, it is a notice board. Ask the
   * board for used tires on a week when two were sold and eleven men are being
   * shown their nothing.
   *
   * Nobody is missing from the shop's own knowledge because of this; the
   * technician who has not scored is not on the board because there is nothing
   * to say about him yet, which is the honest version of the same fact.
   */
  const entries = rankBy(board.techs, metric, {
    // No dollars ever reach this page for income — the endpoint zeroes them —
    // so the share is not a choice here, it is the only figure there is.
    income: (_cents, pct) => `${pct.toFixed(1)}%`,
    tips: tipText,
  });

  /**
   * Today's tips, whatever the podium above is set to.
   *
   * Deliberately not `board` — this strip does not follow the period dropdown
   * and should not. It answers "what am I taking home tonight", which is a
   * question about today and only today; a technician reading his own number
   * off the wall at closing time will read it as today's whether or not the
   * heading says month, and pocket-money that turns out to be four weeks of it
   * is the kind of wrong that ends in an argument about wages. The podium's own
   * tips categories still follow the period, because a podium is a standing.
   */
  const tipped = data.boards.day.techs
    .filter((t) => t.tipCents > 0)
    .sort((a, b) => b.tipCents - a.tipCents);

  /**
   * How many tickets the wall has room for, at full size.
   *
   * Eight rather than the twelve the server sends: two columns of four, which
   * is what the panel holds once the podium above it has taken its share. Cut
   * here rather than left to `overflow` to clip, because a list that ends is a
   * list and a list whose last row is sliced through the middle by the edge of
   * the screen reads as a broken board.
   *
   * Sized for the worst row rather than the usual one. A tipped ticket is
   * taller than a plain one — it carries the gold badge — so a count that fits
   * on a quiet morning overflows the first afternoon four people get tipped,
   * and it would overflow silently. Four rows of tipped tickets still fit with
   * room to spare, so this number cannot come apart on a good day.
   *
   * The four that come off are the oldest, which on a newest-first list is the
   * right end to lose: this panel is the floor's check that what they just did
   * was rung correctly, and nobody is checking the ticket from two hours ago.
   */
  const ticketsShown = tv ? data.tickets.slice(0, 8) : data.tickets;

  return (
    <div style={tv ? { ...shell, position: "fixed", inset: 0, overflow: "hidden" } : shell}>
      {/* Scaled from the top-left and pulled back by half of what it came to.
          `transform-origin: top center` would do the centring on its own, but
          only if you trust a percentage translate against a scaled box; half of
          a size that is already known is arithmetic that cannot drift. */}
      <div
        className={tv ? "flex flex-col" : "mx-auto px-6 py-5"}
        style={
          tv
            ? {
                position: "absolute",
                top: "50%",
                left: "50%",
                width: TV_WIDTH,
                height: TV_HEIGHT,
                marginLeft: -(TV_WIDTH * scale) / 2,
                marginTop: -(TV_HEIGHT * scale) / 2,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                padding: "28px 36px 28px",
                gap: 16,
              }
            : { maxWidth: 1600 }
        }
      >
        <div
          className={`flex items-end justify-between gap-4 flex-wrap ${tv ? "" : "mb-5"}`}
        >
          {/* The badge, at the size the wall reads it from.
              This screen hangs where a customer waiting on a tire can see it as
              easily as the floor can, and a dark panel of numbers with no mark
              on it does not obviously belong to anybody. */}
          <div className="flex items-center gap-4">
            <ShopLogo size={72} priority />
            <div>
              <h1 style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>
                Casias Tire Shop
              </h1>
              <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 16, marginTop: 4 }}>
                {shortDate(data.today)}
                {error && (
                  <span style={{ color: "#fca5a5" }}> · not updating</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Icon only, and no label, unlike the eye below it.
                The eye is offered to whoever walks up and asks a question of
                the board. This is not that — it is set once by whoever hangs
                the screen and then never touched again, so it earns a shape and
                not a sentence. The title carries the words for the one person
                who ever goes looking for it. */}
            <button
              type="button"
              onClick={() => {
                setTv((v) => {
                  writePref("wall.tv", v ? "off" : "on");
                  return !v;
                });
              }}
              aria-pressed={tv}
              aria-label="Lay the board out for the wall screen"
              title={
                tv
                  ? "Laid out for the wall. Click to go back to the normal page."
                  : "Lay the board out for the wall screen"
              }
              className="flex items-center justify-center rounded-lg shrink-0"
              style={{
                height: 36,
                width: 36,
                border: "1px solid rgba(255,255,255,0.25)",
                background: tv ? "#fff" : "transparent",
                color: tv ? "#0a2540" : "rgba(255,255,255,0.7)",
              }}
            >
              <FitIcon size={18} />
            </button>
            <select
              value={metric.key}
              onChange={(e) => {
                setMetricKey(e.target.value);
                writePref("wall.podium.metric", e.target.value);
              }}
              style={selectStyle}
            >
              {PODIUM_METRICS.map((m) => (
                <option key={m.key} value={m.key} style={optionStyle}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as StandingsPeriod);
                writePref("wall.podium.period", e.target.value);
              }}
              style={selectStyle}
            >
              <option value="day" style={optionStyle}>Today</option>
              <option value="week" style={optionStyle}>This week</option>
              <option value="month" style={optionStyle}>This month</option>
            </select>
          </div>
        </div>

        {/* Bigger on the wall, because there the width is real.
            The blocks are capped at `170 * scale` each, so at the browser's 1.5
            a shop of four fills about half of 1920 and the rest of the top of
            the screen is empty navy. See `TV_PODIUM` for why it is the number
            it is — the ticket list below gets its four rows first. */}
        <Podium
          dark
          scale={tv ? TV_PODIUM : 1.5}
          className={tv ? "!mb-0" : undefined}
          title={`Employee of the ${period} — ${metric.label.toLowerCase()}`}
          span={
            board.range.start === board.range.end
              ? shortDate(board.range.start)
              : `${shortDate(board.range.start)} – ${shortDate(board.range.end)}`
          }
          unit={metric.unit}
          entries={entries}
          allBlocks
        />

        {/* Tonight's tips and tonight's tickets, side by side on the wall.
            Stacked, they are why this screen ever needed shrinking: a podium
            and two full-width panels in one column is taller than any monitor,
            and while it runs off the bottom most of 1920 sits empty beside it.
            Across, the tips take a corner the ticket list was never going to
            use and the list gets the width to run two columns at full size. */}
        <div
          className={tv ? "grid min-h-0" : undefined}
          style={
            tv
              ? {
                  gridTemplateColumns: tipped.length > 0 ? "380px 1fr" : "1fr",
                  gap: 24,
                  flex: 1,
                  minHeight: 0,
                }
              : undefined
          }
        >
        {tipped.length > 0 && (
          <div
            style={panel}
            className={tv ? "min-h-0 overflow-hidden flex flex-col" : "mb-6"}
          >
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div style={label}>Tips today</div>
              {/* The eye, labelled. An unlabelled icon on a screen read from
                  twenty feet is a shape; the words are what tell somebody
                  walking up that there is a number behind it to ask for. */}
              <button
                type="button"
                onClick={() => setShowTipCash((v) => !v)}
                aria-pressed={showTipCash}
                className="flex items-center gap-2 rounded-lg px-3"
                style={{
                  height: 36,
                  fontSize: 14,
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: showTipCash ? "#fff" : "transparent",
                  color: showTipCash ? "#0a2540" : "rgba(255,255,255,0.7)",
                }}
              >
                <EyeIcon open={showTipCash} size={16} />
                {showTipCash ? "Hide the dollars" : "Show the dollars"}
              </button>
            </div>
            {/* A column on the wall, a wrapping row everywhere else.
                Stacked, each figure sits over its own name and the three read
                as three; wrapped across a 380px corner they would run together
                into a paragraph of numbers.

                Centred in what is left of the panel rather than stacked under
                the heading. How many names are on this list changes through the
                day — one at ten, four by five — and pinned to the top it leaves
                a hole underneath that grows as the list shrinks, so the corner
                of the wall reads as something that failed to load. Centred, a
                short list is simply a short list. */}
            <div
              className={
                tv
                  ? "flex flex-col gap-y-5 flex-1 min-h-0 justify-center"
                  : "flex flex-wrap justify-center gap-x-10 gap-y-4"
              }
            >
              {tipped.map((t) => (
                <div key={t.employeeId} className="text-center">
                  <div
                    className="tabular-nums font-bold leading-none"
                    style={{ fontSize: 46 }}
                  >
                    {tipText(t.tipCents, t.tipPct)}
                  </div>
                  {/* Sized to be read from where the technicians actually read
                      it, which is on the way past rather than standing in front
                      of it. The figure above is the loud part, but a figure
                      nobody can attach to a name is not an answer to the
                      question anybody is asking of this strip — which is "is
                      one of those mine". Bright enough to survive the distance
                      too: at 60% white it greyed out well before the digits
                      did, so the number arrived without its owner. */}
                  <div style={{ color: "rgba(255,255,255,0.88)", fontSize: 28, fontWeight: 600, marginTop: 6 }}>
                    {t.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={panel}
          className={tv ? "min-h-0 overflow-hidden" : undefined}
        >
          <div style={label} className="mb-3">
            Last tickets rung
          </div>
          {data.tickets.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 18, padding: "24px 0" }}>
              Nothing rung yet.
            </div>
          ) : (
            /* Two columns on the wall, said in a style rather than in `xl:`.
               Tailwind's breakpoints ask the VIEWPORT how wide it is, and in
               wall mode the viewport is not what the tickets are laid out in —
               the canvas is 1920 whatever window it has been scaled into, so on
               a laptop `xl:` would answer "narrow" about a board that is not.
               The banding has to leave the class list for the same reason, and
               is worked out per row below. */
            <div
              className={tv ? "grid" : "grid grid-cols-1 xl:grid-cols-2 gap-x-10"}
              style={
                tv
                  ? { gridTemplateColumns: "1fr 1fr", columnGap: 40 }
                  : undefined
              }
            >
              {ticketsShown.map((t, i) => (
                <div
                  key={t.saleNo}
                  /* Banded so the eye can carry a total across to the time
                     without losing the row. The stripe follows the grid ROW,
                     not the child index — in two columns a plain odd/even
                     would checkerboard, and a checkerboard is the one pattern
                     that makes a row harder to follow rather than easier.

                     Banded HARD, at a weight that would be crude on a screen
                     somebody is sitting in front of. Nobody is sitting in front
                     of this one. It is read in passing, from several metres, by
                     a man walking back to a bay, and a stripe he cannot resolve
                     from there is not a subtle stripe — it is a plain one. */
                  /* `min-w-0` is load-bearing and was the whole bug.
                     This row is a GRID ITEM, and a grid item's default
                     `min-width: auto` means it refuses to shrink below its
                     longest unbreakable line. The description is `nowrap`, so a
                     four-tire ticket — "VANTAGE A/S UHP 91W 215-45-17" four
                     times over — made the column as wide as that string and
                     shoved the second column off the screen. `truncate` on the
                     text could never fire, because nothing above it was ever
                     narrower than the text. */
                  className={
                    tv
                      ? "flex items-baseline gap-4 py-3 px-3 -mx-3 min-w-0"
                      : "flex items-baseline gap-4 py-3 px-3 -mx-3 min-w-0 max-xl:odd:bg-white/[0.10] xl:[&:nth-child(4n+1)]:bg-white/[0.10] xl:[&:nth-child(4n+2)]:bg-white/[0.10]"
                  }
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.10)",
                    opacity: t.voided ? 0.4 : 1,
                    // Wall mode's band, worked out rather than selected: two
                    // across means the row is the pair, so shade whole pairs.
                    ...(tv && Math.floor(i / 2) % 2 === 0
                      ? { background: "rgba(255,255,255,0.10)" }
                      : {}),
                    /* Every wall row the height of a tipped one, tip or no tip.
                       A tip adds the gold badge and about sixteen pixels with
                       it, so on a screen sized to the row exactly, how much of
                       the list fits would depend on how good the tipping was
                       that afternoon — and the day it stopped fitting is the
                       day it would quietly drop a ticket off the bottom. Paying
                       for the badge on every row buys a list whose height is
                       known before it is filled, and squares the two columns up
                       against each other while it is at it. */
                    ...(tv ? { minHeight: TV_ROW } : {}),
                    /* A tipped ticket is the one thing on this board somebody
                       crosses a workshop to check, so it is lit up rather than
                       marked: gold fill, a thick gold edge, and the amount
                       itself in a gold badge further down.

                       Gold because it is already this board's word for money
                       somebody earned — it is the podium's colour — so nobody
                       has to be taught what it means. The fill overrides the
                       banding on these rows and is meant to: the bands exist so
                       the eye can carry a total across to the time, and on a
                       tipped row the thing the eye is carrying is the tip. */
                    ...(t.tipCents > 0 && !t.voided
                      ? {
                          background: "rgba(255,200,61,0.14)",
                          borderLeft: "6px solid #ffc83d",
                        }
                      : { borderLeft: "6px solid transparent" }),
                  }}
                >
                  {/* Sized to its contents rather than pinned at 156px.
                      A four-tire ticket runs to $1,240.00, which is wider than
                      156 at 34px — so the total spilled over the name beside
                      it. Now the column takes the room the figure needs and the
                      names give it up, which is the right way round: the money
                      is the thing this list exists to check. */}
                  <div
                    className="shrink-0 text-right whitespace-nowrap"
                    style={{ minWidth: 156 }}
                  >
                    <div
                      className="tabular-nums font-bold"
                      style={{
                        fontSize: 34,
                        textDecoration: t.voided ? "line-through" : undefined,
                      }}
                    >
                      {formatCents(t.totalCents)}
                    </div>
                    {/* The tip under the total, in the same column, because the
                        question it answers is about this ticket's money. Said
                        as an amount rather than a mark — "there was a tip" is
                        not what anybody wants to know.

                        Solid gold rather than gold type, and near the size of
                        the total itself. Gold text on navy at fifteen pixels
                        was legible at a desk and gone by the second bay; a
                        filled badge holds its shape long after the digits
                        inside it stop resolving, so from the far end of the
                        shop it still says there was a tip, and two steps closer
                        it says how much. */}
                    {t.tipCents > 0 && !t.voided && (
                      <div
                        className="tabular-nums font-bold inline-block rounded-lg mt-1"
                        style={{
                          background: "#ffc83d",
                          color: "#3d2c00",
                          fontSize: 24,
                          lineHeight: 1.1,
                          padding: "3px 10px",
                        }}
                      >
                        +{formatCents(t.tipCents)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* The name is what a technician walking past is looking
                        for — he finds himself first and reads the money second
                        — so it is sized to be found from where he is walking,
                        not to sit politely under the total.

                        No medals down here, deliberately. They are the podium's
                        and they stay there: beside a total, three names in a
                        row wearing gold, silver and bronze read as a ranking of
                        those three tickets, which is not a thing this list is
                        saying. */}
                    {/* Clipped to one line, like the description under it.
                        A four-tire ticket can carry three fitters, a "fitted
                        by" and a "voided", and at 26px that wrapped to three
                        lines — which pushed the row past the height every other
                        row is fixed at and walked the whole column out of
                        alignment. One name found from across the shop is worth
                        more than three names nobody can read anyway. */}
                    <div className="truncate" style={{ fontSize: 26, fontWeight: 700 }}>
                      {t.techs || (
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>—</span>
                      )}
                      {/* Who bolted them on, when it was not who sold them.
                          Its own colour — blue against the white of the seller
                          — because these are two different people doing two
                          different jobs on one ticket, and running both names
                          together in one weight is how the credit gets read as
                          one man's. Absent on the overwhelming majority of
                          tickets, where the two are the same person. */}
                      {t.fitters && (
                        <span style={{ color: "#7dd3fc", fontSize: 19, fontWeight: 500 }}>
                          {" "}
                          · fitted by {t.fitters}
                        </span>
                      )}
                      {t.voided && (
                        <span style={{ color: "#fca5a5", fontSize: 19, fontWeight: 400 }}>
                          {" "}
                          · voided
                        </span>
                      )}
                    </div>
                    <div
                      className="truncate"
                      style={{ color: "rgba(255,255,255,0.55)", fontSize: 15 }}
                      title={t.what}
                    >
                      {t.what || "—"}
                    </div>
                  </div>
                  <div
                    className="tabular-nums shrink-0 text-right"
                    style={{ color: "rgba(255,255,255,0.4)", fontSize: 15, width: 110 }}
                  >
                    {shortTime(t.at)}
                    <div style={{ fontSize: 12 }}>{t.saleNo.replace(/^S-\d{4}-0*/, "#")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Four corner brackets — the mark every screen in the building already uses for
 * "make this fill the frame", on a TV remote as much as in a video player.
 * Drawn as brackets rather than as arrows because arrows have to point either
 * in or out, and this button does both depending on the screen it lands on.
 */
function FitIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}

const shell: React.CSSProperties = {
  background: "#0a2540",
  color: "#fff",
  minHeight: "100vh",
};

const panel: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 16,
};

/**
 * The two panel headings on the board — Tips today, Last tickets rung.
 *
 * Full white and bold, at the size they already were. Half-opacity white is the
 * right weight for a caption on a screen somebody is sitting in front of, and
 * the wrong one for a board read from across a shop floor: at that distance the
 * headings are how you know which of the two columns you are looking at, and a
 * heading you have to walk closer to read is doing the opposite of its job.
 *
 * The size is deliberately unchanged. These sit above lists whose rows are the
 * thing to read; a heading that grew would start competing with them.
 */
const label: React.CSSProperties = {
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

/**
 * Painted dark on purpose, both the box and the list inside it.
 *
 * These were transparent boxes with navy `<option>`s, which is navy text on a
 * navy wall — the two dropdowns were invisible from more than a few feet, and
 * nobody could tell what the board was even set to. The catch is that the
 * option colour is not only used in the popup list: Chrome paints the CLOSED
 * select with the selected option's own colour, so styling the options for a
 * white popup is what blanked the control on the board itself. Colouring both
 * ends the same way is the only version of this that cannot come apart.
 *
 * `colorScheme` is what gets the native arrow and the popup's own chrome to
 * come up dark too, rather than a white strip around a dark list.
 */
const selectStyle: React.CSSProperties = {
  height: 36,
  fontSize: 14,
  paddingInline: 10,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "#0a2540",
  color: "#fff",
  colorScheme: "dark",
};

/** The list inside, matched to the box. See `selectStyle`. */
const optionStyle: React.CSSProperties = { background: "#0a2540", color: "#fff" };
