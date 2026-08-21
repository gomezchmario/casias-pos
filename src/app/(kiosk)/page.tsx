"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock } from "@/components/kiosk/Clock";
import { Keypad } from "@/components/kiosk/Keypad";
import { PinDots } from "@/components/kiosk/PinDots";
import {
  CameraPreview,
  type CameraHandle,
} from "@/components/kiosk/CameraPreview";
import { ActionButtons } from "@/components/kiosk/ActionButtons";
import { BrandLogo } from "@/components/ui/BrandLogo";
import type { EntryType } from "@/lib/entries";

type LookupResult = {
  ok: true;
  employee: {
    id: number;
    name: string;
    role: string | null;
    posRole: string;
    canRegister: boolean;
  };
  state: "checked_out" | "checked_in" | "on_break";
  /** Minutes worked so far today, and when the current stretch began. */
  todayMinutes: number;
  since: string | null;
  /** Today's rostered shift, when the schedule has one for this person. */
  shift: { startMinute: number; endMinute: number } | null;
  actions: EntryType[];
  /** Set when this account has no clock buttons at all — see the lookup route. */
  noClockReason?: string | null;
};

type Phase = "idle" | "looking_up" | "ready" | "submitting" | "result";

/** "8am" / "6:30pm" from minutes past midnight, for the shift line. */
function clockOfMinute(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm === 0 ? `${h12}${ampm}` : `${h12}:${String(mm).padStart(2, "0")}${ampm}`;
}

type Toast = {
  kind: "success" | "error" | "info";
  title: string;
  body?: string;
} | null;

const RESET_AFTER_MS = 3500;

export default function KioskPage() {
  const [pin, setPin] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [pinInvalid, setPinInvalid] = useState(false);
  const cameraRef = useRef<CameraHandle | null>(null);
  const submitInFlight = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setPin("");
    setLookup(null);
    setPhase("idle");
    setToast(null);
    setPinInvalid(false);
    submitInFlight.current = false;
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  const scheduleReset = useCallback(
    (ms = RESET_AFTER_MS) => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(reset, ms);
    },
    [reset],
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (phase !== "idle" || pinInvalid) return;
      setPin((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + d;
        if (next.length === 4) {
          // Auto-submit after 4th digit.
          setTimeout(() => doLookup(next), 120);
        }
        return next;
      });
    },
    [phase, pinInvalid],
  );

  const handleClear = useCallback(() => {
    if (phase === "submitting") return;
    if (phase === "ready") {
      reset();
      return;
    }
    setPin("");
    setPinInvalid(false);
  }, [phase, reset]);

  const handleSubmitPin = useCallback(() => {
    if (pin.length === 4 && phase === "idle") doLookup(pin);
  }, [pin, phase]);

  /**
   * Seconds left on a lockout, counted down on screen.
   *
   * Held here rather than read from the clock on each render so the pad can be
   * dead for exactly as long as the server says it is, and come back on its own
   * without anybody reloading the page.
   */
  const [lockedFor, setLockedFor] = useState(0);
  useEffect(() => {
    if (lockedFor <= 0) return;
    const t = setInterval(() => setLockedFor((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [lockedFor]);

  async function doLookup(pinValue: string) {
    setPhase("looking_up");
    try {
      const res = await fetch("/api/checkin/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinValue }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (typeof data.lockedForSeconds === "number") setLockedFor(data.lockedForSeconds);
        setPinInvalid(true);
        setToast({
          kind: "error",
          title: data.error || "PIN not recognized",
        });
        scheduleReset(2000);
        return;
      }
      setLookup(data as LookupResult);
      setPhase("ready");
    } catch {
      setToast({ kind: "error", title: "Network error — try again" });
      scheduleReset(2500);
    }
  }

  /*
    Where this device says it is, or nothing.

    ASKED EVERY TIME, and never remembered. A cached fix from an hour ago is a
    claim about where the phone WAS, and the whole question here is where it is
    now; `maximumAge: 0` is the difference between a fence and a formality.

    NEVER BLOCKS THE PUNCH ON ITS OWN. If the browser refuses, or the fix times
    out under a metal roof, this resolves to nothing at all and the server
    decides what that means — which is the correct place for the decision,
    since a trusted device does not need a location and this page has no way of
    knowing whether it is one. A phone with location switched off still punches
    fine at the counter tablet; only an untrusted device far from the shop is
    turned away, and the server says so in words.

    Ten seconds, because the punch is the last thing somebody does before
    walking to the bay and a clock that hangs on a satellite fix is a clock
    people stop using.
  */
  async function whereAmI(): Promise<{
    lat?: number;
    lng?: number;
    accuracy?: number;
  }> {
    if (!navigator.geolocation) return {};
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: { lat?: number; lng?: number; accuracy?: number }) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          finish({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        () => finish({}),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
      setTimeout(() => finish({}), 11000);
    });
  }

  async function handleAction(action: EntryType) {
    if (!lookup || submitInFlight.current) return;
    submitInFlight.current = true;
    setPhase("submitting");
    const photoData = cameraRef.current?.capture() ?? null;
    const where = await whereAmI();
    try {
      const res = await fetch("/api/checkin/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, action, photoData, ...where }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setToast({
          kind: "error",
          title: data.error || "Action failed",
          // A refusal by the fence is the one error here somebody can act on,
          // and it stays up twice as long because it is read rather than
          // glanced at — and because the reader is usually surprised.
          body: data.fence ? "Nothing was recorded." : undefined,
        });
        setPhase("result");
        scheduleReset(data.fence ? 6000 : 2500);
        return;
      }
      const time = new Date(data.timestamp).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const verb =
        action === "check_in"
          ? "checked in"
          : action === "check_out"
            ? "checked out"
            : action === "break_start"
              ? "started break"
              : "ended break";
      setToast({
        kind: "success",
        title: `${data.employee.name} ${verb}`,
        body: `at ${time}${data.flagged ? " · no photo captured" : ""}`,
      });
      setPhase("result");
      scheduleReset();
    } catch {
      setToast({ kind: "error", title: "Network error — try again" });
      setPhase("result");
      scheduleReset(2500);
    }
  }

  // Trade the PIN already entered for a register session, so a cashier punches
  // in and rings up from one screen instead of signing in twice.
  async function openRegister() {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setPhase("submitting");
    try {
      // The register is fenced the same way the clock is, so it carries the
      // same reading a punch would. On a trusted device the server never
      // looks at it; on a phone it is what gets the door open.
      const where = await whereAmI();
      const res = await fetch("/api/pos/auth/kiosk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, lat: where.lat ?? null, lng: where.lng ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ kind: "error", title: data.error || "Could not open the register" });
        setPhase("result");
        scheduleReset(2500);
        submitInFlight.current = false;
        return;
      }
      window.location.href = "/pos";
    } catch {
      setToast({ kind: "error", title: "Network error — try again" });
      setPhase("result");
      scheduleReset(2500);
      submitInFlight.current = false;
    }
  }

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const showActions = phase === "ready" || phase === "submitting";
  const showToast = toast !== null;
  /* Dead while the lockout runs, and back on its own when it expires — the
     countdown above ticks to zero and the pad simply works again, without
     anybody reloading the page or being told to. The server refuses either
     way; this is so nobody spends five minutes pressing a pad that cannot
     answer them. */
  const keypadDisabled = phase !== "idle" || lockedFor > 0;
  const canSubmitPin = pin.length === 4 && phase === "idle" && lockedFor === 0;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 kiosk-bg" style={{ position: "relative" }}>

      {/* Header */}
      <div className="w-full max-w-2xl flex items-center justify-between mb-6">
        <BrandLogo size="lg" />
        <Clock />
      </div>

      {/* Main card */}
      <div
        className="acrylic-dark w-full max-w-2xl rounded-3xl p-8 animate-fade-in"
        style={{ borderRadius: 24 }}
      >
        {/* Camera */}
        <div className="flex justify-center mb-6">
          <div
            className={
              phase === "submitting" ? "animate-pulse-ring rounded-full" : ""
            }
          >
            <CameraPreview ref={cameraRef} size={200} />
          </div>
        </div>

        {/* PIN dots / Greeting */}
        <div className="text-center mb-6 min-h-[60px]">
          {phase === "idle" || phase === "looking_up" ? (
            <>
              <PinDots filled={pin.length} invalid={pinInvalid} />
              <div className="mt-3 text-sm text-white/70">
                {lockedFor > 0
                  ? `Too many wrong PINs — try again in ${Math.floor(lockedFor / 60)}:${String(lockedFor % 60).padStart(2, "0")}`
                  : pinInvalid
                    ? "PIN not recognized — try again"
                    : phase === "looking_up"
                      ? "Looking up…"
                      : "Enter your 4-digit PIN"}
              </div>
            </>
          ) : (
            <div className="animate-pop-in">
              <div className="text-2xl font-semibold text-white">
                Hi, {lookup?.employee.name}
              </div>
              {/*
                The line under the name answers the question the person came
                with, not just the state machine's. "You're currently working"
                told them what they already knew; since-when and hours-so-far
                are what they walked over to find out, and the rostered shift
                is when they get to go home. All three were a walk to the
                office before this.
              */}
              <div className="text-sm text-white/70 mt-1">
                {lookup?.state === "checked_out" &&
                  (lookup.todayMinutes > 0
                    ? `Checked out — ${(lookup.todayMinutes / 60).toFixed(1)} h worked today.`
                    : "You're currently checked out.")}
                {lookup?.state === "checked_in" &&
                  `Working${
                    lookup.since
                      ? ` since ${new Date(lookup.since).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                      : ""
                  } · ${(lookup.todayMinutes / 60).toFixed(1)} h today.`}
                {lookup?.state === "on_break" &&
                  `On break · ${(lookup.todayMinutes / 60).toFixed(1)} h today.`}
              </div>
              {lookup?.shift && (
                <div className="text-xs text-white/50 mt-1">
                  Scheduled today {clockOfMinute(lookup.shift.startMinute)}–
                  {clockOfMinute(lookup.shift.endMinute)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Keypad or Action buttons */}
        <div className="max-w-sm mx-auto">
          {!showActions ? (
            <Keypad
              onDigit={handleDigit}
              onClear={handleClear}
              onSubmit={handleSubmitPin}
              disabled={keypadDisabled}
              canSubmit={canSubmitPin}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {lookup?.noClockReason ? (
                <div
                  className="text-center animate-pop-in"
                  style={{
                    padding: "0.9rem 1rem",
                    borderRadius: "0.75rem",
                    background: "rgba(255, 211, 90, 0.10)",
                    border: "1px solid rgba(255, 211, 90, 0.45)",
                    color: "rgba(255, 255, 255, 0.86)",
                    fontSize: "0.95rem",
                    lineHeight: 1.45,
                  }}
                >
                  {lookup.noClockReason}
                </div>
              ) : (
                <ActionButtons
                  actions={lookup?.actions ?? []}
                  onPick={handleAction}
                  busy={phase === "submitting"}
                />
              )}

              {/* Deliberately the same shape as Check In and Take a Break
                  rather than a full-width bar under them. Opening the register
                  is one of the things you might have come to this screen to do,
                  not a conclusion to the things above it, and a button twice the
                  width of its neighbours reads as the recommended one — which
                  for most people walking up to punch in, it isn't.

                  Outlined rather than filled gold, because filled gold is what
                  Check In already is — matching the size made the two read as
                  the same offer, which is the one thing this button must not
                  do. Outlined is unique against all four action treatments
                  (filled gold, navy, red, translucent white) whichever pair of
                  them the shift happens to be showing. */}
              {lookup?.employee.canRegister && (
                <div className="flex justify-center animate-pop-in">
                  <button
                    type="button"
                    onClick={() => void openRegister()}
                    disabled={phase === "submitting"}
                    className="btn reveal"
                    style={{
                      minWidth: 160,
                      padding: "0.85rem 1.2rem",
                      fontSize: "1.05rem",
                      fontWeight: 600,
                      background: "rgba(255, 211, 90, 0.10)",
                      borderColor: "rgba(255, 211, 90, 0.55)",
                      color: "#ffd35a",
                    }}
                  >
                    <span style={{ fontSize: "1.2rem" }}>🧾</span>
                    Open Register
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={reset}
                disabled={phase === "submitting"}
                className="btn btn-ghost mx-auto"
                style={{ marginTop: 8 }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {showToast && (
        <div
          className="fixed bottom-8 left-1/2 -translate-x-1/2 animate-slide-up"
          style={{ minWidth: 320, maxWidth: 480 }}
        >
          <div
            className="rounded-2xl px-6 py-4 flex items-start gap-3"
            style={{
              background:
                toast?.kind === "success"
                  ? "linear-gradient(180deg, #1f3f64 0%, #0a2540 100%)"
                  : toast?.kind === "error"
                    ? "linear-gradient(180deg, #d8444c 0%, #a71d24 100%)"
                    : "rgba(10,37,64,0.92)",
              color: "#fff",
              boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
              borderTop: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            <div className="text-2xl">
              {toast?.kind === "success" ? "✓" : toast?.kind === "error" ? "✕" : "ℹ"}
            </div>
            <div>
              <div className="font-semibold">{toast?.title}</div>
              {toast?.body && (
                <div className="text-sm opacity-85 mt-0.5">{toast.body}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin link (small, bottom corner). The register is reached by PIN
          above, not from here, so there's no unauthenticated door to it.

          The two read-only boards sit beside it and are the exceptions, on
          purpose. Inventory holds no cost, no P-code and no supplier, and
          everything on it is visible to anyone who walks up to the rack and
          asks. The leaderboard holds no income dollars and shows tips as
          shares. Behind a PIN both would go unused — "do we have a 215 55 17"
          is asked twenty times a day, usually by somebody with their hands
          full, and the answer they would actually use is the one they can get
          without stopping. The leaderboard has it worse still: it is meant to
          live fullscreen on a monitor nobody is standing at. */}
      {/* On a phone this corner stops being a corner — .kiosk-corner unpins
          it into the page flow below the card, because a fixed strip floats
          over the keypad on a small screen. Of the four links only Inventory
          survives there, and it grows into a real button: "do we have a
          215 55 17" is the one thing somebody on their own phone opens this
          screen for besides punching. Not a lock, a layout choice — the
          leaderboard is built for a wall monitor, Admin is typed at the shop
          PC, the manual is read sitting down, and all three stay one URL
          away. */}
      <div className="kiosk-corner fixed bottom-4 right-4 flex gap-4 text-xs">
        <a
          href="/leaderboard"
          className="kiosk-desk-only text-white/40 hover:text-white/80 transition-colors"
        >
          Leaderboard →
        </a>
        {/* The roster's own door, and on a phone the other button that
            survives the thinning: "when do I work next" is asked from a couch
            as often as the racks are checked from one. */}
        <a
          href="/my-schedule"
          className="kiosk-inv text-white/40 hover:text-white/80 transition-colors"
        >
          My schedule →
        </a>
        <a
          href="/inventory"
          className="kiosk-inv text-white/40 hover:text-white/80 transition-colors"
        >
          Inventory →
        </a>
        {/* The manual, and it belongs on this screen more than on any other.
            This is where somebody stands who has no register sign-in and no
            admin password — a technician, on his fourth day, wondering what
            happens if he presses the wrong button. The page it opens is public
            for exactly that reason. */}
        <a
          href="/help"
          className="kiosk-desk-only text-white/40 hover:text-white/80 transition-colors"
        >
          Help →
        </a>
        <a
          href="/admin"
          className="kiosk-desk-only text-white/40 hover:text-white/80 transition-colors"
        >
          Admin →
        </a>
      </div>
    </main>
  );
}
