"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Failed to change password");
      return;
    }
    setOk(true);
    setTimeout(() => router.replace("/admin"), 1200);
  }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold text-brand-500 mb-1">
        Change password
      </h1>
      <p className="text-sm text-brand-400 mb-6">
        Choose a new password to continue.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3 bg-white p-6 rounded-2xl shadow-sm">
        <label className="text-sm text-brand-400">
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            className="input mt-1 w-full"
            autoComplete="current-password"
          />
        </label>
        <label className="text-sm text-brand-400">
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            className="input mt-1 w-full"
            autoComplete="new-password"
          />
        </label>
        <label className="text-sm text-brand-400">
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirm(e.target.value)}
            className="input mt-1 w-full"
            autoComplete="new-password"
          />
        </label>
        {error && (
          <div className="rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(216,68,76,0.10)", color: "#a71d24" }}>
            {error}
          </div>
        )}
        {ok && (
          <div className="rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(28,140,86,0.12)", color: "#1c8c56" }}>
            Password changed. Redirecting…
          </div>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary mt-2">
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
