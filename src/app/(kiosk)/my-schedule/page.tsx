"use client";

import { useEffect, useState } from "react";

/**
 * The employee's window on the roster: when am I working, who is on with me,
 * and the four things worth saying back — I can't come, could I change, I
 * can cover, I want more hours. Reached from the kiosk's keypad (which hands
 * the PIN over so nobody types it twice in five seconds), from the corner
 * link, or typed on a phone. Nothing here is fenced, because "I can't come
 * in" is a message that mostly gets sent from home.
 *
 * ENGLISH ONLY, by the owner's call — the doubled lines read as clutter on a
 * small screen. The PIN cards everyone was handed carry the Spanish.
 *
 * THE PHONE GATE: the server sends `needsPhone` instead of the schedule
 * until a number is on file, so the first visit is the number, then the
 * roster — not a skippable nag.
 *
 * A MANAGER LANDS HERE TOO, from the same keypad as everybody else — so
 * their half of the system is a button, not a thing they have to know the
 * address of. The button trades the same PIN for a register session and
 * walks them to the desk; the fence and the night rule judge that trade
 * like any other.
 */

type Day = {
  date: string;
  weekday: number;
  shift: { start: string; end: string; breakMinutes: number; note: string | null } | null;
  coworkers: string[];
};
type Req = {
  id: number;
  kind: "call_off" | "change" | "cover_offer" | "more_hours";
  workDate: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  hoursWanted: number | null;
  note: string | null;
  status: "open" | "approved" | "declined" | "withdrawn";
  resolutionNote: string | null;
  resolvedByName: string | null;
};
type Panel = {
  needsPhone: boolean;
  name: string;
  phone?: string;
  canManage?: boolean;
  days?: Day[];
  requests?: Req[];
};

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const toMinutes = (v: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const STATUS: Record<Req["status"], { label: string; cls: string }> = {
  open: { label: "Waiting for a manager", cls: "bg-amber-500/20 text-amber-200" },
  approved: { label: "Approved", cls: "bg-emerald-500/20 text-emerald-200" },
  declined: { label: "Declined", cls: "bg-red-500/25 text-red-200" },
  withdrawn: { label: "Withdrawn", cls: "bg-white/10 text-white/50" },
};

const KIND: Record<Req["kind"], string> = {
  call_off: "Can't come",
  change: "Change",
  cover_offer: "Can cover",
  more_hours: "More hours",
};

export default function MySchedulePage() {
  const [pin, setPin] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [editPhone, setEditPhone] = useState(false);
  /** Which seven days are showing: 0 = this week, up to 3. */
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<{ date: string; kind: "call_off" | "change" } | null>(null);
  const [note, setNote] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [coverFrom, setCoverFrom] = useState("");
  const [coverTo, setCoverTo] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [hoursWanted, setHoursWanted] = useState("");
  const [hoursNote, setHoursNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);

  /*
    The kiosk's keypad leaves the PIN in sessionStorage on the way over;
    read once, burned immediately, used to sign straight in. A PIN proved on
    this page is put back so a refresh does not demand it again — same tab,
    same person holding the device.
  */
  useEffect(() => {
    let handed: string | null = null;
    try {
      handed = sessionStorage.getItem("msPin");
      sessionStorage.removeItem("msPin");
    } catch {
      /* storage refused — ask normally */
    }
    if (handed && /^\d{4}$/.test(handed)) {
      setPin(handed);
      void load(handed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(currentPin: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkin/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: currentPin }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Try again");
        try {
          sessionStorage.removeItem("msPin");
        } catch {}
        return;
      }
      setPanel(d);
      try {
        sessionStorage.setItem("msPin", currentPin);
      } catch {}
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  async function savePhone() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkin/schedule/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, phone: phoneDraft }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Try again");
        return;
      }
      setEditPhone(false);
      setPhoneDraft("");
      await load(pin);
    } finally {
      setBusy(false);
    }
  }

  async function send(bodyExtra: Record<string, unknown>, saidText: string) {
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      const res = await fetch("/api/checkin/schedule/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, action: "create", ...bodyExtra }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Try again");
        return false;
      }
      setSaid(saidText);
      await load(pin);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: number) {
    setBusy(true);
    try {
      await fetch("/api/checkin/schedule/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, action: "withdraw", id }),
      });
      await load(pin);
    } finally {
      setBusy(false);
    }
  }

  /** Trade the proved PIN for a register session and walk to the desk. */
  async function openDesk() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/auth/kiosk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Could not open the register");
        return;
      }
      window.location.href = "/pos/schedule";
    } finally {
      setBusy(false);
    }
  }

  // ── Sign-in ──────────────────────────────────────────────────────────────
  if (!panel) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 kiosk-bg">
        <div className="acrylic-dark w-full max-w-md rounded-3xl p-8 text-white" style={{ borderRadius: 24 }}>
          <h1 className="text-2xl font-bold mb-6">My schedule</h1>
          <p className="text-white/80 mb-4">Type your PIN.</p>
          <input
            className="w-full rounded-xl bg-white/10 border border-white/20 px-4 py-3 text-2xl tracking-[0.5em] text-center"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            autoFocus
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              setPin(v);
              setError(null);
              if (v.length === 4) void load(v);
            }}
          />
          {error && <p className="mt-4 text-red-300">{error}</p>}
          {busy && <p className="mt-4 text-white/50">…</p>}
          <a href="/" className="mt-6 inline-block text-white/40 hover:text-white/80 text-sm">
            ← Time clock
          </a>
        </div>
      </main>
    );
  }

  // ── The phone gate ───────────────────────────────────────────────────────
  if (panel.needsPhone) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 kiosk-bg">
        <div className="acrylic-dark w-full max-w-md rounded-3xl p-8 text-white" style={{ borderRadius: 24 }}>
          <h1 className="text-xl font-bold mb-4">{panel.name} — one thing first.</h1>
          <p className="text-white/80 mb-4">
            The shop needs a phone number for you — it is how a manager reaches you about a shift.
            You can change it here any time.
          </p>
          <input
            className="w-full rounded-xl bg-white/10 border border-white/20 px-4 py-3 text-xl"
            type="tel"
            inputMode="tel"
            placeholder="210 555 1234"
            value={phoneDraft}
            autoFocus
            onChange={(e) => setPhoneDraft(e.target.value)}
          />
          {error && <p className="mt-3 text-red-300">{error}</p>}
          <button
            type="button"
            className="mt-4 w-full rounded-xl py-3 font-semibold text-[#0a2540] disabled:opacity-50"
            style={{ background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)" }}
            disabled={busy || phoneDraft.replace(/\D/g, "").length < 10}
            onClick={() => void savePhone()}
          >
            Save
          </button>
        </div>
      </main>
    );
  }

  // ── The panel ────────────────────────────────────────────────────────────
  const all = panel.days ?? [];
  const days = all.slice(page * 7, page * 7 + 7);
  const pages = Math.ceil(all.length / 7);
  const requests = panel.requests ?? [];
  const weekLabel =
    days.length > 0
      ? `${days[0].date.slice(5).replace("-", "/")} – ${days[days.length - 1].date.slice(5).replace("-", "/")}`
      : "";

  return (
    <main className="min-h-screen p-4 sm:p-6 kiosk-bg flex flex-col items-center">
      <div className="w-full max-w-2xl text-white">
        <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{panel.name}</h1>
            <p className="text-white/50 text-sm">
              {panel.phone} ·{" "}
              <button type="button" className="underline text-white/60" onClick={() => setEditPhone((v) => !v)}>
                change number
              </button>
            </p>
          </div>
          <a href="/" className="text-white/40 hover:text-white/80 text-sm">
            ← Time clock
          </a>
        </div>

        {/* The desk, for the half of the audience that runs it. */}
        {panel.canManage && (
          <button
            type="button"
            className="w-full rounded-2xl px-4 py-3 mb-4 font-semibold text-[#0a2540] disabled:opacity-50"
            style={{ background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)" }}
            disabled={busy}
            onClick={() => void openDesk()}
          >
            Open the shift desk — approve requests, move the week, see who is in →
          </button>
        )}

        {editPhone && (
          <div className="acrylic-dark rounded-2xl p-4 mb-4">
            <input
              className="w-full rounded-xl bg-white/10 border border-white/20 px-4 py-2"
              type="tel"
              inputMode="tel"
              placeholder="210 555 1234"
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
            />
            <button
              type="button"
              className="mt-3 rounded-xl px-4 py-2 font-semibold text-[#0a2540] disabled:opacity-50"
              style={{ background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)" }}
              disabled={busy || phoneDraft.replace(/\D/g, "").length < 10}
              onClick={() => void savePhone()}
            >
              Save
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-2xl bg-red-500/20 border border-red-400/40 px-4 py-3 mb-4 text-red-100">
            {error}
          </div>
        )}
        {said && (
          <div className="rounded-2xl bg-emerald-500/15 border border-emerald-400/40 px-4 py-3 mb-4 text-emerald-100">
            {said}
          </div>
        )}

        {/* ── The week showing ───────────────────────────────────────────── */}
        <div className="acrylic-dark rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold">
              {page === 0 ? "This week" : `Week of ${weekLabel}`}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 bg-white/10 border border-white/20 disabled:opacity-30"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Earlier week"
              >
                ‹
              </button>
              <span className="text-white/40 text-xs tabular-nums">
                {page + 1} / {pages}
              </span>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 bg-white/10 border border-white/20 disabled:opacity-30"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Later week"
              >
                ›
              </button>
            </div>
          </div>
          <div className="divide-y divide-white/10">
            {days.map((d) => {
              const isForm = form?.date === d.date;
              const [, m, dd] = d.date.split("-");
              return (
                <div key={d.date} className="py-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="w-28 shrink-0 font-medium">
                      {DAYS_EN[d.weekday]} <span className="text-white/40">{Number(m)}/{Number(dd)}</span>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      {d.shift ? (
                        <span className="font-semibold text-amber-300">
                          {d.shift.start} – {d.shift.end}
                        </span>
                      ) : (
                        <span className="text-white/30">— off</span>
                      )}
                      {d.coworkers.length > 0 && (
                        <div className="text-white/45 text-xs">with: {d.coworkers.join(", ")}</div>
                      )}
                    </div>
                    {d.shift && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="text-xs rounded-lg px-2.5 py-1.5 bg-red-500/20 border border-red-400/40 text-red-100"
                          onClick={() => {
                            setForm(isForm && form?.kind === "call_off" ? null : { date: d.date, kind: "call_off" });
                            setNote("");
                          }}
                        >
                          Can&apos;t come
                        </button>
                        <button
                          type="button"
                          className="text-xs rounded-lg px-2.5 py-1.5 bg-white/10 border border-white/20 text-white/80"
                          onClick={() => {
                            setForm(isForm && form?.kind === "change" ? null : { date: d.date, kind: "change" });
                            setNote("");
                            setStart("");
                            setEnd("");
                          }}
                        >
                          Change
                        </button>
                      </div>
                    )}
                  </div>

                  {isForm && form && (
                    <div className="mt-3 rounded-xl bg-white/5 border border-white/15 p-3">
                      {form.kind === "change" && (
                        <div className="flex gap-3 mb-3 flex-wrap items-center">
                          <label className="text-sm text-white/70">
                            from{" "}
                            <input
                              type="time"
                              className="rounded-lg bg-white/10 border border-white/20 px-2 py-1 ml-1"
                              value={start}
                              onChange={(e) => setStart(e.target.value)}
                            />
                          </label>
                          <label className="text-sm text-white/70">
                            to{" "}
                            <input
                              type="time"
                              className="rounded-lg bg-white/10 border border-white/20 px-2 py-1 ml-1"
                              value={end}
                              onChange={(e) => setEnd(e.target.value)}
                            />
                          </label>
                        </div>
                      )}
                      <textarea
                        className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm"
                        rows={2}
                        placeholder={form.kind === "call_off" ? "Why?" : "What are you asking?"}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        type="button"
                        className="mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-[#0a2540] disabled:opacity-50"
                        style={{ background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)" }}
                        disabled={busy}
                        onClick={() =>
                          void send(
                            {
                              kind: form.kind,
                              workDate: form.date,
                              proposedStartMinute: form.kind === "change" && start ? toMinutes(start) : null,
                              proposedEndMinute: form.kind === "change" && end ? toMinutes(end) : null,
                              note: note.trim() || null,
                            },
                            "Sent — a manager will answer here.",
                          ).then((ok) => {
                            if (ok) {
                              setForm(null);
                              setNote("");
                            }
                          })
                        }
                      >
                        Send to a manager
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── I can cover ────────────────────────────────────────────────── */}
        <div className="acrylic-dark rounded-2xl p-4 mb-4">
          <h2 className="font-semibold mb-1">I can cover</h2>
          <p className="text-white/50 text-sm mb-3">
            If somebody doesn&apos;t show on these days, call me. One day, or a stretch.
          </p>
          <div className="flex gap-3 flex-wrap items-center">
            <input
              type="date"
              className="rounded-lg bg-white/10 border border-white/20 px-3 py-2"
              value={coverFrom}
              min={all[0]?.date}
              onChange={(e) => {
                setCoverFrom(e.target.value);
                if (!coverTo || coverTo < e.target.value) setCoverTo(e.target.value);
              }}
            />
            <span className="text-white/40">to</span>
            <input
              type="date"
              className="rounded-lg bg-white/10 border border-white/20 px-3 py-2"
              value={coverTo}
              min={coverFrom || all[0]?.date}
              onChange={(e) => setCoverTo(e.target.value)}
            />
            <input
              className="flex-1 min-w-[140px] rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm"
              placeholder="Anything to add?"
              value={coverNote}
              onChange={(e) => setCoverNote(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-[#0a2540] disabled:opacity-50"
              style={{ background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)" }}
              disabled={busy || !coverFrom}
              onClick={() =>
                void send(
                  {
                    kind: "cover_offer",
                    workDate: coverFrom,
                    endDate: coverTo || coverFrom,
                    note: coverNote.trim() || null,
                  },
                  "Noted — they will call if a day needs you.",
                ).then((ok) => {
                  if (ok) {
                    setCoverFrom("");
                    setCoverTo("");
                    setCoverNote("");
                  }
                })
              }
            >
              Raise my hand
            </button>
          </div>
        </div>

        {/* ── More hours ─────────────────────────────────────────────────── */}
        <div className="acrylic-dark rounded-2xl p-4 mb-4">
          <h2 className="font-semibold mb-1">I want more hours</h2>
          <p className="text-white/50 text-sm mb-3">
            Tell the managers how many more a week you are after.
          </p>
          <div className="flex gap-3 flex-wrap items-center">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={80}
              className="w-24 rounded-lg bg-white/10 border border-white/20 px-3 py-2"
              placeholder="hours"
              value={hoursWanted}
              onChange={(e) => setHoursWanted(e.target.value)}
            />
            <input
              className="flex-1 min-w-[140px] rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm"
              placeholder="Anything to add?"
              value={hoursNote}
              onChange={(e) => setHoursNote(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-[#0a2540] disabled:opacity-50"
              style={{ background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)" }}
              disabled={busy || !hoursWanted || Number(hoursWanted) <= 0}
              onClick={() =>
                void send(
                  {
                    kind: "more_hours",
                    hoursWanted: Number(hoursWanted),
                    note: hoursNote.trim() || null,
                  },
                  "Sent — a manager will answer here.",
                ).then((ok) => {
                  if (ok) {
                    setHoursWanted("");
                    setHoursNote("");
                  }
                })
              }
            >
              Ask
            </button>
          </div>
        </div>

        {/* ── My requests ────────────────────────────────────────────────── */}
        {requests.length > 0 && (
          <div className="acrylic-dark rounded-2xl p-4 mb-8">
            <h2 className="font-semibold mb-3">What I have asked</h2>
            <div className="divide-y divide-white/10">
              {requests.map((r) => (
                <div key={r.id} className="py-2 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <span className="font-medium">{KIND[r.kind]}</span>{" "}
                    {r.workDate && <span className="text-white/50">{r.workDate}</span>}
                    {r.hoursWanted !== null && (
                      <span className="text-white/50"> · {r.hoursWanted}h a week</span>
                    )}
                    {r.proposedStart && (
                      <span className="text-white/50">
                        {" "}
                        · {r.proposedStart}–{r.proposedEnd}
                      </span>
                    )}
                    {r.note && <div className="text-white/45 text-xs">{r.note}</div>}
                    {r.resolutionNote && (
                      <div className="text-white/60 text-xs">
                        {r.resolvedByName ? `${r.resolvedByName}: ` : ""}
                        {r.resolutionNote}
                      </div>
                    )}
                  </div>
                  <span className={`text-xs rounded-full px-2.5 py-1 ${STATUS[r.status].cls}`}>
                    {STATUS[r.status].label}
                  </span>
                  {r.status === "open" && (
                    <button
                      type="button"
                      className="text-xs text-white/50 underline"
                      onClick={() => void withdraw(r.id)}
                    >
                      take it back
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
