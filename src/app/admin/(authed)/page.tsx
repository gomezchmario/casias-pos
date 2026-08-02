"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";

type EmployeeWithState = {
  id: number;
  name: string;
  role: string | null;
  active: number;
  current_state: "checked_out" | "checked_in" | "on_break";
  last_event_at: string | null;
};

type Entry = {
  id: number;
  employee_id: number;
  employee_name: string;
  type: string;
  timestamp: string;
  flagged: number;
  flag_reason: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  check_in: "Check in",
  check_out: "Check out",
  break_start: "Break start",
  break_end: "Break end",
};
const TYPE_TONE: Record<string, "success" | "info" | "warning" | "neutral"> = {
  check_in: "success",
  check_out: "info",
  break_start: "warning",
  break_end: "neutral",
};

export default function DashboardPage() {
  const [employees, setEmployees] = useState<EmployeeWithState[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [flagged, setFlagged] = useState<Entry[]>([]);

  useEffect(() => {
    fetch("/api/employees")
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []));
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/entries?startDate=${today}&endDate=${today}&limit=20`)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries || []));
    fetch(`/api/entries?flaggedOnly=true&limit=20`)
      .then((r) => r.json())
      .then((d) => setFlagged(d.entries || []));
  }, []);

  const active = employees.filter((e) => e.active === 1);
  const checkedIn = active.filter((e) => e.current_state === "checked_in");
  const onBreak = active.filter((e) => e.current_state === "on_break");

  return (
    <div>
      <h1 className="text-3xl font-semibold text-brand-500 mb-1">Dashboard</h1>
      <p className="text-brand-400 mb-6">
        Today's activity at a glance.
      </p>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Active Employees" value={active.length} tone="info" />
        <StatCard label="Currently Working" value={checkedIn.length} tone="success" />
        <StatCard label="On Break" value={onBreak.length} tone="warning" />
        <StatCard
          label="Flagged Entries"
          value={flagged.length}
          tone={flagged.length > 0 ? "danger" : "neutral"}
          link="/admin/entries?flagged=true"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-brand-500">
              Currently working
            </h2>
            <Link
              href="/admin/employees"
              className="text-xs text-brand-400 hover:text-brand-500"
            >
              View all →
            </Link>
          </div>
          {checkedIn.length === 0 && onBreak.length === 0 ? (
            <p className="text-sm text-brand-400">No one is checked in right now.</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {[...checkedIn, ...onBreak].map((e) => (
                <li key={e.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-brand-500">{e.name}</div>
                    <div className="text-xs text-brand-300">{e.role || "—"}</div>
                  </div>
                  <Badge tone={e.current_state === "checked_in" ? "success" : "warning"}>
                    {e.current_state === "checked_in" ? "Working" : "On break"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-brand-500">
              Today's activity
            </h2>
            <Link
              href="/admin/entries"
              className="text-xs text-brand-400 hover:text-brand-500"
            >
              View all →
            </Link>
          </div>
          {entries.length === 0 ? (
            <p className="text-sm text-brand-400">No activity yet today.</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {entries.slice(0, 10).map((e) => (
                <li key={e.id} className="py-2 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <Badge tone={TYPE_TONE[e.type]}>{TYPE_LABEL[e.type] || e.type}</Badge>
                    <span className="text-brand-500 font-medium">{e.employee_name}</span>
                    {e.flagged === 1 && <Badge tone="danger" size="sm">⚠ flagged</Badge>}
                  </div>
                  <span className="text-brand-300 tabular-nums">
                    {new Date(e.timestamp).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {flagged.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl shadow-sm p-5 border-l-4 border-l-red-500">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-brand-500">
              ⚠ Flagged entries needing review
            </h2>
            <Link
              href="/admin/entries?flagged=true"
              className="text-xs text-brand-400 hover:text-brand-500"
            >
              Review all →
            </Link>
          </div>
          <ul className="divide-y divide-black/5">
            {flagged.slice(0, 5).map((e) => (
              <li key={e.id} className="py-2 text-sm">
                <div className="flex items-center gap-3">
                  <Badge tone={TYPE_TONE[e.type]}>{TYPE_LABEL[e.type]}</Badge>
                  <span className="font-medium text-brand-500">{e.employee_name}</span>
                  <span className="text-brand-300 tabular-nums">
                    {new Date(e.timestamp).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {e.flag_reason && (
                  <div className="text-xs text-brand-400 mt-1">{e.flag_reason}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  link,
}: {
  label: string;
  value: number;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  link?: string;
}) {
  const colors: Record<typeof tone, { bg: string; fg: string }> = {
    info: { bg: "linear-gradient(135deg, #1f3f64 0%, #0a2540 100%)", fg: "#fff" },
    success: { bg: "linear-gradient(135deg, #2ea66a 0%, #1c8c56 100%)", fg: "#fff" },
    warning: { bg: "linear-gradient(135deg, #ffd35a 0%, #e0a91d 100%)", fg: "#0a2540" },
    danger: { bg: "linear-gradient(135deg, #d8444c 0%, #a71d24 100%)", fg: "#fff" },
    neutral: { bg: "#fff", fg: "#0a2540" },
  };
  const t = colors[tone];

  const inner = (
    <div
      className="rounded-2xl p-5 reveal"
      style={{
        background: t.bg,
        color: t.fg,
        boxShadow: tone === "neutral" ? "0 1px 3px rgba(10,37,64,0.06)" : "var(--shadow-soft)",
      }}
    >
      <div className="text-xs uppercase tracking-widest opacity-80 font-medium">{label}</div>
      <div className="text-4xl font-semibold mt-2 tabular-nums">{value}</div>
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}
