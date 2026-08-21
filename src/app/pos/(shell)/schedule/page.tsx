"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";

/**
 * The shift desk: the roster, the asks, and the day as it actually is.
 *
 * THREE TABS BECAUSE THREE MOMENTS. The week is written sitting down; the
 * requests are answered when the badge says there are any; the board is
 * glanced at at eight in the morning when a bay is empty. One page, because
 * the three feed each other — approving a call-off rewrites the week, and
 * the board is the week compared against the clock.
 *
 * PEOPLE COME GROUPED — technicians, mechanics, the office — the way the
 * owner talks about the floor. The grouping is the server's; this page only
 * draws it, so the grid, the filter and the coverage line can never disagree.
 *
 * COVERAGE is the two skills the shop can be short of: mufflers and
 * 18-wheelers. The footer says, per day, whether somebody rostered can do
 * each — a tick that turns to a dash is a Thursday that cannot take a
 * muffler job, seen a week before the customer is standing there.
 */

type Shift = {
  id: number;
  employeeId: number;
  workDate: string;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  note: string | null;
};
type Person = {
  employeeId: number;
  name: string;
  role: string;
  phone: string | null;
  canMufflers: number;
  canBigRigs: number;
  group: "technicians" | "mechanics" | "office";
  byDate: Record<string, Shift>;
};
type DeskRequest = {
  id: number;
  employeeId: number;
  name: string;
  phone: string | null;
  kind: "call_off" | "change" | "cover_offer" | "more_hours";
  workDate: string | null;
  proposedStartMinute: number | null;
  proposedEndMinute: number | null;
  hoursWanted: number | null;
  rostered: { start: string; end: string } | null;
  note: string | null;
  status: string;
  createdAt: string;
  resolvedByName: string | null;
  resolutionNote: string | null;
};
type BoardRow = {
  employeeId: number;
  name: string;
  role: string;
  phone: string | null;
  shift: { start: string; end: string; startMinute: number } | null;
  state: "checked_out" | "checked_in" | "on_break";
  lastEventAt: string | null;
  awol: boolean;
};
type Data = {
  today: string;
  weekStart: string;
  weekEnd: string;
  people: Person[];
  requests: { open: DeskRequest[]; recent: DeskRequest[] };
  board: { date: string; rows: BoardRow[]; covers: DeskRequest[] };
};

const GROUPS: { key: Person["group"]; label: string }[] = [
  { key: "technicians", label: "Technicians" },
  { key: "mechanics", label: "Mechanics" },
  { key: "office", label: "Office" },
];

function clockOf(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}
const toHHMM = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const toMinutes = (v: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function colLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${DAY_SHORT[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}
function phonePretty(p: string | null): string {
  if (!p) return "—";
  return p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : p;
}
function sinceWords(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function ShiftDeskPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"week" | "requests" | "today">("week");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [filter, setFilter] = useState<"everyone" | Person["group"]>("everyone");
  /** The cell under the pencil: one person, one day. */
  const [cell, setCell] = useState<{ employeeId: number; date: string } | null>(null);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("17:00");
  const [breakMin, setBreakMin] = useState("60");
  const [cellNote, setCellNote] = useState("");
  /** The person whose number or skills are being edited. */
  const [personEdit, setPersonEdit] = useState<number | null>(null);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [resolveNote, setResolveNote] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (weekStart) sp.set("weekStart", weekStart);
    const res = await fetch(`/api/pos/schedule?${sp}`);
    if (!res.ok) {
      setError("Could not load the desk");
      return;
    }
    setData(await res.json());
    setError(null);
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  // The board goes stale by itself — people punch while the tab sits open —
  // so it re-reads on a slow heartbeat while the Today tab is showing.
  useEffect(() => {
    if (tab !== "today") return;
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [tab, load]);

  async function post(url: string, body: unknown): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "That did not save");
        return false;
      }
      setError(null);
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const openCell = (p: Person, date: string) => {
    const s = p.byDate[date];
    setCell({ employeeId: p.employeeId, date });
    setStart(s ? toHHMM(s.startMinute) : "08:00");
    setEnd(s ? toHHMM(s.endMinute) : "17:00");
    setBreakMin(String(s?.breakMinutes ?? 60));
    setCellNote(s?.note ?? "");
  };

  const days = useMemo(
    () => (data ? Array.from({ length: 7 }, (_, i) => addDays(data.weekStart, i)) : []),
    [data],
  );

  const visible = useMemo(
    () => (data ? data.people.filter((p) => filter === "everyone" || p.group === filter) : []),
    [data, filter],
  );

  /** Per day: is somebody rostered who can do each of the two jobs? */
  const coverage = useMemo(() => {
    if (!data) return {} as Record<string, { mufflers: boolean; rigs: boolean }>;
    const out: Record<string, { mufflers: boolean; rigs: boolean }> = {};
    for (const date of days) {
      let mufflers = false;
      let rigs = false;
      for (const p of data.people) {
        if (!p.byDate[date]) continue;
        if (p.canMufflers) mufflers = true;
        if (p.canBigRigs) rigs = true;
      }
      out[date] = { mufflers, rigs };
    }
    return out;
  }, [data, days]);

  if (!can("manageSchedule"))
    return <div className="text-brand-400">{tr("Your account can't run the shift desk.")}</div>;
  if (error && !data)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">{tr("Setting the desk…")}</div>;

  const openCount = data.requests.open.length;
  const cellPerson = cell ? data.people.find((p) => p.employeeId === cell.employeeId) : null;

  const KINDS: Record<DeskRequest["kind"], string> = {
    call_off: tr("Can't come"),
    change: tr("Asks a change"),
    cover_offer: tr("Can cover"),
    more_hours: tr("Wants more hours"),
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{tr("Shift desk")}</h1>
          <p className="text-brand-400 text-sm">
            {tr("The week as written, the asks waiting on an answer, and the day as it actually is.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(
            [
              ["week", tr("The week")],
              ["requests", openCount > 0 ? `${tr("Requests")} · ${openCount}` : tr("Requests")],
              ["today", tr("Today")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={tab === key ? "btn btn-primary" : "btn btn-outline"}
              style={{ height: 36, fontSize: 13 }}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 mb-4">{error}</div>
      )}

      {/* ── THE WEEK ────────────────────────────────────────────────────── */}
      {tab === "week" && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-outline" style={{ height: 34, fontSize: 13 }} onClick={() => setWeekStart(addDays(data.weekStart, -7))}>
                ← {tr("earlier")}
              </button>
              <span className="text-sm text-brand-400 tabular-nums">
                {data.weekStart} → {data.weekEnd}
              </span>
              <button type="button" className="btn btn-outline" style={{ height: 34, fontSize: 13 }} onClick={() => setWeekStart(addDays(data.weekStart, 7))}>
                {tr("later")} →
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(
                [
                  ["everyone", tr("Everyone")],
                  ["technicians", tr("Technicians")],
                  ["mechanics", tr("Mechanics")],
                  ["office", tr("Office")],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={filter === key ? "btn btn-primary" : "btn btn-outline"}
                  style={{ height: 30, fontSize: 12 }}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-outline"
                style={{ height: 30, fontSize: 12 }}
                disabled={busy}
                title={tr("Copies last week onto this one. Days already written in are left alone.")}
                onClick={() =>
                  void post("/api/pos/schedule/copy-week", {
                    fromMonday: addDays(data.weekStart, -7),
                    toMonday: data.weekStart,
                  })
                }
              >
                {tr("Copy last week")}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-2 overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 760 }}>
              <thead>
                <tr className="text-left text-brand-300 uppercase text-xs tracking-wider">
                  <th className="py-2 px-2 font-medium">{tr("Who")}</th>
                  {days.map((d) => (
                    <th key={d} className={`py-2 px-1 font-medium text-center${d === data.today ? " text-brand-500" : ""}`}>
                      {colLabel(d)}
                    </th>
                  ))}
                  {/* Paid hours for the visible week, so "who is near forty"
                      is read off the row rather than computed in a head. */}
                  <th className="py-2 px-2 font-medium text-right">{tr("Hours")}</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.filter((g) => filter === "everyone" || filter === g.key).map((g) => {
                  const members = visible.filter((p) => p.group === g.key);
                  if (members.length === 0) return null;
                  return (
                    <Fragment key={g.key}>
                      <FragmentRows
                        label={tr(g.label)}
                        members={members}
                        days={days}
                        today={data.today}
                        cell={cell}
                        onCell={openCell}
                        onPerson={(p) => {
                          setPersonEdit(personEdit === p.employeeId ? null : p.employeeId);
                          setPhoneDraft("");
                        }}
                      />
                      {/* The two jobs a day can be short of, closing the
                          technician section rather than the whole table —
                          the coverage is ABOUT these rows, and under Office
                          it read as a fact about the front counter. A dash
                          on a workday is the whole warning. The count still
                          honours every rostered pair of hands, wherever they
                          sort: Americo covers mufflers from Mechanics. */}
                      {g.key === "technicians" &&
                        (
                          [
                            ["Mufflers", "mufflers"],
                            ["18-wheelers", "rigs"],
                          ] as const
                        ).map(([label, key]) => (
                          <tr key={key} className="text-xs" style={{ background: "rgba(10,37,64,0.02)" }}>
                            <td className="py-1.5 px-2 text-brand-400">{tr(label)}</td>
                            {days.map((d) => (
                              <td key={d} className="py-1.5 px-1 text-center font-semibold">
                                {coverage[d]?.[key] ? (
                                  <span style={{ color: "#15803d" }}>✓</span>
                                ) : (
                                  <span style={{ color: "#b45309" }}>—</span>
                                )}
                              </td>
                            ))}
                            <td />
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* The person editor: number and hands. */}
          {personEdit !== null &&
            (() => {
              const p = data.people.find((x) => x.employeeId === personEdit);
              if (!p) return null;
              return (
                <div className="bg-white rounded-2xl shadow-sm p-4 mt-3 flex items-center gap-4 flex-wrap">
                  <div className="font-semibold text-brand-500">{p.name}</div>
                  <label className="text-sm text-brand-400 flex items-center gap-2">
                    {tr("Phone")}
                    <input
                      className="input"
                      style={{ height: 32, fontSize: 13, width: 150 }}
                      placeholder={phonePretty(p.phone)}
                      value={phoneDraft}
                      onChange={(e) => setPhoneDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ height: 32, fontSize: 12 }}
                      disabled={busy || phoneDraft.replace(/\D/g, "").length < 10}
                      onClick={() =>
                        void post("/api/pos/schedule/person", {
                          employeeId: p.employeeId,
                          phone: phoneDraft,
                        }).then((ok) => ok && setPhoneDraft(""))
                      }
                    >
                      {tr("Save")}
                    </button>
                  </label>
                  <label className="text-sm text-brand-400 flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={p.canMufflers === 1}
                      disabled={busy}
                      onChange={(e) =>
                        void post("/api/pos/schedule/person", {
                          employeeId: p.employeeId,
                          canMufflers: e.target.checked,
                        })
                      }
                    />
                    {tr("Can do mufflers")}
                  </label>
                  <label className="text-sm text-brand-400 flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={p.canBigRigs === 1}
                      disabled={busy}
                      onChange={(e) =>
                        void post("/api/pos/schedule/person", {
                          employeeId: p.employeeId,
                          canBigRigs: e.target.checked,
                        })
                      }
                    />
                    {tr("Can do 18-wheelers")}
                  </label>
                </div>
              );
            })()}

          {/* The cell editor. */}
          {cell && cellPerson && (
            <div className="bg-white rounded-2xl shadow-sm p-4 mt-3">
              <div className="font-semibold text-brand-500 mb-3">
                {cellPerson.name} · {colLabel(cell.date)}
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <label className="text-sm text-brand-400">
                  {tr("From")}
                  <input type="time" className="input block mt-1" style={{ height: 36 }} value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="text-sm text-brand-400">
                  {tr("To")}
                  <input type="time" className="input block mt-1" style={{ height: 36 }} value={end} onChange={(e) => setEnd(e.target.value)} />
                </label>
                <label className="text-sm text-brand-400">
                  {tr("Break, minutes")}
                  <input type="number" className="input block mt-1" style={{ height: 36, width: 90 }} min={0} step={15} value={breakMin} onChange={(e) => setBreakMin(e.target.value)} />
                </label>
                <label className="text-sm text-brand-400 flex-1 min-w-[160px]">
                  {tr("Note")}
                  <input className="input block mt-1 w-full" style={{ height: 36 }} value={cellNote} onChange={(e) => setCellNote(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ height: 36, fontSize: 13 }}
                  disabled={busy || toMinutes(start) === null || toMinutes(end) === null}
                  onClick={() =>
                    void post("/api/pos/schedule/shift", {
                      employeeId: cell.employeeId,
                      workDate: cell.date,
                      startMinute: toMinutes(start),
                      endMinute: toMinutes(end),
                      breakMinutes: Number(breakMin) || 0,
                      note: cellNote.trim() || null,
                    }).then((ok) => ok && setCell(null))
                  }
                >
                  {tr("Save the shift")}
                </button>
                {cellPerson.byDate[cell.date] && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ height: 36, fontSize: 13, color: "#b91c1c" }}
                    disabled={busy}
                    onClick={() =>
                      void post("/api/pos/schedule/shift", {
                        employeeId: cell.employeeId,
                        workDate: cell.date,
                        clear: true,
                      }).then((ok) => ok && setCell(null))
                    }
                  >
                    {tr("Take them off this day")}
                  </button>
                )}
                <button type="button" className="btn btn-outline" style={{ height: 36, fontSize: 13 }} onClick={() => setCell(null)}>
                  {tr("Close")}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── REQUESTS ────────────────────────────────────────────────────── */}
      {tab === "requests" && (
        <>
          {data.requests.open.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-6 text-brand-300">
              {tr("Nothing is waiting on an answer.")}
            </div>
          ) : (
            data.requests.open.map((r) => (
              <div key={r.id} className="bg-white rounded-2xl shadow-sm p-4 mb-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <span className="font-semibold text-brand-500">{r.name}</span>{" "}
                    <span
                      className="text-xs rounded-full px-2 py-0.5 font-medium"
                      style={{
                        background:
                          r.kind === "call_off"
                            ? "rgba(185,28,28,0.1)"
                            : r.kind === "cover_offer"
                              ? "rgba(21,128,61,0.1)"
                              : "rgba(10,37,64,0.08)",
                        color:
                          r.kind === "call_off" ? "#b91c1c" : r.kind === "cover_offer" ? "#15803d" : "#0a2540",
                      }}
                    >
                      {KINDS[r.kind]}
                    </span>{" "}
                    {r.workDate && <span className="text-brand-400 tabular-nums">{r.workDate}</span>}
                    {r.hoursWanted !== null && (
                      <span className="text-sm font-medium"> +{r.hoursWanted}h {tr("a week")}</span>
                    )}
                    {r.rostered && (
                      <span className="text-brand-300 text-sm">
                        {" "}
                        · {tr("rostered")} {r.rostered.start}–{r.rostered.end}
                      </span>
                    )}
                    {r.proposedStartMinute !== null && r.proposedEndMinute !== null && (
                      <span className="text-sm font-medium">
                        {" "}
                        → {clockOf(r.proposedStartMinute)}–{clockOf(r.proposedEndMinute)}
                      </span>
                    )}
                    {r.note && <div className="text-sm text-brand-400 mt-0.5">“{r.note}”</div>}
                    <div className="text-xs text-brand-300 mt-0.5">
                      {phonePretty(r.phone)} · {tr("asked")} {r.createdAt.slice(0, 16).replace("T", " ")}
                    </div>
                  </div>
                  <input
                    className="input"
                    style={{ height: 34, fontSize: 13, width: 180 }}
                    placeholder={tr("A word back, if any")}
                    value={resolveNote[r.id] ?? ""}
                    onChange={(e) => setResolveNote((m) => ({ ...m, [r.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ height: 34, fontSize: 13 }}
                    disabled={busy}
                    onClick={() =>
                      void post("/api/pos/schedule/resolve", {
                        id: r.id,
                        approve: true,
                        note: resolveNote[r.id] ?? null,
                      })
                    }
                  >
                    {r.kind === "cover_offer" || r.kind === "more_hours"
                      ? tr("Noted")
                      : tr("Approve")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ height: 34, fontSize: 13, color: "#b91c1c" }}
                    disabled={busy}
                    onClick={() =>
                      void post("/api/pos/schedule/resolve", {
                        id: r.id,
                        approve: false,
                        note: resolveNote[r.id] ?? null,
                      })
                    }
                  >
                    {tr("Decline")}
                  </button>
                </div>
              </div>
            ))
          )}

          {data.requests.recent.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-4 mt-4">
              <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
                {tr("Recently answered")}
              </div>
              {data.requests.recent.map((r) => (
                <div key={r.id} className="py-1.5 border-t border-brand-100 text-sm flex gap-2 flex-wrap">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-brand-400">
                    {KINDS[r.kind]}
                    {r.workDate ? ` · ${r.workDate}` : ""}
                    {r.hoursWanted !== null ? ` · +${r.hoursWanted}h` : ""}
                  </span>
                  <span
                    className="font-medium"
                    style={{
                      color:
                        r.status === "approved" ? "#15803d" : r.status === "declined" ? "#b91c1c" : "rgba(10,37,64,0.4)",
                    }}
                  >
                    {r.status === "approved" ? tr("approved") : r.status === "declined" ? tr("declined") : tr("withdrawn")}
                  </span>
                  {r.resolvedByName && <span className="text-brand-300">{tr("by")} {r.resolvedByName}</span>}
                  {r.resolutionNote && <span className="text-brand-300">· “{r.resolutionNote}”</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── TODAY ───────────────────────────────────────────────────────── */}
      {tab === "today" && (
        <>
          {data.board.covers.length > 0 && (
            <div
              className="rounded-2xl p-4 mb-3"
              style={{ background: "#f0fdf4", border: "1px solid rgba(21,128,61,0.3)" }}
            >
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "#15803d" }}>
                {tr("Hands up for today")}
              </div>
              {data.board.covers.map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-semibold">{c.name}</span> ·{" "}
                  <a className="underline tabular-nums" href={`tel:${c.phone ?? ""}`}>
                    {phonePretty(c.phone)}
                  </a>
                  {c.note && <span className="text-brand-400"> · “{c.note}”</span>}
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm p-2 overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 620 }}>
              <thead>
                <tr className="text-left text-brand-300 uppercase text-xs tracking-wider">
                  <th className="py-2 px-2 font-medium">{tr("Who")}</th>
                  <th className="py-2 px-2 font-medium">{tr("Rostered")}</th>
                  <th className="py-2 px-2 font-medium">{tr("Right now")}</th>
                  <th className="py-2 px-2 font-medium">{tr("Phone")}</th>
                  <th className="py-2 px-2 font-medium text-right">{tr("Do something")}</th>
                </tr>
              </thead>
              <tbody>
                {data.board.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-brand-300">
                      {tr("Nobody is rostered today and nobody is on the clock.")}
                    </td>
                  </tr>
                )}
                {data.board.rows.map((r, idx) => (
                  <tr
                    key={r.employeeId}
                    className="border-t border-brand-100"
                    /* Amber outranks the zebra — a no-show must not fade
                       into the banding it happens to land on. */
                    style={
                      r.awol
                        ? { background: "#fffbeb" }
                        : idx % 2 === 1
                          ? { background: "rgba(10,37,64,0.035)" }
                          : undefined
                    }
                  >
                    <td className="py-2 px-2 font-medium">
                      {r.name}
                      {!r.shift && (
                        <span className="text-xs text-brand-300"> · {tr("not on the roster")}</span>
                      )}
                    </td>
                    <td className="py-2 px-2 tabular-nums text-brand-400">
                      {r.shift ? `${r.shift.start}–${r.shift.end}` : "—"}
                    </td>
                    <td className="py-2 px-2">
                      {r.state === "checked_in" && (
                        <span style={{ color: "#15803d", fontWeight: 600 }}>
                          {tr("In")} · {sinceWords(r.lastEventAt)}
                        </span>
                      )}
                      {r.state === "on_break" && (
                        <span style={{ color: "#b45309", fontWeight: 600 }}>
                          {tr("On break")} · {sinceWords(r.lastEventAt)}
                        </span>
                      )}
                      {r.state === "checked_out" &&
                        (r.awol ? (
                          <span style={{ color: "#b45309", fontWeight: 700 }}>
                            {tr("Not in — past their start")}
                          </span>
                        ) : (
                          <span className="text-brand-300">{tr("Not in")}</span>
                        ))}
                    </td>
                    <td className="py-2 px-2 tabular-nums">
                      {r.phone ? (
                        <a className="underline" href={`tel:${r.phone}`}>
                          {phonePretty(r.phone)}
                        </a>
                      ) : (
                        <span className="text-brand-300">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      {r.state === "checked_out" && (
                        <PunchBtn label={tr("Clock in")} onClick={() => void post("/api/pos/schedule/punch", { employeeId: r.employeeId, action: "check_in" })} disabled={busy} />
                      )}
                      {r.state === "checked_in" && (
                        <>
                          <PunchBtn label={tr("Start break")} onClick={() => void post("/api/pos/schedule/punch", { employeeId: r.employeeId, action: "break_start" })} disabled={busy} />
                          <PunchBtn label={tr("Clock out")} tone="warn" onClick={() => void post("/api/pos/schedule/punch", { employeeId: r.employeeId, action: "check_out" })} disabled={busy} />
                        </>
                      )}
                      {r.state === "on_break" && (
                        <>
                          <PunchBtn label={tr("End break")} onClick={() => void post("/api/pos/schedule/punch", { employeeId: r.employeeId, action: "break_end" })} disabled={busy} />
                          <PunchBtn label={tr("Clock out")} tone="warn" onClick={() => void post("/api/pos/schedule/punch", { employeeId: r.employeeId, action: "check_out" })} disabled={busy} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-brand-300 mt-3">
            {tr("A punch from this board is recorded as yours — the entry says which manager pressed it, and it shows on the person's timesheet like any other.")}
          </p>
        </>
      )}
    </div>
  );
}

/** One group of grid rows under its label. */
function FragmentRows({
  label,
  members,
  days,
  today,
  cell,
  onCell,
  onPerson,
}: {
  label: string;
  members: Person[];
  days: string[];
  today: string;
  cell: { employeeId: number; date: string } | null;
  onCell: (p: Person, date: string) => void;
  onPerson: (p: Person) => void;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={days.length + 2}
          className="pt-3 pb-1 px-2 text-xs uppercase tracking-wider text-brand-300 font-medium"
        >
          {label}
        </td>
      </tr>
      {members.map((p, idx) => (
        <tr
          key={p.employeeId}
          className="border-t border-brand-100"
          /* Zebra, by the owner's ask: a row here is a name followed by
             seven cells and an hours figure, and on the wide weeks the eye
             lost the name by Thursday. Striped per group so the banding
             restarts under each heading. */
          style={idx % 2 === 1 ? { background: "rgba(10,37,64,0.035)" } : undefined}
        >
          {/* The name is the door to the person — number and skills. */}
          <td className="py-1.5 px-2">
            <button type="button" className="font-medium text-left hover:underline" onClick={() => onPerson(p)}>
              {p.name}
            </button>
            <span className="ml-1 text-xs text-brand-300">
              {p.canMufflers ? "M" : ""}
              {p.canBigRigs ? "W" : ""}
            </span>
          </td>
          {days.map((d) => {
            const s = p.byDate[d];
            const selected = cell?.employeeId === p.employeeId && cell?.date === d;
            return (
              <td key={d} className="py-1 px-0.5 text-center">
                <button
                  type="button"
                  className="w-full rounded-lg py-1.5 text-xs tabular-nums transition-colors"
                  style={{
                    background: selected
                      ? "rgba(10,37,64,0.12)"
                      : s
                        ? "rgba(255,200,61,0.16)"
                        : d === today
                          ? "rgba(10,37,64,0.03)"
                          : "transparent",
                    border: s ? "1px solid rgba(224,169,29,0.45)" : "1px dashed rgba(10,37,64,0.12)",
                    fontWeight: s ? 600 : 400,
                    color: s ? "#7c5c05" : "rgba(10,37,64,0.35)",
                  }}
                  onClick={() => onCell(p, d)}
                >
                  {s ? `${clockOf(s.startMinute)}–${clockOf(s.endMinute)}` : "+"}
                </button>
              </td>
            );
          })}
          {(() => {
            const hours = days.reduce((n, d) => {
              const s = p.byDate[d];
              return s ? n + Math.max(0, s.endMinute - s.startMinute - s.breakMinutes) / 60 : n;
            }, 0);
            return (
              <td
                className="py-1 px-2 text-right tabular-nums text-sm"
                style={{
                  fontWeight: 600,
                  // Forty is where the overtime arithmetic starts; amber is
                  // the row asking to be looked at, not an alarm.
                  color: hours > 40 ? "#b45309" : hours > 0 ? "#0a2540" : "rgba(10,37,64,0.3)",
                }}
              >
                {hours > 0 ? hours.toFixed(1).replace(/\.0$/, "") : "—"}
              </td>
            );
          })()}
        </tr>
      ))}
    </>
  );
}

function PunchBtn({
  label,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  tone?: "warn";
}) {
  return (
    <button
      type="button"
      className="btn btn-outline ml-1.5"
      style={{ height: 30, fontSize: 12, color: tone === "warn" ? "#b91c1c" : undefined }}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
