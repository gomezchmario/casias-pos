"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";

type Employee = { id: number; name: string };

type Entry = {
  id: number;
  employee_id: number;
  employee_name: string;
  type: string;
  timestamp: string;
  photo_path: string | null;
  flagged: number;
  flag_reason: string | null;
  notes: string | null;
  edited_at: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  check_in: "Check in",
  check_out: "Check out",
  break_start: "Break start",
  break_end: "Break end",
};
const TYPE_TONES: Record<string, "success" | "info" | "warning" | "neutral"> = {
  check_in: "success",
  check_out: "info",
  break_start: "warning",
  break_end: "neutral",
};

export default function EntriesPageWrapper() {
  return (
    <Suspense fallback={<div className="text-brand-300">Loading…</div>}>
      <EntriesPage />
    </Suspense>
  );
}

function EntriesPage() {
  const search = useSearchParams();
  const initialFlagged = search.get("flagged") === "true";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [filters, setFilters] = useState({
    employeeId: "",
    type: "",
    startDate: sevenDaysAgo,
    endDate: today,
    flaggedOnly: initialFlagged,
  });

  const [photoEntry, setPhotoEntry] = useState<Entry | null>(null);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);

  useEffect(() => {
    fetch("/api/employees?includeInactive=true")
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []));
  }, []);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.employeeId) sp.set("employeeId", filters.employeeId);
    if (filters.type) sp.set("type", filters.type);
    if (filters.startDate) sp.set("startDate", filters.startDate);
    if (filters.endDate) sp.set("endDate", filters.endDate);
    if (filters.flaggedOnly) sp.set("flaggedOnly", "true");
    sp.set("limit", "300");
    return sp.toString();
  }, [filters]);

  function reload() {
    setLoading(true);
    fetch(`/api/entries?${queryString}`)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, [queryString]);

  async function deleteEntry(e: Entry) {
    if (!confirm(`Delete this ${TYPE_LABELS[e.type]} entry for ${e.employee_name}?`)) return;
    const res = await fetch(`/api/entries/${e.id}`, { method: "DELETE" });
    if (res.ok) reload();
  }

  async function unflagEntry(e: Entry) {
    const res = await fetch(`/api/entries/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flagged: false }),
    });
    if (res.ok) reload();
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold text-brand-500 mb-1">Time Entries</h1>
      <p className="text-brand-400 mb-6">View, filter, and correct check-in/out events.</p>

      <div className="bg-white rounded-2xl shadow-sm p-4 mb-6 flex flex-wrap gap-3 items-end">
        <Field label="Employee">
          <select
            className="input"
            value={filters.employeeId}
            onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })}
          >
            <option value="">All</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select
            className="input"
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          >
            <option value="">All</option>
            <option value="check_in">Check in</option>
            <option value="check_out">Check out</option>
            <option value="break_start">Break start</option>
            <option value="break_end">Break end</option>
          </select>
        </Field>
        <Field label="From">
          <input
            type="date"
            className="input"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            className="input"
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-brand-400 ml-2">
          <input
            type="checkbox"
            checked={filters.flaggedOnly}
            onChange={(e) => setFilters({ ...filters, flaggedOnly: e.target.checked })}
          />
          Flagged only
        </label>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead style={{ background: "rgba(10,37,64,0.03)" }}>
            <tr className="text-left text-brand-400 uppercase text-xs tracking-wider">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Photo</th>
              <th className="px-4 py-3">Notes</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-black/5">
                <td className="px-4 py-3 tabular-nums text-brand-400">
                  {new Date(e.timestamp).toLocaleString(undefined, {
                    month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })}
                  {e.edited_at && (
                    <div className="text-xs text-brand-300">edited</div>
                  )}
                </td>
                <td className="px-4 py-3 font-medium text-brand-500">{e.employee_name}</td>
                <td className="px-4 py-3">
                  <Badge tone={TYPE_TONES[e.type]}>{TYPE_LABELS[e.type] || e.type}</Badge>
                  {e.flagged === 1 && (
                    <div className="mt-1">
                      <Badge tone="danger" size="sm">⚠ flagged</Badge>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {e.photo_path ? (
                    <button
                      type="button"
                      onClick={() => setPhotoEntry(e)}
                      className="block w-12 h-12 rounded-lg overflow-hidden border border-black/10 hover:ring-2 hover:ring-brand-500/40"
                    >
                      <img
                        src={`/api/photos/${encodeURIComponent(e.photo_path)}`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ) : (
                    <span className="text-xs text-brand-300">none</span>
                  )}
                </td>
                <td className="px-4 py-3 text-brand-400 text-xs max-w-xs">
                  {e.flag_reason && <div className="text-red-700">{e.flag_reason}</div>}
                  {e.notes && <div>{e.notes}</div>}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      className="text-xs text-brand-400 hover:text-brand-500 underline"
                      onClick={() => setEditEntry(e)}
                    >
                      Edit
                    </button>
                    {e.flagged === 1 && (
                      <button
                        type="button"
                        className="text-xs text-brand-400 hover:text-brand-500 underline"
                        onClick={() => unflagEntry(e)}
                      >
                        Clear flag
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:text-red-800 underline"
                      onClick={() => deleteEntry(e)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-300">
                No entries match your filters.
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-300">
                Loading…
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {photoEntry && (
        <Modal open onClose={() => setPhotoEntry(null)} title={`Photo · ${photoEntry.employee_name}`} width={520}>
          <div className="text-sm text-brand-400 mb-3 tabular-nums">
            {new Date(photoEntry.timestamp).toLocaleString()} · {TYPE_LABELS[photoEntry.type]}
          </div>
          {photoEntry.photo_path && (
            <img
              src={`/api/photos/${encodeURIComponent(photoEntry.photo_path)}`}
              alt=""
              className="w-full rounded-xl border border-black/10"
            />
          )}
        </Modal>
      )}

      {editEntry && (
        <EditEntryModal
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={() => { setEditEntry(null); reload(); }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs text-brand-400 flex flex-col">
      <span className="mb-1 uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

function EditEntryModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: Entry;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Convert "YYYY-MM-DDTHH:MM:SS" to "YYYY-MM-DDTHH:MM" for datetime-local
  const initialDateTime = entry.timestamp.slice(0, 16);
  const [timestamp, setTimestamp] = useState(initialDateTime);
  const [type, setType] = useState(entry.type);
  const [notes, setNotes] = useState(entry.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: timestamp + ":00", // restore seconds
        type,
        notes,
      }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) { setError(d.error || "Failed"); return; }
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit entry"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="text-sm text-brand-400">{entry.employee_name}</div>
        <label className="text-sm text-brand-400">
          When
          <input
            type="datetime-local"
            className="input mt-1 w-full"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
          />
        </label>
        <label className="text-sm text-brand-400">
          Type
          <select
            className="input mt-1 w-full"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="check_in">Check in</option>
            <option value="check_out">Check out</option>
            <option value="break_start">Break start</option>
            <option value="break_end">Break end</option>
          </select>
        </label>
        <label className="text-sm text-brand-400">
          Notes
          <textarea
            className="input mt-1 w-full"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </label>
        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  );
}
