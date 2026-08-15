"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { ScheduledPerson, Shift } from "@/lib/schedule";
import type { Staffing } from "@/lib/reports-bi";
import "./schedule.css";

/**
 * THE ROSTER, WITH THE SHOP'S OWN FIGURES ON IT.
 *
 * A week at a time: people down the side, days across, a shift in a cell. The
 * grid is the boring part and it is deliberately boring — a shop of five
 * technicians rosters by writing names against days, and every clever thing a
 * scheduler can grow (patterns, rotations, drag to resize) is work spent making
 * a minute of typing into thirty seconds.
 *
 * WHAT MAKES IT WORTH BUILDING is the row under each day heading: what the
 * tickets say that day needs, against what has actually been rostered. Without
 * it this is a spreadsheet with a login, and the shop already has spreadsheets.
 * With it the two questions that were always asked in different rooms — "how
 * busy do we get on a Saturday" and "who is in on Saturday" — are on one screen,
 * and being short-handed becomes something you can see on Tuesday rather than
 * discover on the day.
 *
 * THE RECOMMENDATION LOOKS BACKWARDS AND THE ROSTER LOOKS FORWARDS, which is
 * the one thing about this screen that could mislead. The need is measured over
 * the four weeks ending today; the week being rostered has not happened and has
 * no tickets in it. So it is labelled as what the last four weeks asked for, not
 * as a prediction, and it carries the same warning the staffing report does:
 * these are the customers who stayed, so the figure is a floor.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Data = {
  from: string;
  to: string;
  people: ScheduledPerson[];
  staffing: Staffing;
};

/** The Monday of the week a date falls in, as the roster is read Monday first. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayLabel = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

const clock = (minute: number) => {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
};

const paidHours = (s: Shift) =>
  Math.max(0, s.endMinute - s.startMinute - s.breakMinutes) / 60;

export default function SchedulePage() {
  const [monday, setMonday] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which cell is being edited: the person and the day. */
  const [editing, setEditing] = useState<{ person: ScheduledPerson; date: string } | null>(null);
  /*
    HOW FAST A TECHNICIAN GETS THROUGH A CUSTOMER, chosen here.

    "Needed" is customers-per-hour divided by this, so it is the one number that
    decides every recommendation on the screen — and it was fixed at two an hour
    with a note telling the reader to change it on the Reports page, where no
    such control exists. That is worse than no control: it says the setting is
    somebody else's and then sends you somewhere it is not.

    It lives on the screen it governs, and it starts at thirty minutes a
    customer because that is the middle of the four the shop's own report
    offers, not because anybody measured it.
  */
  const [pace, setPace] = useState(2);

  useEffect(() => {
    setMonday(mondayOf(new Date().toISOString().slice(0, 10)));
  }, []);

  const load = useCallback(async () => {
    if (!monday) return;
    const res = await fetch(`/api/admin/schedule?from=${monday}`);
    if (!res.ok) {
      setError("Could not load the week");
      return;
    }
    setData(await res.json());
    setError(null);
  }, [monday]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(
    () => (monday ? Array.from({ length: 7 }, (_, i) => addDays(monday, i)) : []),
    [monday],
  );

  /**
   * What is rostered against what is needed, per day.
   *
   * `needed` is the shop's own peak-hour figure at whatever pace is selected
   * above the grid. It recomputes when that changes, which is the point of
   * putting the control on this screen: the recommendation is an opinion about
   * how long a job takes, and the person rostering is the one who knows.
   */
  const perDay = useMemo(() => {
    if (!data) return {};
    const out: Record<
      string,
      { rostered: number; hours: number; needed: number; customers: number }
    > = {};
    for (const d of days) {
      const wd = weekdayOf(d);
      const shifts = data.people
        .map((p) => p.byDate[d])
        .filter((s): s is Shift => Boolean(s));
      const chosen = data.staffing.atPace.find((p) => p.perHour === pace);
      out[d] = {
        rostered: shifts.length,
        hours: shifts.reduce((n, s) => n + paidHours(s), 0),
        needed: chosen?.peak.find((x) => x.weekday === wd)?.techs ?? 0,
        customers: data.staffing.days.find((x) => x.weekday === wd)?.tickets ?? 0,
      };
    }
    return out;
  }, [data, days, pace]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch("/api/admin/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "That did not save");
      return false;
    }
    setError(null);
    await load();
    return true;
  }

  if (!monday) return null;

  return (
    <div className="sch">
      <div className="sch-head">
        <div>
          <h1 className="sch-title">Schedule</h1>
          <p className="sch-sub">
            Who is expected in, and what the shop&apos;s own tickets say each day needs.
          </p>
        </div>
        <div className="sch-nav">
          <button type="button" className="btn btn-ghost" onClick={() => setMonday(addDays(monday, -7))}>
            ← Previous
          </button>
          <span className="sch-week">
            {dayLabel(monday)} — {dayLabel(addDays(monday, 6))}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setMonday(addDays(monday, 7))}>
            Next →
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setMonday(mondayOf(new Date().toISOString().slice(0, 10)))}
          >
            This week
          </button>
          {/* The one convenience worth having: a tire shop's roster is the same
              week over and over with a name moved. It never overwrites a shift
              somebody has already written into the target week. */}
          <button
            type="button"
            className="btn btn-outline"
            disabled={busy}
            onClick={() =>
              void post({
                action: "copy",
                fromMonday: addDays(monday, -7),
                toMonday: monday,
              })
            }
          >
            Copy last week in
          </button>
        </div>
      </div>

      {/* The one setting behind every "needed" figure on this page, on the page
          it governs. Minutes as well as a rate, because minutes is the form
          somebody can check against a watch in the bay. */}
      <div className="sch-pace">
        <span className="sch-pace-lab">One technician gets through</span>
        {data?.staffing.atPace.map((row) => (
          <button
            key={row.perHour}
            type="button"
            className={`sch-pace-opt${pace === row.perHour ? " is-on" : ""}`}
            onClick={() => setPace(row.perHour)}
          >
            <strong>{row.perHour} an hour</strong>
            <span>{Math.round(60 / row.perHour)} min each</span>
          </button>
        ))}
      </div>

      {error && <div className="sch-error">{error}</div>}

      {data && (
        <>
          <div className="sch-scroll">
            <table className="sch-grid">
              <thead>
                <tr>
                  <th className="sch-who">Who</th>
                  {days.map((d) => {
                    const m = perDay[d];
                    const short = m && m.needed > 0 && m.rostered < m.needed;
                    return (
                      <th key={d}>
                        <div className="sch-day">{DAY_NAMES[weekdayOf(d)]}</div>
                        <div className="sch-date">{dayLabel(d)}</div>
                        {/*
                          The line this whole screen exists for. Red when the day
                          is under-staffed against the shop's own figures — not
                          amber, because it is not a caveat, it is a day that is
                          going to be short unless somebody does something.
                        */}
                        {m && (
                          <div className={`sch-need${short ? " is-short" : ""}`}>
                            {m.rostered} on · {m.needed || "—"} needed
                          </div>
                        )}
                        {m && (
                          <div className="sch-cust">~{Math.round(m.customers)} customers</div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.employeeId}>
                    <td className="sch-who">
                      <div className="sch-name">{p.name}</div>
                      <div className="sch-role">{p.role}</div>
                    </td>
                    {days.map((d) => {
                      const s = p.byDate[d];
                      return (
                        <td key={d}>
                          <button
                            type="button"
                            className={`sch-cell${s ? " is-on" : ""}`}
                            onClick={() => setEditing({ person: p, date: d })}
                          >
                            {s ? (
                              <>
                                <span className="sch-time">
                                  {clock(s.startMinute)}–{clock(s.endMinute)}
                                </span>
                                <span className="sch-hrs">{paidHours(s).toFixed(1)} h</span>
                              </>
                            ) : (
                              <span className="sch-add">+</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sch-who">Hours rostered</td>
                  {days.map((d) => (
                    <td key={d} className="sch-total">
                      {perDay[d]?.hours ? `${perDay[d].hours.toFixed(1)} h` : "—"}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="sch-legend">
            <p>
              <strong>&ldquo;Needed&rdquo; is this shop&apos;s own figure</strong>, worked out from
              the tickets of the last four weeks: how many technicians the busiest hour of that
              weekday takes, at whichever pace is selected above. Change it if that is not the bay
              you know — every figure on this page moves with it.
            </p>
            <p>
              It looks backwards while the roster looks forwards, so read it as what recent
              Saturdays asked for rather than as a prediction. And it counts the customers who
              stayed — anybody who saw the wait and drove off is in none of it, so treat the number
              as a floor rather than a target.
            </p>
          </div>
        </>
      )}

      {editing && (
        <ShiftModal
          person={editing.person}
          date={editing.date}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            const ok = await post({ action: "set", employeeId: editing.person.employeeId, workDate: editing.date, ...v });
            if (ok) setEditing(null);
          }}
          onClear={async () => {
            const ok = await post({
              action: "clear",
              employeeId: editing.person.employeeId,
              workDate: editing.date,
            });
            if (ok) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * One shift, in the two numbers a roster actually holds.
 *
 * Times as <select>s of whole and half hours rather than free text: a shop
 * opening at eight and closing at seven does not roster anybody at 8:17, and a
 * dropdown cannot be typed wrong. The presets above them are what gets used
 * nine times out of ten and save the dropdowns entirely.
 */
function ShiftModal({
  person,
  date,
  busy,
  onClose,
  onSave,
  onClear,
}: {
  person: ScheduledPerson;
  date: string;
  busy: boolean;
  onClose: () => void;
  onSave: (v: { startMinute: number; endMinute: number; breakMinutes: number; note: string | null }) => void;
  onClear: () => void;
}) {
  const existing = person.byDate[date];
  const [start, setStart] = useState(existing?.startMinute ?? 8 * 60);
  const [end, setEnd] = useState(existing?.endMinute ?? 19 * 60);
  const [brk, setBrk] = useState(existing?.breakMinutes ?? 60);
  const [note, setNote] = useState(existing?.note ?? "");

  const options = Array.from({ length: 33 }, (_, i) => 6 * 60 + i * 30);
  const hours = Math.max(0, end - start - brk) / 60;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${person.name} · ${DAY_NAMES[weekdayOf(date)]} ${dayLabel(date)}`}
      footer={
        <>
          {existing && (
            <button type="button" className="btn btn-ghost mr-auto" onClick={onClear} disabled={busy}>
              Take off this day
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || end <= start || brk >= end - start}
            onClick={() => onSave({ startMinute: start, endMinute: end, breakMinutes: brk, note: note.trim() || null })}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "Full day · 8–7", s: 8 * 60, e: 19 * 60, b: 60 },
            { label: "8–6", s: 8 * 60, e: 18 * 60, b: 60 },
            { label: "Morning · 8–1", s: 8 * 60, e: 13 * 60, b: 0 },
            { label: "Afternoon · 1–7", s: 13 * 60, e: 19 * 60, b: 0 },
          ].map((p) => (
            <button
              key={p.label}
              type="button"
              className="btn btn-outline"
              style={{ height: 32, fontSize: 12 }}
              onClick={() => {
                setStart(p.s);
                setEnd(p.e);
                setBrk(p.b);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <label className="text-sm text-brand-400 flex-1">
            Starts
            <select className="input mt-1 w-full" value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {options.map((m) => (
                <option key={m} value={m}>
                  {clock(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-brand-400 flex-1">
            Ends
            <select className="input mt-1 w-full" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
              {options.map((m) => (
                <option key={m} value={m}>
                  {clock(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-brand-400 flex-1">
            Unpaid break
            <select className="input mt-1 w-full" value={brk} onChange={(e) => setBrk(Number(e.target.value))}>
              {[0, 30, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "none" : `${m} min`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="text-sm text-brand-400">
          Note <span className="text-brand-300">(optional)</span>
          <input
            className="input mt-1 w-full"
            value={note}
            placeholder="half day, covering for…"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="sch-sum">
          {hours <= 0 ? (
            <span style={{ color: "#b91c1c" }}>That shift has no paid hours in it.</span>
          ) : (
            <>
              <strong>{hours.toFixed(1)} paid hours</strong>
              {person.hourlyRateCents !== null && (
                <>
                  {" · "}
                  {`$${((person.hourlyRateCents * hours) / 100).toFixed(2)}`} at their rate
                </>
              )}
              {person.hourlyRateCents === null && (
                <span className="text-brand-300"> · no pay recorded for them</span>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
