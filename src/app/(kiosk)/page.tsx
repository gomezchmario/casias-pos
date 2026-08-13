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
  actions: EntryType[];
};

type Phase = "idle" | "looking_up" | "ready" | "submitting" | "result";

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

  async function handleAction(action: EntryType) {
    if (!lookup || submitInFlight.current) return;
    submitInFlight.current = true;
    setPhase("submitting");
    const photoData = cameraRef.current?.capture() ?? null;
    try {
      const res = await fetch("/api/checkin/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, action, photoData }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setToast({ kind: "error", title: data.error || "Action failed" });
        setPhase("result");
        scheduleReset(2500);
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
      const res = await fetch("/api/pos/auth/kiosk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
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
              <div className="text-sm text-white/70 mt-1">
                {lookup?.state === "checked_out" &&
                  "You're currently checked out."}
                {lookup?.state === "checked_in" && "You're currently working."}
                {lookup?.state === "on_break" && "You're currently on break."}
              </div>
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
              <ActionButtons
                actions={lookup?.actions ?? []}
                onPick={handleAction}
                busy={phase === "submitting"}
              />

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
      <div className="fixed bottom-4 right-4 flex gap-4 text-xs">
        <a href="/leaderboard" className="text-white/40 hover:text-white/80 transition-colors">
          Leaderboard →
        </a>
        <a href="/inventory" className="text-white/40 hover:text-white/80 transition-colors">
          Inventory →
        </a>
        {/* The manual, and it belongs on this screen more than on any other.
            This is where somebody stands who has no register sign-in and no
            admin password — a technician, on his fourth day, wondering what
            happens if he presses the wrong button. The page it opens is public
            for exactly that reason. */}
        <a href="/help" className="text-white/40 hover:text-white/80 transition-colors">
          Help →
        </a>
        <a href="/admin" className="text-white/40 hover:text-white/80 transition-colors">
          Admin →
        </a>
      </div>
    </main>
  );
}
