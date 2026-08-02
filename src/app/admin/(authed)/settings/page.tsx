"use client";

import { useEffect, useState } from "react";

type Settings = {
  company_name: string;
  week_start_day: string;
  auto_close_hour: string;
  photo_retention_days: string;
  break_auto_deduct_minutes: string;
};

const WEEK_DAYS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Password change
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.settings));
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const d = await res.json();
    setSaving(false);
    if (!res.ok) { setError(d.error || "Failed"); return; }
    setSettings(d.settings);
    setSavedAt(Date.now());
  }

  async function changePassword() {
    setPwError(null);
    setPwOk(false);
    if (pwNew.length < 8) { setPwError("New password must be at least 8 characters"); return; }
    if (pwNew !== pwConfirm) { setPwError("Passwords do not match"); return; }
    setPwBusy(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
    });
    const d = await res.json();
    setPwBusy(false);
    if (!res.ok) { setPwError(d.error || "Failed"); return; }
    setPwOk(true);
    setPwCurrent(""); setPwNew(""); setPwConfirm("");
  }

  if (!settings) {
    return (
      <div className="text-brand-400">Loading settings…</div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold text-brand-500 mb-1">Settings</h1>
      <p className="text-brand-400 mb-6">Configure the kiosk and admin behavior.</p>

      <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-semibold text-brand-500 mb-4">General</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company name">
            <input
              className="input w-full"
              value={settings.company_name}
              onChange={(e) => setSettings({ ...settings, company_name: e.target.value })}
            />
          </Field>
          <Field label="Week starts on">
            <select
              className="input w-full"
              value={settings.week_start_day}
              onChange={(e) => setSettings({ ...settings, week_start_day: e.target.value })}
            >
              {WEEK_DAYS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Auto-close shifts at hour"
            help="Open shifts at this hour are automatically closed and flagged."
          >
            <select
              className="input w-full"
              value={settings.auto_close_hour}
              onChange={(e) => setSettings({ ...settings, auto_close_hour: e.target.value })}
            >
              {Array.from({ length: 24 }).map((_, h) => (
                <option key={h} value={h}>
                  {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Photo retention (days)"
            help="Older photos are removed by `npm run purge-photos`."
          >
            <input
              type="number"
              className="input w-full"
              min={1}
              value={settings.photo_retention_days}
              onChange={(e) => setSettings({ ...settings, photo_retention_days: e.target.value })}
            />
          </Field>
          <Field
            label="Break auto-deduct (minutes)"
            help="0 = no auto-deduction. Reserved for future use."
          >
            <input
              type="number"
              className="input w-full"
              min={0}
              value={settings.break_auto_deduct_minutes}
              onChange={(e) => setSettings({ ...settings, break_auto_deduct_minutes: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {savedAt && (
            <span className="text-xs text-green-700">Saved.</span>
          )}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-brand-500 mb-4">Change admin password</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Current password">
            <input
              type="password"
              className="input w-full"
              value={pwCurrent}
              onChange={(e) => setPwCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <div />
          <Field label="New password">
            <input
              type="password"
              className="input w-full"
              value={pwNew}
              onChange={(e) => setPwNew(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              className="input w-full"
              value={pwConfirm}
              onChange={(e) => setPwConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={changePassword} disabled={pwBusy}>
            {pwBusy ? "Saving…" : "Change password"}
          </button>
          {pwOk && <span className="text-xs text-green-700">Password updated.</span>}
          {pwError && <span className="text-xs text-red-700">{pwError}</span>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="block text-brand-400 mb-1 font-medium">{label}</span>
      {children}
      {help && <span className="block text-xs text-brand-300 mt-1">{help}</span>}
    </label>
  );
}
