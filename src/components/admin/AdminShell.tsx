"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TireMark } from "@/components/ui/TireMark";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: "▦" },
  { href: "/admin/employees", label: "Employees", icon: "👥" },
  { href: "/admin/entries", label: "Time Entries", icon: "🕒" },
  { href: "/admin/reports", label: "Reports", icon: "📈" },
  { href: "/admin/audit", label: "Audit Log", icon: "📜" },
  { href: "/admin/settings", label: "Settings", icon: "⚙" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: { authenticated?: boolean; mustChangePassword?: boolean }) => {
        if (cancelled) return;
        if (!data.authenticated) {
          router.replace("/admin/login");
          return;
        }
        if (data.mustChangePassword && pathname !== "/admin/change-password") {
          router.replace("/admin/change-password");
          return;
        }
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) router.replace("/admin/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-brand-300">
        <div className="animate-fade-in">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#f4f6fa" }}>
      <aside
        className="flex flex-col"
        style={{
          width: 240,
          background: "linear-gradient(180deg, #0a2540 0%, #07182c 100%)",
          color: "#f5f7fa",
        }}
      >
        <div className="px-5 py-6 border-b border-white/10 flex items-center gap-3">
          <TireMark size={32} />
          <div className="leading-tight">
            <div className="font-semibold">Casias Tire Shop</div>
            <div className="text-xs text-accent-500 uppercase tracking-widest">Admin</div>
          </div>
        </div>

        <nav className="py-3 flex-1">
          {NAV.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block mx-3 my-1 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{
                  background: active ? "rgba(255,200,61,0.18)" : "transparent",
                  color: active ? "#ffd35a" : "rgba(255,255,255,0.78)",
                  borderLeft: active ? "3px solid #ffc83d" : "3px solid transparent",
                }}
              >
                <span style={{ marginRight: 10 }}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-white/10 text-sm">
          <Link
            href="/"
            className="block text-center text-xs opacity-60 hover:opacity-100"
          >
            ← Back to kiosk
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">
        <div className="p-8 max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
