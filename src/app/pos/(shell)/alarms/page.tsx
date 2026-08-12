"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { ShopLogo } from "@/components/ui/ShopLogo";
import "./alarms.css";

/**
 * The alarm book.
 *
 * The Daily Report tells you what is wrong with one day. This tells you what
 * has been wrong lately, whether anybody looked at it, and what they said —
 * which is the question that actually gets asked ("has that drawer thing been
 * happening all week?") and the one a page showing a single day cannot answer.
 *
 * Nothing here can be switched off. Dismissing writes a name, a time and a
 * sentence against an alarm; the alarm goes on firing for as long as the
 * figures underneath it say it should. See `alarms.ts` for why.
 */

type Action = {
  id: number;
  kind: "dismiss" | "reopen";
  note: string;
  byName: string;
  byRole: string;
  at: string;
};

type Alarm = {
  businessDate: string;
  code: string;
  severity: "serious" | "watch";
  text: string;
  dismissed: boolean;
  latest: Action | null;
  history: Action[];
};

type Data = {
  from: string;
  to: string;
  today: string;
  days: { businessDate: string; alarms: Alarm[] }[];
  recurring: {
    code: string;
    severity: "serious" | "watch";
    text: string;
    days: number;
    open: number;
    lastFired: string;
  }[];
  totals: { fired: number; open: number; serious: number };
};

/** Whole days back from a date, as a business date. */
function back(from: string, days: number): string {
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * A day, or a week. Nothing longer is offered, and nothing longer is served —
 * see MAX_DAYS on the alarms route for why.
 */
const RANGES = [
  { key: "day", label: "This day", days: 0 },
  { key: "7", label: "Last 7 days", days: 6 },
];

/** The most days the server will judge in one request. Mirrors MAX_DAYS. */
const MAX_DAYS = 7;

function niceDate(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function niceStamp(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function AlarmsPage() {
  const { t: tr } = useLang();
  const { can, user } = usePosAuth();

  /**
   * The right-hand end of the range, and the only date the picker sets.
   *
   * A single date plus a length reads the way people ask the question — "the
   * last week, up to Friday" — and it means the button on the Daily Report can
   * hand this page the day it was looking at without also having to decide how
   * far back to go.
   */
  const [to, setTo] = useState("");
  /**
   * The day, not the week.
   *
   * This is reached from the Alarms button on the Daily Report, which hands
   * over the day it was looking at — so opening on a week means the alarm you
   * came here about arrives buried in six days of others. The week is one press
   * away, and it is the answer to a second question ("has this been happening?")
   * rather than the first.
   */
  const [range, setRange] = useState("day");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [printedOn, setPrintedOn] = useState("");

  /** The alarm whose note box is open, as `date|code`. */
  const [noting, setNoting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setPrintedOn(new Date().toLocaleString()), []);

  // The Daily Report links here with the day it was showing. Read once, on
  // mount, and then forgotten — after that the picker on this page is in
  // charge, and re-reading the URL would fight it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("date");
    setTo(q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const span = RANGES.find((r) => r.key === range)?.days ?? 6;
    const end = to || "";
    const qs = new URLSearchParams();
    if (end) {
      qs.set("to", end);
      qs.set("from", back(end, span));
    } else {
      // No date chosen yet: the server uses today, and it is the only thing
      // that knows what today's BUSINESS date is once the shop is open past
      // midnight. So only the length is sent, worked out from the browser's
      // date, which is right to the day either way.
      const t = new Date().toISOString().slice(0, 10);
      qs.set("from", back(t, span));
    }
    const res = await fetch(`/api/pos/alarms?${qs}`);
    const d = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(d.error || "Could not load the alarm log");
      setData(null);
      return;
    }
    setError(null);
    setData(d);
  }, [to, range]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(a: Alarm, kind: "dismiss" | "reopen", withNote: string) {
    const key = `${a.businessDate}|${a.code}`;
    if (busy) return;
    setBusy(key);
    const res = await fetch("/api/pos/alarms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessDate: a.businessDate,
        code: a.code,
        kind,
        note: withNote,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(d.error || "Could not save that");
      return;
    }
    setNoting(null);
    setNote("");
    await load();
  }

  if (!can("reviewAlarms"))
    return <div className="text-brand-400">{tr("Your account can't see the alarm log.")}</div>;

  return (
    <div className="alm-wrap">
      {/* Letterhead, printed only — same discipline as the other reports. */}
      <div className="alm-print-head">
        <ShopLogo size={44} />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>
            {tr("Alarm log")}
          </div>
          <div style={{ fontSize: "9pt" }}>
            {data ? `${niceDate(data.from)} — ${niceDate(data.to)}` : ""} ·{" "}
            {tr("printed")} {printedOn} · {user.name}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4 no-print">
        <div>
          <h1 className="text-xl font-semibold text-brand-600">{tr("Alarm log")}</h1>
          <p className="text-sm text-brand-400 mt-1" style={{ maxWidth: 620 }}>
            {tr(
              "Everything the Daily Report has flagged, day by day. Dismissing does not switch an alarm off — it writes your name, the time and your note against it, and the alarm keeps firing while the figures underneath it say it should.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link className="btn btn-outline" style={{ height: 34, fontSize: 13 }} href="/pos/closeout">
            {tr("Daily Report")}
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            style={{ height: 34, fontSize: 13 }}
            onClick={() => window.print()}
          >
            {tr("Print")}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-4 no-print">
        <span className="text-sm text-brand-400">{tr("Up to")}</span>
        <input
          type="date"
          className="input"
          style={{ height: 34, fontSize: 13 }}
          value={to || data?.today || ""}
          max={data?.today}
          onChange={(e) => setTo(e.target.value)}
        />
        <div className="alm-seg">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`alm-seg-btn${range === r.key ? " is-on" : ""}`}
              onClick={() => setRange(r.key)}
            >
              {tr(r.label)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="alm-error no-print" role="alert">
          {error}
        </div>
      )}

      {loading && <div className="text-brand-400 no-print">{tr("Reading the days…")}</div>}

      {data && !loading && (
        <>
          <div className="alm-tiles">
            <div className="alm-tile">
              <div className="alm-tile-n">{data.totals.fired}</div>
              <div className="alm-tile-l">{tr("alarms in this range")}</div>
            </div>
            <div className={`alm-tile${data.totals.open > 0 ? " is-open" : ""}`}>
              <div className="alm-tile-n">{data.totals.open}</div>
              <div className="alm-tile-l">{tr("nobody has answered")}</div>
            </div>
            <div className={`alm-tile${data.totals.serious > 0 ? " is-serious" : ""}`}>
              <div className="alm-tile-n">{data.totals.serious}</div>
              <div className="alm-tile-l">{tr("serious")}</div>
            </div>
            <div className="alm-tile">
              <div className="alm-tile-n">{data.days.length}</div>
              <div className="alm-tile-l">{tr("days with something on them")}</div>
            </div>
          </div>

          {/*
            The recurrence table, above the day-by-day list on purpose. One
            alarm on eleven separate days is a different fact from eleven
            alarms, and it is the fact worth acting on — but it is invisible
            until somebody counts, which is what this does.
          */}
          {data.recurring.length > 0 && (
            <div className="alm-block">
              <h2 className="alm-h2">{tr("What keeps coming back")}</h2>
              <table className="alm-table">
                <thead>
                  <tr>
                    <th>{tr("Alarm")}</th>
                    <th className="r">{tr("Days")}</th>
                    <th className="r">{tr("Unanswered")}</th>
                    <th className="r">{tr("Last")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recurring.map((s) => (
                    <tr key={s.code}>
                      <td>
                        <span
                          className={`alm-dot ${s.severity === "serious" ? "is-serious" : "is-watch"}`}
                        />
                        <span className="alm-code">{s.code}</span>
                        <div className="alm-standing-text">{s.text}</div>
                      </td>
                      <td className="r tabular-nums">{s.days}</td>
                      <td className={`r tabular-nums${s.open > 0 ? " alm-red" : ""}`}>
                        {s.open}
                      </td>
                      <td className="r">{niceDate(s.lastFired)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.days.length === 0 && (
            <div className="alm-clean">
              {tr("Nothing fired in this range. Every day in it closed clean.")}
            </div>
          )}

          {data.days.map((d) => (
            <div className="alm-block" key={d.businessDate}>
              <h2 className="alm-h2">
                {niceDate(d.businessDate)}
                <span className="alm-daycount">
                  {d.alarms.length} {d.alarms.length === 1 ? tr("alarm") : tr("alarms")}
                </span>
              </h2>

              {d.alarms.map((a) => {
                const key = `${a.businessDate}|${a.code}`;
                return (
                  <div
                    key={key}
                    className={`alm-row${a.dismissed ? " is-done" : ""}${
                      a.severity === "serious" ? " is-serious" : ""
                    }`}
                  >
                    <div className="alm-row-head">
                      <span
                        className={`alm-dot ${a.severity === "serious" ? "is-serious" : "is-watch"}`}
                      />
                      <span className="alm-text">{a.text}</span>
                    </div>

                    {/* The answer, if somebody gave one. Printed, because the
                        note is the reason this log is worth keeping. */}
                    {a.latest && (
                      <div className="alm-answer">
                        <strong>
                          {a.latest.kind === "dismiss" ? tr("Dismissed") : tr("Put back")}
                        </strong>{" "}
                        {tr("by")} {a.latest.byName} · {niceStamp(a.latest.at)}
                        {a.latest.note ? (
                          <div className="alm-note">“{a.latest.note}”</div>
                        ) : (
                          <div className="alm-note alm-nonote">{tr("no note")}</div>
                        )}
                        {/* Everything before the newest answer. Kept because
                            "waved away twice and it came back" is the story
                            that matters and a single latest row hides it. */}
                        {a.history.length > 1 && (
                          <details className="alm-hist">
                            <summary>
                              {a.history.length - 1}{" "}
                              {a.history.length - 1 === 1
                                ? tr("earlier entry")
                                : tr("earlier entries")}
                            </summary>
                            {a.history
                              .slice(0, -1)
                              .reverse()
                              .map((h) => (
                                <div className="alm-hist-row" key={h.id}>
                                  <strong>
                                    {h.kind === "dismiss" ? tr("Dismissed") : tr("Put back")}
                                  </strong>{" "}
                                  {tr("by")} {h.byName} · {niceStamp(h.at)}
                                  {h.note && <div className="alm-note">“{h.note}”</div>}
                                </div>
                              ))}
                          </details>
                        )}
                      </div>
                    )}

                    <div className="alm-row-actions no-print">
                      {noting === key ? (
                        <div className="alm-noting">
                          <input
                            className="input"
                            style={{ height: 32, fontSize: 13, flex: 1, minWidth: 200 }}
                            autoFocus
                            placeholder={tr("What was it? (optional)")}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void act(a, "dismiss", note);
                              if (e.key === "Escape") {
                                setNoting(null);
                                setNote("");
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ height: 32, fontSize: 12 }}
                            disabled={busy === key}
                            onClick={() => void act(a, "dismiss", note)}
                          >
                            {tr("Save")}
                          </button>
                          <button
                            type="button"
                            className="text-xs underline text-brand-400"
                            onClick={() => {
                              setNoting(null);
                              setNote("");
                            }}
                          >
                            {tr("Cancel")}
                          </button>
                        </div>
                      ) : a.dismissed ? (
                        <button
                          type="button"
                          className="text-xs underline text-brand-400"
                          disabled={busy === key}
                          onClick={() => void act(a, "reopen", "")}
                        >
                          {tr("Put it back")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ height: 30, fontSize: 12 }}
                          onClick={() => {
                            setNoting(key);
                            setNote("");
                          }}
                        >
                          {tr("Dismiss with a note")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
