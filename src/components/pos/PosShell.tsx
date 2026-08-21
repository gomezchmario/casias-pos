"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { LockScreen } from "@/components/pos/LockScreen";
import { LangToggle, useLang } from "@/components/pos/LangToggle";
import { TireDemandButton } from "@/components/pos/TireDemandButton";
import { BackToTop } from "@/components/ui/BackToTop";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { ROLE_LABELS, type Capability, type PosRole } from "@/lib/roles";

export type PosUser = { employeeId: number; name: string; role: PosRole };
type Capabilities = Record<Capability, boolean>;

type PosAuth = {
  user: PosUser;
  can: (c: Capability) => boolean;
  /** Whether the shop is running the lost-sale study — see `tire-demand.ts`. */
  tireDemand: boolean;
};

const PosAuthContext = createContext<PosAuth | null>(null);

export function usePosAuth(): PosAuth {
  const ctx = useContext(PosAuthContext);
  if (!ctx) throw new Error("usePosAuth must be used inside PosShell");
  return ctx;
}

const NAV: {
  href: string;
  label: string;
  capability: Capability;
  /** Accessible name, for tabs whose label is a glyph. */
  title?: string;
}[] = [
  { href: "/pos", label: "Main", capability: "viewDay" },
  { href: "/pos/register", label: "New sale", capability: "browseRegister" },
  // Sits next to Main because it is the other half of the same question: Main
  // says how the day is going, Logs says what the day actually did. The ticket
  // list used to hang off the bottom of Main and made it too long to read;
  // this is where it went.
  //
  // The route stays /pos/entries. Renaming the tab is a label change; renaming
  // the URL would break every link anybody has bookmarked or written down for
  // the sake of matching a word on a button.
  { href: "/pos/entries", label: "Logs", capability: "viewLog" },
  // Orders is deliberately NOT a tab, and the green and blue sheet does not get
  // a screen of its own. A tire the shop has promised somebody is a thing the
  // shop still owes — exactly like a balance — so it belongs in the Outstanding
  // panel on Main beside the balances, not on a separate board somebody has to
  // remember to go and look at. A list nobody visits is how the sheet lost track
  // of them in the first place.
  { href: "/pos/inventory", label: "Inventory", capability: "viewInventory" },
  // Reports before the close-out, and the order is about how often each is
  // opened rather than about when in the day they are used. Reports is a
  // reading somebody comes to the machine for; the close-out is the last thing
  // done before locking up, at which point it is being looked for deliberately
  // and its position on the row does not matter.
  { href: "/pos/reports", label: "Reports", capability: "viewBusinessReports" },
  // The day read rather than worked — view-only. Opened to managers by the
  // owner's explicit instruction, consequences deferred ("we will fix later").
  { href: "/pos/closeout", label: "Daily Report", capability: "viewReports" },
  // Called Drawer, not Close-out: four of its six steps are daytime jobs —
  // the morning float count and every cash in and out — and somebody recording
  // a gas run at eleven should not have to open something called Close-out to
  // do it. Closing the day is a step ON this screen, not the name of it.
  //
  // Gated on READING it, not on closing it — a viewer opens the page and is
  // refused by every button on it. See viewCloseout.
  { href: "/pos/drawer", label: "Drawer", capability: "viewCloseout" },
  // The old close-out is off the nav now that V3 is the close-out. The page
  // itself still works and is still reachable by URL — hidden rather than
  // deleted, so a night that goes wrong has somewhere to fall back to. Delete
  // it once V3 has a couple of weeks of real closes behind it; two live
  // procedures is how a shop ends up with two truths.
  // Just the gear. The other tabs are places to do the day's work and are
  // named for the work; this one is setup, is opened rarely, and does not earn
  // a word next to them. It sits last so the eye reaches it only after the
  // things that get used every hour.
  //
  // A glyph has no accessible name of its own, hence `title` — the browser tab
  // title is set separately in settings/layout.tsx and stays the plain word.
  {
    href: "/pos/settings",
    label: "⚙",
    title: "Settings",
    capability: "manageSettings",
  },
];

// How often to confirm the session is still alive, while somebody is actually
// using the register. NOT a heartbeat: see the tick loop below for why the
// distinction matters.
const SESSION_POLL_MS = 60_000;

// How often to ask "has the counter gone quiet?". Costs nothing — it is a
// clock comparison, no network — so it can be frequent enough that the lock
// lands when it says it will rather than up to a minute late.
const IDLE_TICK_MS = 5_000;

/** Used until `/me` reports the shop's real setting. */
const FALLBACK_IDLE_SECONDS = 900;

/**
 * What counts as somebody being here.
 *
 * Deliberately not `mousemove`. A register shares a counter with tire irons and
 * people leaning on things, and a knocked mouse should not read as a cashier.
 * These four are all things a person did on purpose — including `wheel`, so
 * that reading a long inventory list without clicking anything still counts.
 */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export function PosShell({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  const pathname = usePathname();
  const router = useRouter();
  const [auth, setAuth] = useState<PosAuth | null>(null);
  const [locked, setLocked] = useState(false);

  const lastActivityRef = useRef(Date.now());
  const idleMsRef = useRef(FALLBACK_IDLE_SECONDS * 1000);
  // Mirrors `locked` for the interval, which closes over its first render.
  const lockedRef = useRef(false);

  // The register has no login screen of its own any more — the time-clock
  // kiosk is the only door in, so a lapsed session goes back there.
  const toLogin = useCallback(() => {
    router.replace("/");
  }, [router]);

  const check = useCallback(
    async (initial: boolean): Promise<PosAuth | null> => {
      try {
        const res = await fetch("/api/pos/auth/me");
        if (!res.ok) {
          if (initial) toLogin();
          else {
            lockedRef.current = true;
            setLocked(true);
          }
          return null;
        }
        const d: {
          user: PosUser;
          capabilities: Capabilities;
          idleSeconds?: number;
          tireDemandEnabled?: boolean;
        } = await res.json();
        if (typeof d.idleSeconds === "number" && d.idleSeconds > 0) {
          idleMsRef.current = d.idleSeconds * 1000;
        }
        const next: PosAuth = {
          user: d.user,
          can: (c) => d.capabilities[c] === true,
          tireDemand: d.tireDemandEnabled === true,
        };
        lockedRef.current = false;
        setLocked(false);
        setAuth(next);
        return next;
      } catch {
        if (initial) toLogin();
        return null;
      }
    },
    [toLogin],
  );

  /**
   * Lock, and mean it.
   *
   * The session is revoked rather than merely covered up. A panel drawn over
   * the page stops the person standing in front of it and nobody else: the
   * cookie would still be live, so a second tab opened at /pos — or the same
   * tab, reloaded — would walk straight back in. Throwing the session away
   * makes the lock true at the server, where it counts.
   */
  const lock = useCallback(async () => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    try {
      await fetch("/api/pos/auth/logout", { method: "POST" });
    } catch {
      // The screen is locked either way; the session will lapse on its own.
    }
  }, []);

  /**
   * Somebody has PINned back in — possibly not the person who locked it, which
   * is the point now that "switch user" is gone.
   */
  const unlock = useCallback(async () => {
    lastActivityRef.current = Date.now();
    const next = await check(false);
    if (!next) return;
    // They may be standing on a page their role cannot open — a cashier
    // unlocking a register a manager left on the settings screen. Send them
    // home rather than leaving them on a form that will refuse to save.
    const here = NAV.find((n) =>
      n.href === "/pos" ? pathname === "/pos" : pathname.startsWith(n.href),
    );
    if (here && !next.can(here.capability)) router.replace("/pos");
  }, [check, pathname, router]);

  // Record that a person is here.
  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    for (const e of ACTIVITY_EVENTS) {
      window.addEventListener(e, bump, { passive: true });
    }
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, bump);
    };
  }, []);

  useEffect(() => {
    void check(true);
    let lastPoll = Date.now();

    // The bug this shape exists to avoid: the poll used to fire unconditionally
    // every minute, and the server slides the session expiry forward on every
    // request it serves. So the tab kept its own session alive by asking
    // whether it was still alive — a register left open on an empty counter
    // never locked, no matter what `pos_idle_lock_seconds` said. Sessions were
    // measured still live 22 minutes untouched against a 15 minute setting.
    //
    // The fix is that idleness gates the poll instead of the poll defining
    // idleness. Go quiet and the requests stop, which is what lets the counter
    // actually go quiet.
    const t = setInterval(() => {
      if (lockedRef.current) return;
      const now = Date.now();
      if (now - lastActivityRef.current >= idleMsRef.current) {
        void lock();
        return;
      }
      if (now - lastPoll >= SESSION_POLL_MS) {
        lastPoll = now;
        void check(false);
      }
    }, IDLE_TICK_MS);

    return () => clearInterval(t);
  }, [check, lock]);

  if (!auth) {
    return (
      <div
        className="min-h-screen flex items-center justify-center text-white/60"
        style={{ background: "#07182c" }}
      >
        Loading…
      </div>
    );
  }

  return (
    <PosAuthContext.Provider value={auth}>
      <div className="min-h-screen flex flex-col" style={{ background: "#f4f6fa" }}>
        {/*
          Wraps, and its nav scrolls. Both are here because of the same bug on a
          phone: a dozen nav links at their natural width made this row wider
          than the screen, and a header is only ever painted as wide as the
          viewport — so the page scrolled sideways and the Time Clock button
          ended up sitting on the light page background past the end of the navy
          bar, looking like it had fallen off.

          `flex-wrap` lets the right-hand cluster drop to a second row rather
          than push past the edge, and the bar grows to cover it. The nav gets
          `min-w-0` so it is allowed to be narrower than its links — a flex item
          refuses to shrink below its content otherwise, which is what made the
          whole row too wide in the first place — and scrolls sideways inside
          itself instead.
        */}
        <header
          className="flex flex-wrap items-center gap-4 px-5 py-3"
          style={{
            background: "linear-gradient(180deg, #0a2540 0%, #07182c 100%)",
            color: "#f5f7fa",
          }}
        >
          <ShopLogo size={30} />
          <nav
            className="flex gap-1 flex-1 min-w-0 overflow-x-auto"
            style={{ scrollbarWidth: "thin" }}
          >
            {NAV.filter((n) => auth.can(n.capability)).map((n) => {
              const active =
                n.href === "/pos" ? pathname === "/pos" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  // `flex-none` and no wrapping: inside a scroller a link must
                  // keep its own width, or the labels squeeze into two lines
                  // rather than the strip scrolling.
                  className="px-3 py-2 rounded-lg text-sm transition-colors flex-none whitespace-nowrap"
                  style={{
                    background: active ? "rgba(255,200,61,0.18)" : "transparent",
                    color: active ? "#ffd35a" : "rgba(255,255,255,0.78)",
                  }}
                  title={n.title}
                  aria-label={n.title}
                >
                  {t(n.label)}
                </Link>
              );
            })}
          </nav>
          <div className="text-right leading-tight">
            <div className="text-sm font-semibold">{auth.user.name}</div>
            <div className="text-xs text-accent-500 uppercase tracking-wider">
              {t(ROLE_LABELS[auth.user.role])}
            </div>
          </div>
          {/* Deliberately loud, and deliberately NOT a sign-out. Somebody
              stepping away to punch out for lunch is coming straight back to
              this register, so the POS session is left alive and the kiosk is
              just another screen.

              There is no "switch user" beside it any more. Handing the register
              over was two buttons doing one job: signing out only to have the
              next person sign in is exactly what the lock screen already does,
              and it does it without needing anyone to remember the courtesy of
              pressing it first. Walk away, it locks itself; the next person
              types their PIN and it is theirs. */}
          <LangToggle />
          <Link
            href="/"
            className="pos-clock flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold whitespace-nowrap"
            style={{
              background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)",
              color: "#0a2540",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            }}
            aria-label={t("Time Clock")}
          >
            <span style={{ fontSize: "1.1rem" }}>🕒</span>
            {/* On a phone the label goes and the clock face stays — see
                .pos-clock in globals.css. The aria-label above is what keeps
                the button named once the visible text is gone. */}
            <span className="pos-clock-label">{t("Time Clock")}</span>
          </Link>
        </header>

        {/*
          A standing reminder, because every control on every screen still
          looks live.

          The alternative was greying out every button this account cannot use,
          which would mean auditing fifty screens and would still be wrong the
          first time one was missed — and a greyed-out register is also a poor
          way to show somebody how the register works, which is half of what
          this account is for. So the buttons stay, the server refuses, and the
          bar says plainly which of those two you are looking at.

          Amber rather than red: nothing is wrong. This is what the account is.
        */}
        {auth.user.role === "viewer" && (
          <div
            className="px-5 py-2 text-sm no-print"
            style={{
              background: "linear-gradient(180deg,#ffd35a,#e0a91d)",
              color: "#0a2540",
              borderBottom: "1px solid rgba(10,37,64,0.18)",
            }}
          >
            <strong>{t("Looking only.")}</strong>{" "}
            {t(
              "You can open anything and try anything on this account. Nothing you do is saved.",
            )}
          </div>
        )}

        <main className="flex-1 p-6">{children}</main>
      </div>

      {/* Outside `main` on purpose: it floats over every screen of the register
          and belongs to none of them. It draws nothing at all unless the shop
          has the study switched on. */}
      <TireDemandButton enabled={auth.tireDemand} />

      {/* Here rather than on the inventory page, which is where it started.
          Every screen in the register grows long enough to need it — the day
          log, the customer book, the reports, the rack — and a control that
          exists on one of them is a control nobody learns. It hides itself
          until there is a screen's worth of scrolling to come back from, so
          on the short pages it costs nothing. */}
      <BackToTop />

      {locked && <LockScreen onUnlocked={() => void unlock()} />}
    </PosAuthContext.Provider>
  );
}
