"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { POS_ROLES, ROLE_LABELS, type PosRole } from "@/lib/roles";

type Employee = {
  id: number;
  name: string;
  role: string | null;
  pos_role: PosRole;
  active: number;
  current_state: "checked_out" | "checked_in" | "on_break";
  last_event_at: string | null;
};

const POS_ROLE_HINT: Record<PosRole, string> = {
  technician: "Look up inventory and prices only",
  cashier: "Ring sales, take payments, edit SEQ",
  manager: "Void, refund, edit completed sales, receive stock",
  owner: "Everything, including costs and payroll",
};

function PosRoleSelect({
  value,
  onChange,
}: {
  value: PosRole;
  onChange: (v: PosRole) => void;
}) {
  return (
    <label className="text-sm text-brand-400">
      POS access
      <select
        className="input mt-1 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value as PosRole)}
      >
        {POS_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <span className="block mt-1 text-xs text-brand-300">
        {POS_ROLE_HINT[value]}
      </span>
    </label>
  );
}

type EditState = {
  mode: "create" | "edit" | "reset_pin" | null;
  employee?: Employee;
};

export default function EmployeesPage() {
  const [list, setList] = useState<Employee[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState<EditState>({ mode: null });
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetch(`/api/employees?includeInactive=${showInactive}`)
      .then((r) => r.json())
      .then((d) => setList(d.employees || []));
  }

  useEffect(() => { reload(); }, [showInactive]);

  async function handleDelete(emp: Employee) {
    if (!confirm(`Delete ${emp.name}? All their time entries will also be deleted.`)) return;
    setError(null);
    const res = await fetch(`/api/employees/${emp.id}`, { method: "DELETE" });
    if (res.ok) {
      reload();
      return;
    }
    const d = await res.json().catch(() => ({}));
    setError(d.error || "Failed to delete");
  }

  async function handleToggleActive(emp: Employee) {
    const res = await fetch(`/api/employees/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: emp.active !== 1 }),
    });
    if (res.ok) reload();
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-brand-500 mb-1">Employees</h1>
          <p className="text-brand-400">Manage staff PINs, roles, and active status.</p>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-2 text-sm text-brand-400">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEdit({ mode: "create" })}
          >
            + Add employee
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm bg-red-50 text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead style={{ background: "rgba(10,37,64,0.03)" }}>
            <tr className="text-left text-brand-400 uppercase text-xs tracking-wider">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">POS access</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Current state</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((emp) => (
              <tr key={emp.id} className="border-t border-black/5">
                <td className="px-4 py-3 font-medium text-brand-500">{emp.name}</td>
                <td className="px-4 py-3 text-brand-400">{emp.role || "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={emp.pos_role === "technician" ? "neutral" : "info"}>
                    {ROLE_LABELS[emp.pos_role]}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={emp.active === 1 ? "success" : "neutral"}>
                    {emp.active === 1 ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {emp.active === 1 && (
                    <Badge
                      tone={
                        emp.current_state === "checked_in"
                          ? "success"
                          : emp.current_state === "on_break"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {emp.current_state === "checked_in"
                        ? "Working"
                        : emp.current_state === "on_break"
                          ? "On break"
                          : "Checked out"}
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end flex-wrap">
                    <button
                      type="button"
                      className="text-xs text-brand-400 hover:text-brand-500 underline"
                      onClick={() => setEdit({ mode: "edit", employee: emp })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-brand-400 hover:text-brand-500 underline"
                      onClick={() => setEdit({ mode: "reset_pin", employee: emp })}
                    >
                      Reset PIN
                    </button>
                    <button
                      type="button"
                      className="text-xs text-brand-400 hover:text-brand-500 underline"
                      onClick={() => handleToggleActive(emp)}
                    >
                      {emp.active === 1 ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:text-red-800 underline"
                      onClick={() => handleDelete(emp)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-300">
                No employees yet. Click "Add employee" to get started.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edit.mode === "create" && (
        <CreateEmployeeModal
          onClose={() => setEdit({ mode: null })}
          onSaved={() => { setEdit({ mode: null }); reload(); }}
        />
      )}
      {edit.mode === "edit" && edit.employee && (
        <EditEmployeeModal
          employee={edit.employee}
          onClose={() => setEdit({ mode: null })}
          onSaved={() => { setEdit({ mode: null }); reload(); }}
        />
      )}
      {edit.mode === "reset_pin" && edit.employee && (
        <ResetPinModal
          employee={edit.employee}
          onClose={() => setEdit({ mode: null })}
          onSaved={() => { setEdit({ mode: null }); reload(); }}
        />
      )}
    </div>
  );
}

function CreateEmployeeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("");
  const [posRole, setPosRole] = useState<PosRole>("technician");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, pin, role, posRole }),
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
      title="Add employee"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !name || pin.length !== 4}>
            {busy ? "Saving…" : "Add"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="text-sm text-brand-400">
          Name
          <input className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="text-sm text-brand-400">
          4-digit PIN
          <input
            className="input mt-1 w-full tabular-nums"
            value={pin}
            inputMode="numeric"
            maxLength={4}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="0000"
          />
        </label>
        <label className="text-sm text-brand-400">
          Job title <span className="text-brand-300">(optional)</span>
          <input className="input mt-1 w-full" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Tech, Front Desk" />
        </label>
        <PosRoleSelect value={posRole} onChange={setPosRole} />
        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  );
}

function EditEmployeeModal({ employee, onClose, onSaved }: { employee: Employee; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(employee.name);
  const [role, setRole] = useState(employee.role || "");
  const [posRole, setPosRole] = useState<PosRole>(employee.pos_role);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role: role || null, posRole }),
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
      title={`Edit ${employee.name}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !name}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="text-sm text-brand-400">
          Name
          <input className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-sm text-brand-400">
          Job title
          <input className="input mt-1 w-full" value={role} onChange={(e) => setRole(e.target.value)} />
        </label>
        <PosRoleSelect value={posRole} onChange={setPosRole} />
        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  );
}

function ResetPinModal({ employee, onClose, onSaved }: { employee: Employee; onClose: () => void; onSaved: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/employees/${employee.id}/reset-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
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
      title={`Reset PIN for ${employee.name}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || pin.length !== 4}>
            {busy ? "Saving…" : "Reset PIN"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-brand-400">Enter a new 4-digit PIN.</p>
        <input
          className="input w-full text-center text-2xl tabular-nums tracking-widest"
          value={pin}
          inputMode="numeric"
          maxLength={4}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="••••"
          autoFocus
        />
        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  );
}
