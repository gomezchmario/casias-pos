"use client";

import { useState } from "react";

/**
 * The employee's window on the roster: when am I working, who is on with me,
 * and the three things worth saying back — I can't come, could I change, I
 * can cover. Reached from the kiosk's corner or typed on a phone; a PIN is
 * the whole sign-in, and nothing here is fenced because "I can't come in" is
 * a message that mostly gets sent from home.
 *
 * BILINGUAL INLINE, like the PIN cards, rather than through the register's
 * toggle: the person this page most has to work for is a mechanic reading it
 * on his own phone in the parking lot, and a language switch he has to find
 * first is a coin-flip he should not have to win.
 *
 * THE PHONE GATE: the server sends `needsPhone` instead of the schedule until
 * a number is on file, so the first visit is the number, then the roster —
 * not a skippable nag. The number can be changed here any time after.
 */

type Day = {
  date: string;
  weekday: number;
  shift: { start: string; end: string; breakMinutes: number; note: string | null } | null;
  coworkers: string[];
};
type Req = {
  id: number;
  kind: "call_off" | "change" | "cover_offer";
  workDate: string;
  proposedStart: string | null;
  proposedEnd: string | null;
  note: string | null;
  status: "open" | "approved" | "declined" | "withdrawn";
  resolutionNote: string | null;
  resolvedByName: string | null;
};
type Panel = {
  needsPhone: boolean;
  name: string;
  phone?: string;
  days?: Day[];
  requests?: Req[];
};

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function dayLabel(d: Day): { en: string; es: string; md: string } {
  const [, m, day] = d.date.split("-");
  return { en: DAYS_EN[d.weekday], es: DAYS_ES[d.weekday], md: `${Number(m)}/${Number(day)}` };
}

/** Minutes from a time input's "HH:MM". */
const toMinutes = (v: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const STATUS: Record<Req["status"], { en: string; es: string; cls: string }> = {
  open: { en: "Waiting for a manager", es: "Esperando a un gerente", cls: "bg-amber-500/20 text-amber-200" },
  approved: { en: "Approved", es: "Aprobado", cls: "bg-emerald-500/20 text-emerald-200" },
  declined: { en: "Declined", es: "Rechazado", cls: "bg-red-500/25 text-red-200" },
  withdrawn: { en: "Withdrawn", es: "Retirado", cls: "bg-white/10 text-white/50" },
};

const KIND: Record<Req["kind"], { en: string; es: string }> = {
  call_off: { en: "Can't come", es: "No puedo venir" },
  change: { en: "Change", es: "Cambio" },
  cover_offer: { en: "Can cover", es: "Puedo cubrir" },
};

export default function MySchedulePage() {
  const [pin, setPin] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [editPhone, setEditPhone] = useState(false);
  /** Which day's ask form is open, and which kind. */
  const [form, setForm] = useState<{ date: string; kind: Req["kind"] } | null>(null);
  const [note, setNote] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [coverDate, setCoverDate] = useState("");

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
        return;
      }
      setPanel(d);
    } catch {
      setError("Network error · Error de red");
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

  async function sendRequest(kind: Req["kind"], workDate: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkin/schedule/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          action: "create",
          kind,
          workDate,
          proposedStartMinute: kind === "change" && start ? toMinutes(start) : null,
          proposedEndMinute: kind === "change" && end ? toMinutes(end) : null,
          note: note.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Try again");
        return;
      }
      setForm(null);
      setNote("");
      setStart("");
      setEnd("");
      setCoverDate("");
      await load(pin);
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

  // ── Sign-in ──────────────────────────────────────────────────────────────
  if (!panel) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 kiosk-bg">
        <div className="acrylic-dark w-full max-w-md rounded-3xl p-8 text-white" style={{ borderRadius: 24 }}>
          <h1 className="text-2xl font-bold mb-1">My schedule</h1>
          <p className="text-white/60 mb-6 italic">Mi horario</p>
          <p className="text-white/80 mb-1">Type your PIN.</p>
          <p className="text-white/50 text-sm italic mb-4">Escriba su clave.</p>
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
            ← Time clock · Reloj
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
          <h1 className="text-xl font-bold mb-4">
            {panel.name} — one thing first.
            <span className="block text-white/60 font-normal italic">Una cosa primero.</span>
          </h1>
          <p className="text-white/80 mb-1">
            The shop needs a phone number for you — it is how a manager reaches you about a shift.
          </p>
          <p className="text-white/50 text-sm italic mb-4">
            El taller necesita su número de teléfono — así le avisa un gerente sobre un turno.
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
            Save · Guardar
          </button>
        </div>
      </main>
    );
  }

  // ── The panel ────────────────────────────────────────────────────────────
  const days = panel.days ?? [];
  const requests = panel.requests ?? [];

  return (
    <main className="min-h-screen p-4 sm:p-6 kiosk-bg flex flex-col items-center">
      <div className="w-full max-w-2xl text-white">
        <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{panel.name}</h1>
            <p className="text-white/50 text-sm">
              {panel.phone} ·{" "}
              <button type="button" className="underline text-white/60" onClick={() => setEditPhone((v) => !v)}>
                change number · cambiar número
              </button>
            </p>
          </div>
          <a href="/" className="text-white/40 hover:text-white/80 text-sm">
            ← Time clock · Reloj
          </a>
        </div>

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
              Save · Guardar
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-2xl bg-red-500/20 border border-red-400/40 px-4 py-3 mb-4 text-red-100">
            {error}
          </div>
        )}

        {/* ── The next two weeks ─────────────────────────────────────────── */}
        <div className="acrylic-dark rounded-2xl p-4 mb-4">
          <h2 className="font-semibold mb-0.5">The next two weeks</h2>
          <p className="text-white/50 text-sm italic mb-3">Las próximas dos semanas</p>
          <div className="divide-y divide-white/10">
            {days.map((d) => {
              const l = dayLabel(d);
              const isForm = form?.date === d.date;
              return (
                <div key={d.date} className="py-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="w-28 shrink-0">
                      <div className="font-medium">
                        {l.en} <span className="text-white/40">{l.md}</span>
                      </div>
                      <div className="text-white/40 text-xs italic">{l.es}</div>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      {d.shift ? (
                        <span className="font-semibold text-amber-300">
                          {d.shift.start} – {d.shift.end}
                        </span>
                      ) : (
                        <span className="text-white/30">— off · descansa</span>
                      )}
                      {d.coworkers.length > 0 && (
                        <div className="text-white/45 text-xs">
                          with · con: {d.coworkers.join(", ")}
                        </div>
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
                          {KIND.call_off.en} · {KIND.call_off.es}
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
                          {KIND.change.en} · {KIND.change.es}
                        </button>
                      </div>
                    )}
                  </div>

                  {isForm && form && (
                    <div className="mt-3 rounded-xl bg-white/5 border border-white/15 p-3">
                      {form.kind === "change" && (
                        <div className="flex gap-3 mb-3 flex-wrap items-center">
                          <label className="text-sm text-white/70">
                            from · de{" "}
                            <input
                              type="time"
                              className="rounded-lg bg-white/10 border border-white/20 px-2 py-1 ml-1"
                              value={start}
                              onChange={(e) => setStart(e.target.value)}
                            />
                          </label>
                          <label className="text-sm text-white/70">
                            to · a{" "}
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
                        placeholder={
                          form.kind === "call_off"
                            ? "Why? · ¿Por qué?"
                            : "What are you asking? · ¿Qué pide?"
                        }
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        type="button"
                        className="mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-[#0a2540] disabled:opacity-50"
                        style={{ background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)" }}
                        disabled={busy}
                        onClick={() => void sendRequest(form.kind, form.date)}
                      >
                        Send to a manager · Mandar a un gerente
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
          <h2 className="font-semibold mb-0.5">I can cover a day</h2>
          <p className="text-white/50 text-sm italic mb-3">
            Puedo cubrir un día — si alguien no llega, llámenme.
          </p>
          <div className="flex gap-3 flex-wrap items-center">
            <input
              type="date"
              className="rounded-lg bg-white/10 border border-white/20 px-3 py-2"
              value={coverDate}
              min={days[0]?.date}
              onChange={(e) => setCoverDate(e.target.value)}
            />
            <input
              className="flex-1 min-w-[160px] rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm"
              placeholder="Anything to add? · ¿Algo que agregar?"
              value={form === null ? note : ""}
              onChange={(e) => {
                setForm(null);
                setNote(e.target.value);
              }}
            />
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-[#0a2540] disabled:opacity-50"
              style={{ background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)" }}
              disabled={busy || !coverDate}
              onClick={() => void sendRequest("cover_offer", coverDate)}
            >
              Raise my hand · Me apunto
            </button>
          </div>
        </div>

        {/* ── My requests ────────────────────────────────────────────────── */}
        {requests.length > 0 && (
          <div className="acrylic-dark rounded-2xl p-4 mb-8">
            <h2 className="font-semibold mb-0.5">What I have asked</h2>
            <p className="text-white/50 text-sm italic mb-3">Lo que he pedido</p>
            <div className="divide-y divide-white/10">
              {requests.map((r) => (
                <div key={r.id} className="py-2 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <span className="font-medium">
                      {KIND[r.kind].en} · {KIND[r.kind].es}
                    </span>{" "}
                    <span className="text-white/50">{r.workDate}</span>
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
                    {STATUS[r.status].en} · {STATUS[r.status].es}
                  </span>
                  {r.status === "open" && (
                    <button
                      type="button"
                      className="text-xs text-white/50 underline"
                      onClick={() => void withdraw(r.id)}
                    >
                      take it back · retirar
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
