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
  /** Cents an hour, or null where nobody has said. */
  hourly_rate_cents: number | null;
  active: number;
  current_state: "checked_out" | "checked_in" | "on_break";
  last_event_at: string | null;
};

const POS_ROLE_HINT: Record<PosRole, string> = {
  technician: "Look up inventory and prices only",
  writer: "Writes up work outside; no books, no close-out",
  cashier: "Ring sales, take payments, edit SEQ",
  accountant: "Customer book and house accounts; register like a cashier",
  manager: "Void, refund, edit completed sales, receive stock",
  owner: "Everything, including costs and payroll",
  viewer: "Sees every screen an owner sees. Cannot change a thing.",
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
  /*
    Held as the typed string rather than as cents, so an empty box stays empty.

    The difference matters: blank means "nobody has said" and saves as null,
    which is not the same as $0.00 and must not become it. Somebody clearing the
    field is withdrawing a figure, not declaring that this person works free.
  */
  const [wage, setWage] = useState(
    employee.hourly_rate_cents === null ? "" : (employee.hourly_rate_cents / 100).toFixed(2),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const typed = wage.trim();
    let hourlyRateCents: number | null = null;
    if (typed !== "") {
      const n = Number(typed.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        setError("That is not an hourly rate");
        return;
      }
      hourlyRateCents = Math.round(n * 100);
    }
    setBusy(true);
    const res = await fetch(`/api/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role: role || null, posRole, hourlyRateCents }),
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
        {/*
          Pay, on the record that already holds the job title and the
          permissions — which is where somebody setting up a new hire is
          already standing, rather than a payroll screen of its own for one
          number.

          It buys the figure the reports could not show: the shop could always
          see what somebody BROUGHT IN per hour and never what that hour cost,
          so the more useful of the two was unavailable. Left blank it stays
          unknown, and every report that uses it says "not set" rather than
          quietly costing the hour at nothing.
        */}
        <label className="text-sm text-brand-400">
          Pay, per hour
          <div className="flex items-center gap-2 mt-1">
            <span className="text-brand-300">$</span>
            <input
              className="input w-full tabular-nums"
              value={wage}
              inputMode="decimal"
              placeholder="not set"
              onChange={(ev) => setWage(ev.target.value)}
              onBlur={() => {
                const n = Number(wage.trim().replace(/[$,\s]/g, ""));
                if (wage.trim() !== "" && Number.isFinite(n)) setWage(n.toFixed(2));
              }}
            />
          </div>
          <span className="block mt-1 text-xs text-brand-300">
            Used to work out what a shift costs against what it brought in. Leave it empty if you
            would rather not record it — the reports will say it is not set rather than treat the
            hour as free.
          </span>
        </label>
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
