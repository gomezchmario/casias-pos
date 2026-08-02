"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";

type AuditEntry = {
  id: number;
  admin_id: number | null;
  admin_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  timestamp: string;
};

const ACTION_LABELS: Record<string, string> = {
  "admin.login": "Sign in",
  "admin.logout": "Sign out",
  "admin.password_change": "Password change",
  "employee.create": "Employee created",
  "employee.update": "Employee updated",
  "employee.deactivate": "Employee deactivated",
  "employee.activate": "Employee activated",
  "employee.delete": "Employee deleted",
  "employee.pin_reset": "PIN reset",
  "entry.create": "Entry added",
  "entry.update": "Entry edited",
  "entry.delete": "Entry deleted",
  "entry.unflag": "Flag cleared",
  "entry.flag": "Entry flagged",
  "settings.update": "Settings updated",
  "system.auto_close": "Auto-closed shift",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/audit?limit=300")
      .then((r) => r.json())
      .then((d) => setEntries(d.entries || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-semibold text-brand-500 mb-1">Audit Log</h1>
      <p className="text-brand-400 mb-6">
        Every administrative change to the system, plus auto-close events.
      </p>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead style={{ background: "rgba(10,37,64,0.03)" }}>
            <tr className="text-left text-brand-400 uppercase text-xs tracking-wider">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Who</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isOpen = expanded === e.id;
              return (
                <tr key={e.id} className="border-t border-black/5 align-top">
                  <td className="px-4 py-3 tabular-nums text-brand-400">
                    {new Date(e.timestamp).toLocaleString(undefined, {
                      month: "short", day: "numeric",
                      hour: "numeric", minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 text-brand-500 font-medium">
                    {e.admin_username || <span className="text-brand-300">system</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tone(e.action)}>{ACTION_LABELS[e.action] || e.action}</Badge>
                  </td>
                  <td className="px-4 py-3 text-brand-400">
                    {e.target_type ? `${e.target_type} #${e.target_id}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-brand-400">
                    {e.details ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : e.id)}
                        className="underline hover:text-brand-500"
                      >
                        {isOpen ? "Hide" : "Show"}
                      </button>
                    ) : "—"}
                    {isOpen && e.details && (
                      <pre
                        className="mt-2 p-3 rounded-lg overflow-auto text-[11px]"
                        style={{ background: "rgba(10,37,64,0.04)", maxWidth: 480 }}
                      >
                        {tryFormat(e.details)}
                      </pre>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && entries.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-brand-300">
                No audit events yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function tone(action: string): "success" | "danger" | "warning" | "info" | "neutral" {
  if (action.endsWith(".delete") || action.endsWith(".deactivate")) return "danger";
  if (action.endsWith(".create") || action.endsWith(".activate")) return "success";
  if (action === "system.auto_close") return "warning";
  if (action.startsWith("admin.")) return "info";
  return "neutral";
}

function tryFormat(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
