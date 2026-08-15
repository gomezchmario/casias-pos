"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";

/**
 * The manager's first screen, rebuilt around the two questions a manager
 * actually opens it with: WHO IS IN, AND FOR HOW LONG — and WHO IS MISSING.
 *
 * The first version counted heads. Seven working, two on break, four cards in
 * a row — true, and none of it actionable, because a count has no names and no
 * clock on it. Every figure here now carries the thing a manager does with it:
 * the working list says since when and how long, the missing list says who was
 * rostered and has not shown, and the week chart says whether today is an odd
 * day or an ordinary one.
 *
 * LATENESS EXISTS BECAUSE THE SCHEDULE DOES. Until the roster was built there
 * was nothing to read the clock against — a no-show and an unrostered day
 * looked identical. This screen is where that investment pays out daily.
 *
 * It refreshes itself once a minute. A dashboard that shows the morning until
 * somebody presses F5 is a dashboard that gets stale exactly when it is being
 * glanced at across the counter.
 */

type EmployeeWithState = {
  id: number;
  name: string;
  role: string | null;
  active: number;
  current_state: "checked_out" | "checked_in" | "on_break";
  last_event_at: string | null;
};

type Data = {
  today: string;
  employees: EmployeeWithState[];
  hours: { employeeId: number; minutes: number; onTheClock: boolean; since: string | null }[];
  scheduled: { employeeId: number; name: string; startMinute: number; endMinute: number }[];
  late: { employeeId: number; name: string; startMinute: number }[];
  week: { day: string; minutes: number }[];
  flagged: number;
  recent: { id: number; type: string; timestamp: string; flagged: number; employee_name: string }[];
  flaggedEntries: {
    id: number;
    type: string;
    timestamp: string;
    flag_reason: string | null;
    employee_name: string;
  }[];
};

const TYPE_LABEL: Record<string, string> = {
  check_in: "Check in",
  check_out: "Check out",
  break_start: "Break start",
  break_end: "Break end",
};
const TYPE_TONE: Record<string, "success" | "info" | "warning" | "neutral"> = {
  check_in: "success",
  check_out: "info",
  break_start: "warning",
  break_end: "neutral",
};

const clockOfMinute = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm === 0 ? `${h12}${ampm}` : `${h12}:${String(mm).padStart(2, "0")}${ampm}`;
};

const timeOf = (ts: string) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const hoursOf = (minutes: number) => `${(minutes / 60).toFixed(1)} h`;

export default function DashboardPage() {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/admin/dashboard")
        .then((r) => r.json())
        .then(setData)
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const hoursBy = useMemo(
    () => new Map((data?.hours ?? []).map((h) => [h.employeeId, h])),
    [data],
  );

  if (!data) return <div className="text-brand-300">Loading…</div>;

  const active = data.employees.filter((e) => e.active === 1);
  const inNow = active.filter((e) => e.current_state !== "checked_out");
  const workedToday = data.hours.reduce((n, h) => n + h.minutes, 0);

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-brand-500 mb-1">Dashboard</h1>
          <p className="text-brand-400">Right now, and how today is going.</p>
        </div>
        <Link href="/admin/schedule" className="btn btn-outline" style={{ height: 36, fontSize: 13 }}>
          🗓 This week&apos;s schedule
        </Link>
      </div>

      {/*
        Who was rostered and has not shown. Above everything else, because it is
        the one card that is an instruction rather than a report — every name on
        it is a phone call. It disappears entirely when nobody is missing: an
        empty warning box teaches people to stop reading the box.
      */}
      {data.late.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl shadow-sm p-5 border-l-4 border-l-red-600">
          <h2 className="text-lg font-semibold text-red-700 mb-1">
            Expected in, not here yet
          </h2>
          <p className="text-sm text-brand-400 mb-2">
            On today&apos;s schedule, past their start by more than 15 minutes, and not clocked in.
          </p>
          <div className="flex flex-wrap gap-2">
            {data.late.map((l) => (
              <span
                key={l.employeeId}
                className="px-3 py-1.5 rounded-lg text-sm font-medium"
                style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }}
              >
                {l.name} · due {clockOfMinute(l.startMinute)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="In right now"
          value={`${inNow.length}`}
          sub={
            data.scheduled.length > 0
              ? `${data.scheduled.length} on today's schedule`
              : "nobody scheduled today"
          }
          tone="success"
        />
        <StatCard
          label="Hours so far today"
          value={hoursOf(workedToday)}
          sub={`${data.hours.length} ${data.hours.length === 1 ? "person" : "people"} clocked something`}
          tone="info"
        />
        <StatCard
          label="On break"
          value={`${active.filter((e) => e.current_state === "on_break").length}`}
          sub="right now"
          tone="warning"
        />
        <StatCard
          label="Flagged punches"
          value={`${data.flagged}`}
          sub={data.flagged > 0 ? "need a look" : "all clean"}
          tone={data.flagged > 0 ? "danger" : "neutral"}
          link="/admin/entries?flagged=true"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ── Who is in, and since when ─────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-brand-500">On the clock</h2>
            <Link href="/admin/entries" className="text-xs text-brand-400 hover:text-brand-500">
              All punches →
            </Link>
          </div>
          {inNow.length === 0 ? (
            <p className="text-sm text-brand-400">Nobody is clocked in right now.</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {inNow.map((e) => {
                const h = hoursBy.get(e.id);
                return (
                  <li key={e.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-brand-500 truncate">{e.name}</div>
                      <div className="text-xs text-brand-300">
                        {h?.since ? `in since ${timeOf(h.since)}` : e.role || "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-none">
                      {h && (
                        <span className="text-sm tabular-nums font-semibold text-brand-500">
                          {hoursOf(h.minutes)}
                        </span>
                      )}
                      <Badge tone={e.current_state === "checked_in" ? "success" : "warning"}>
                        {e.current_state === "checked_in" ? "Working" : "On break"}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* The rest of today's roster, so the list above has its context:
              who is DONE and who is YET TO COME are different absences. */}
          {data.scheduled.length > 0 && (
            <div className="mt-4 pt-3 border-t border-black/5">
              <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
                Today&apos;s schedule
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.scheduled.map((s) => {
                  const state = active.find((e) => e.id === s.employeeId)?.current_state;
                  const here = state && state !== "checked_out";
                  const worked = (hoursBy.get(s.employeeId)?.minutes ?? 0) > 0;
                  return (
                    <span
                      key={s.employeeId}
                      className="px-2 py-1 rounded-md text-xs"
                      style={{
                        background: here
                          ? "rgba(46,166,106,0.12)"
                          : worked
                            ? "rgba(10,37,64,0.06)"
                            : "rgba(10,37,64,0.04)",
                        color: here ? "#1c8c56" : "rgba(10,37,64,0.6)",
                      }}
                      title={`${clockOfMinute(s.startMinute)}–${clockOfMinute(s.endMinute)}`}
                    >
                      {s.name} · {clockOfMinute(s.startMinute)}
                      {!here && worked && " · done"}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── The week, and today's punches ─────────────────────────────── */}
        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <h2 className="text-lg font-semibold text-brand-500 mb-3">Hours this week</h2>
            <WeekBars week={data.week} today={data.today} />
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-brand-500">Today&apos;s punches</h2>
              <Link href="/admin/entries" className="text-xs text-brand-400 hover:text-brand-500">
                View all →
              </Link>
            </div>
            {data.recent.length === 0 ? (
              <p className="text-sm text-brand-400">No activity yet today.</p>
            ) : (
              <ul className="divide-y divide-black/5">
                {data.recent.map((e) => (
                  <li key={e.id} className="py-2 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge tone={TYPE_TONE[e.type]}>{TYPE_LABEL[e.type] || e.type}</Badge>
                      <span className="text-brand-500 font-medium truncate">
                        {e.employee_name}
                      </span>
                      {e.flagged === 1 && (
                        <Badge tone="danger" size="sm">
                          ⚠
                        </Badge>
                      )}
                    </div>
                    <span className="text-brand-300 tabular-nums flex-none">
                      {timeOf(e.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {data.flaggedEntries.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl shadow-sm p-5 border-l-4 border-l-red-500">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-brand-500">
              ⚠ Flagged punches needing review
            </h2>
            <Link
              href="/admin/entries?flagged=true"
              className="text-xs text-brand-400 hover:text-brand-500"
            >
              Review all →
            </Link>
          </div>
          <ul className="divide-y divide-black/5">
            {data.flaggedEntries.map((e) => (
              <li key={e.id} className="py-2 text-sm">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge tone={TYPE_TONE[e.type]}>{TYPE_LABEL[e.type]}</Badge>
                  <span className="font-medium text-brand-500">{e.employee_name}</span>
                  <span className="text-brand-300 tabular-nums">
                    {new Date(e.timestamp).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {e.flag_reason && (
                  <div className="text-xs text-brand-400 mt-1">{e.flag_reason}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Seven days of worked hours as bars, today outlined.
 *
 * Answers the one question the number cards cannot: is today ordinary? A short
 * Tuesday next to six tall days is a fact worth noticing at 11am, not at close.
 */
function WeekBars({ week, today }: { week: { day: string; minutes: number }[]; today: string }) {
  const days: { day: string; minutes: number }[] = [];
  const cursor = new Date(`${today}T00:00:00`);
  cursor.setDate(cursor.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    days.push({ day: iso, minutes: week.find((w) => w.day === iso)?.minutes ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  const max = Math.max(...days.map((d) => d.minutes), 60);

  return (
    <div className="flex items-end gap-2" style={{ height: 110 }}>
      {days.map((d) => {
        const isToday = d.day === today;
        const label = new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
        });
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
            <span className="text-[10px] tabular-nums text-brand-300">
              {d.minutes > 0 ? (d.minutes / 60).toFixed(1) : ""}
            </span>
            <div
              className="w-full rounded-t-md"
              style={{
                height: `${Math.max(3, (d.minutes / max) * 100)}%`,
                background: isToday ? "#0a2540" : "rgba(10,37,64,0.18)",
              }}
              title={`${label}: ${(d.minutes / 60).toFixed(1)} h`}
            />
            <span
              className="text-[10px]"
              style={{
                color: isToday ? "#0a2540" : "rgba(10,37,64,0.4)",
                fontWeight: isToday ? 700 : 400,
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
  link,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  link?: string;
}) {
  const colors: Record<typeof tone, { bg: string; fg: string }> = {
    info: { bg: "linear-gradient(135deg, #1f3f64 0%, #0a2540 100%)", fg: "#fff" },
    success: { bg: "linear-gradient(135deg, #2ea66a 0%, #1c8c56 100%)", fg: "#fff" },
    warning: { bg: "linear-gradient(135deg, #ffd35a 0%, #e0a91d 100%)", fg: "#0a2540" },
    danger: { bg: "linear-gradient(135deg, #d8444c 0%, #a71d24 100%)", fg: "#fff" },
    neutral: { bg: "#fff", fg: "#0a2540" },
  };
  const t = colors[tone];

  const inner = (
    <div
      className="rounded-2xl p-5 reveal h-full"
      style={{
        background: t.bg,
        color: t.fg,
        boxShadow: tone === "neutral" ? "0 1px 3px rgba(10,37,64,0.06)" : "var(--shadow-soft)",
      }}
    >
      <div className="text-xs uppercase tracking-widest opacity-80 font-medium">{label}</div>
      <div className="text-3xl font-semibold mt-2 tabular-nums">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-75">{sub}</div>}
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}
