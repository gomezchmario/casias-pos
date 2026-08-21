import { NextResponse } from "next/server";
import { recentTickets, standings, type Standings, type TechScore } from "@/lib/leaderboard";
import { currentBusinessDate } from "@/lib/business-date";
import { getDb } from "@/lib/db";
import { clockOf } from "@/lib/schedule";
import { getSetting } from "@/lib/settings";

/**
 * The board on the wall, with no login.
 *
 * Feeds one screen: a monitor hung where the floor can see it, showing who is
 * ahead and what has just been rung. It has no PIN for the same reason the
 * inventory sheet has none — a board the technicians have to sign in to read is
 * a board nobody reads, and the whole value of it is that somebody walking past
 * with their hands full can check it in two seconds.
 *
 * The whitelist below is the entire security model of this file, so it is
 * written out field by field rather than spread-and-delete. `{...t}` is one
 * careless refactor away from publishing the next column somebody adds to a
 * technician's row; naming the fields means a new one is private until somebody
 * deliberately types it here.
 *
 * Never on this endpoint:
 *   - `incomeCents`, `otherIncomeCents`, `totalIncomeCents` — what a technician
 *     brought in is one short step from what they are paid, and the register's
 *     own dashboard already gates those to the owner. Publishing them on an
 *     endpoint with no login would make that gate ornamental.
 *   - `incomePct` — the same figure by another name once the shop's total is
 *     known, and the shop's total is not the floor's business either. The
 *     podium never ranks on it, so nothing is lost.
 *
 * Tips ARE sent in dollars, deliberately, and this is the one judgement call
 * here. The shop asked for a board its technicians can check, and a tip is
 * their own money rather than a wage — the reason it is normally hidden is that
 * a customer might read it and think better of tipping, which is a question
 * about what is on the screen, not about what is in the response. So the page
 * shows shares by default and keeps the dollars behind a button somebody has to
 * press. On a machine that serves localhost only, that is where the line is.
 */

/** What a technician's row is allowed to say in public. */
function publicTech(t: TechScore, showTips: boolean) {
  return {
    employeeId: t.employeeId,
    name: t.name,
    newTires: t.newTires,
    usedTires: t.usedTires,
    otherCount: t.otherCount,
    ticketCount: t.ticketCount,
    /** A share of the service work, never the dollars behind it. */
    otherIncomePct: t.otherIncomePct,
    improvementPct: t.improvementPct,
    // With the tips corner switched off in the owner's settings, the tip
    // figures leave the RESPONSE, not just the screen — a wall monitor is
    // exactly the place where "hidden by CSS" means "published".
    tipCents: showTips ? t.tipCents : 0,
    tipPct: showTips ? t.tipPct : 0,
    // Zeroed rather than omitted, so the shared podium can rank and format a
    // public row with exactly the code it uses on the register. A second copy
    // of the board's rules is a second copy that can disagree with the first.
    incomeCents: 0,
    otherIncomeCents: 0,
    incomePct: 0,
    tipCentsToday: showTips ? t.tipCentsToday : 0,
    prior: {
      newTires: t.prior.newTires,
      usedTires: t.prior.usedTires,
      otherCount: t.prior.otherCount,
      incomeCents: 0,
    },
  };
}

function publicBoard(b: Standings, showTips: boolean) {
  return {
    period: b.period,
    range: b.range,
    priorRange: b.priorRange,
    totalIncomeCents: 0,
    totalOtherIncomeCents: 0,
    totalTipCents: showTips ? b.totalTipCents : 0,
    techs: b.techs.map((t) => publicTech(t, showTips)),
  };
}

/**
 * Who works a day, for the wall: first names and hours, nothing else. The
 * board hangs where the floor reads it at closing time, which is exactly when
 * "who is on tomorrow" gets asked of whoever happens to be standing there.
 */
function rosterFor(date: string): { name: string; hours: string }[] {
  return (
    getDb()
      .prepare(
        `SELECT e.name, s.start_minute AS a, s.end_minute AS b
           FROM schedule_shifts s
           JOIN employees e ON e.id = s.employee_id AND e.active = 1
          WHERE s.work_date = ?
          ORDER BY s.start_minute, e.name`,
      )
      .all(date) as { name: string; a: number; b: number }[]
  ).map((r) => ({ name: r.name, hours: `${clockOf(r.a)}–${clockOf(r.b)}` }));
}

export async function GET() {
  const date = currentBusinessDate();
  const showTips = getSetting("leaderboard_show_tips") !== "0";
  const tomorrow = (() => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + 1);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();

  // All three periods up front rather than one per request. These are indexed
  // aggregates over one shop's sales, and the board is a screen nobody stands
  // in front of — it must be able to switch what it is showing without waiting
  // on the network, since there is nobody there to wait.
  return NextResponse.json({
    today: date,
    showTips,
    boards: {
      day: publicBoard(standings(date, "day"), showTips),
      week: publicBoard(standings(date, "week"), showTips),
      month: publicBoard(standings(date, "month"), showTips),
    },
    // What has just been rung today, so the floor can check its own tickets.
    // Totals and names only — no customer, no phone, no note. Who bought the
    // tire is nobody else's business, and a name on a wall is the one thing on
    // this screen that could not be undone by turning the monitor off.
    tickets: recentTickets(date, 12),
    // The roster strip: today for "who else is coming", tomorrow for the
    // question the wall gets asked at closing time.
    roster: { today: rosterFor(date), tomorrow: rosterFor(tomorrow) },
  });
}
