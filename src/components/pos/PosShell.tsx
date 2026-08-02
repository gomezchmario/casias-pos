"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { TireMark } from "@/components/ui/TireMark";
import { ROLE_LABELS, type Capability, type PosRole } from "@/lib/roles";

export type PosUser = { employeeId: number; name: string; role: PosRole };
type Capabilities = Record<Capability, boolean>;

type PosAuth = { user: PosUser; can: (c: Capability) => boolean };

const PosAuthContext = createContext<PosAuth | null>(null);

export function usePosAuth(): PosAuth {
  const ctx = useContext(PosAuthContext);
  if (!ctx) throw new Error("usePosAuth must be used inside PosShell");
  return ctx;
}

const NAV: { href: string; label: string; capability: Capability }[] = [
  { href: "/pos", label: "Today", capability: "viewDay" },
  { href: "/pos/register", label: "New sale", capability: "ringSale" },
  { href: "/pos/eod", label: "End of day", capability: "closeShift" },
  { href: "/pos/buttons", label: "Buttons", capability: "manageQuickButtons" },
];

// How often to confirm the session is still alive. The server slides the
// expiry on every request, so this poll doubles as the idle-lock heartbeat:
// stop touching the register and the session lapses on its own.
const SESSION_POLL_MS = 60_000;

export function PosShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [auth, setAuth] = useState<PosAuth | null>(null);
  const [locked, setLocked] = useState(false);

  // The register has no login screen of its own any more — the time-clock
  // kiosk is the only door in, so a lapsed session goes back there.
  const toLogin = useCallback(() => {
    router.replace("/");
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function check(initial: boolean) {
      try {
        const res = await fetch("/api/pos/auth/me");
        if (cancelled) return;
        if (!res.ok) {
          if (initial) toLogin();
          else setLocked(true);
          return;
        }
        const d: { user: PosUser; capabilities: Capabilities } = await res.json();
        if (cancelled) return;
        setLocked(false);
        setAuth({ user: d.user, can: (c) => d.capabilities[c] === true });
      } catch {
        if (!cancelled && initial) toLogin();
      }
    }

    void check(true);
    const t = setInterval(() => void check(false), SESSION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [toLogin]);

  async function signOut() {
    await fetch("/api/pos/auth/logout", { method: "POST" });
    toLogin();
  }

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
        <header
          className="flex items-center gap-4 px-5 py-3"
          style={{
            background: "linear-gradient(180deg, #0a2540 0%, #07182c 100%)",
            color: "#f5f7fa",
          }}
        >
          <TireMark size={28} />
          <nav className="flex gap-1 flex-1">
            {NAV.filter((n) => auth.can(n.capability)).map((n) => {
              const active =
                n.href === "/pos" ? pathname === "/pos" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className="px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{
                    background: active ? "rgba(255,200,61,0.18)" : "transparent",
                    color: active ? "#ffd35a" : "rgba(255,255,255,0.78)",
                  }}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="text-right leading-tight">
            <div className="text-sm font-semibold">{auth.user.name}</div>
            <div className="text-xs text-accent-500 uppercase tracking-wider">
              {ROLE_LABELS[auth.user.role]}
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="text-xs px-3 py-2 rounded-lg"
            style={{
              border: "1px solid rgba(255,255,255,0.18)",
              color: "rgba(255,255,255,0.85)",
            }}
          >
            Switch user
          </button>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>

      {locked && (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center gap-4 z-50"
          style={{ background: "rgba(7,24,44,0.94)", color: "#fff" }}
        >
          <TireMark size={44} />
          <div className="text-lg font-semibold">Register locked</div>
          <p className="text-sm text-white/60">Signed out after a period of inactivity.</p>
          <button type="button" className="btn btn-primary" onClick={toLogin}>
            Sign back in
          </button>
        </div>
      )}
    </PosAuthContext.Provider>
  );
}
