"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/ui/BrandLogo";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If already logged in, bounce to dashboard.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) {
          router.replace(d.mustChangePassword ? "/admin/change-password" : "/admin");
        }
      })
      .catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        setBusy(false);
        return;
      }
      router.replace(data.mustChangePassword ? "/admin/change-password" : "/admin");
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: "linear-gradient(135deg, #0a2540 0%, #07182c 100%)" }}>
      <div className="acrylic-dark rounded-3xl p-8 w-full max-w-md animate-pop-in">
        <div className="flex justify-center mb-6">
          <BrandLogo size="md" />
        </div>
        <h1 className="text-xl font-semibold text-white text-center mb-1">
          Admin sign-in
        </h1>
        <p className="text-sm text-white/60 text-center mb-6">
          Manage employees, time entries, and reports.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-sm text-white/80">
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input mt-1 w-full"
              autoFocus
              autoComplete="username"
            />
          </label>
          <label className="text-sm text-white/80">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input mt-1 w-full"
              autoComplete="current-password"
            />
          </label>
          {error && (
            <div
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: "rgba(216,68,76,0.18)", color: "#ffd6d8" }}
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !username || !password}
            className="btn btn-accent mt-2"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
