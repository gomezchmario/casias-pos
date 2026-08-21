"use client";

import { useLang } from "@/components/pos/LangToggle";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keypad } from "@/components/kiosk/Keypad";
import { PinDots } from "@/components/kiosk/PinDots";
import { ShopLogo } from "@/components/ui/ShopLogo";

/**
 * What a locked register shows: a PIN pad that opens it again.
 *
 * This replaces both the old "Switch user" button and the dead end the lock
 * used to be. The two turned out to be the same feature. Handing the register
 * to someone else and coming back from lunch are the same physical act — a
 * different person is now standing at the counter — and the shop only wants one
 * way to say so, which is the one everybody already knows: type your PIN.
 *
 * Any employee's PIN works, not just the one who locked it. That is deliberate.
 * The register is a shared machine on a counter, the previous cashier may have
 * gone home, and a lock only its owner can open is a lock that gets propped
 * open. The session that comes back belongs to whoever typed, so the tickets
 * they ring are attributed to them.
 *
 * `/api/pos/auth/kiosk` does the work, which is the same endpoint the time
 * clock uses for its register button. It scans every hash rather than being
 * told who to check — slower than the register's own employee-first login, but
 * this is not on the hot path, and being asked "who are you" before "prove it"
 * would make coming back from lunch a two-screen job.
 */
export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useLang();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      try {
        let res = await fetch("/api/pos/auth/kiosk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: value }),
        });
        /*
          The register is fenced like the clock, and this screen asks for a
          location only when the server says one would help. Asked first
          rather than always, because on the shop's own trusted devices the
          server never wants one — and a lock screen that popped a location
          permission at every lunch break would teach everyone to dismiss
          permission prompts, which is the worst lesson a shop screen can
          teach. One retry, then whatever the server said stands.
        */
        if (res.status === 403) {
          const first = (await res.json().catch(() => ({}))) as {
            error?: string;
            fence?: string;
          };
          if (first.fence !== "no_location") {
            setError(first.error ?? "This device can't open the register");
            setPin("");
            return;
          }
          const where = await new Promise<{ lat?: number; lng?: number }>((resolve) => {
            if (!navigator.geolocation) return resolve({});
            let done = false;
            const finish = (v: { lat?: number; lng?: number }) => {
              if (!done) {
                done = true;
                resolve(v);
              }
            };
            navigator.geolocation.getCurrentPosition(
              (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
              () => finish({}),
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
            );
            setTimeout(() => finish({}), 11000);
          });
          res = await fetch("/api/pos/auth/kiosk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pin: value,
              lat: where.lat ?? null,
              lng: where.lng ?? null,
            }),
          });
        }
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setError(d.error ?? "PIN not recognized");
          setPin("");
          return;
        }
        setPin("");
        setError(null);
        onUnlocked();
      } catch {
        setError("Could not reach the register");
        setPin("");
      } finally {
        setBusy(false);
      }
    },
    [onUnlocked],
  );

  // Four digits IS the whole PIN, so there is nothing left to confirm — asking
  // for a second press to say "yes, that is the number I just typed" is a step
  // that exists only because a form has a submit button. The ref guards the
  // gap between the fourth digit landing and the request coming back.
  useEffect(() => {
    if (pin.length !== 4 || submittingRef.current) return;
    submittingRef.current = true;
    void submit(pin).finally(() => {
      submittingRef.current = false;
    });
  }, [pin, submit]);

  const onDigit = useCallback((d: string) => {
    setError(null);
    setPin((prev) => (prev.length >= 4 ? prev : prev + d));
  }, []);

  const onClear = useCallback(() => {
    setError(null);
    setPin("");
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6"
      // Fully opaque, not a tint. Whatever was on screen when the counter
      // emptied is a customer's ticket, and a locked register that still shows
      // it through a wash of navy has locked the buttons but not the
      // information, which is the half that matters.
      style={{ background: "#07182c", color: "#fff" }}
    >
      {/* The shop's own badge, not the drawn tire that used to sit here.
          A locked register is the screen the counter looks at longest with
          nobody using it — a customer waiting, an owner walking past — so it
          is the wrong place for a generic wheel that could belong to anybody.
          Large because there is nothing competing with it: the whole screen is
          this, a PIN pad, and one link. */}
      <ShopLogo size={112} priority />
      <div className="text-center">
        <div className="text-lg font-semibold">{t("Register locked")}</div>
        <p className="text-sm text-white/55 mt-1">
          {t("Enter your PIN to pick up where the counter left off.")}
        </p>
      </div>

      <div className="w-full" style={{ maxWidth: 300 }}>
        <PinDots filled={pin.length} invalid={!!error} />
        <div className="h-6 mt-3 text-center text-sm">
          {error ? (
            <span style={{ color: "#ff8f95" }}>{error}</span>
          ) : busy ? (
            <span className="text-white/50">{t("Checking…")}</span>
          ) : null}
        </div>
        <div className="mt-2">
          <Keypad onDigit={onDigit} onClear={onClear} onSubmit={() => {}} disabled={busy} hideSubmit />
        </div>
      </div>

      {/*
        The other door. Somebody who reaches a locked register because their
        shift is over wants the time clock, not the register, and without this
        the only way there is to know the URL. Quiet rather than the header's
        yellow: from here it is the less likely of the two things you want.
      */}
      <Link
        href="/"
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm"
        style={{ border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.8)" }}
      >
        <span style={{ fontSize: "1rem" }}>🕒</span>
        Go to the time clock
      </Link>
    </div>
  );
}
