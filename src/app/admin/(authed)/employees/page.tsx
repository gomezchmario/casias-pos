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
  mechanic: "Time clock only — never offered on a ticket",
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

type SortKey = "name" | "role" | "access" | "status" | "state";

/*
  A header that sorts, defined OUT HERE and not inside the page.

  Written inside the component it was a new function on every render, which
  makes React throw the whole header row away and build it again each time
  anything changes — the cell under the finger is replaced between the press
  and the release. Out here it is one component that simply re-renders.

  The whole cell is the target rather than the words inside it: this is a
  header being pressed at a desk with a mouse, and a two-word hit area in a
  wide column is a control people conclude is broken. The arrow marks the
  column in force, so the list always says how it is ordered with no legend
  anywhere; the inactive columns show a faint one on hover, which is how
  somebody discovers the row is pressable at all.
*/
function SortHead({
  label,
  k,
  sortBy,
  sortDown,
  onSort,
}: {
  label: string;
  k: SortKey;
  sortBy: SortKey;
  sortDown: boolean;
  onSort: (k: SortKey) => void;
}) {
  const on = sortBy === k;
  return (
    <th
      className="px-4 py-3 cursor-pointer select-none hover:bg-black/[0.03] group"
      onClick={() => onSort(k)}
      title={`Sort by ${label.toLowerCase()}`}
      aria-sort={on ? (sortDown ? "descending" : "ascending") : "none"}
    >
      <span className={on ? "text-brand-500" : undefined}>{label}</span>
      <span className={`ml-1 ${on ? "" : "opacity-0 group-hover:opacity-40"}`}>
        {on && sortDown ? "▾" : "▴"}
      </span>
    </th>
  );
}

/*
  Rank orders, not alphabet, for the three columns where alphabet means
  nothing. Sorting POS access A–Z puts Accountant above Owner and reads as
  noise; sorting it by rank puts the ladder on the screen in the shape people
  already hold it in their heads. Same for the clock: working, on break,
  gone — the order somebody scans when they are looking for who is here.
*/
const ACCESS_ORDER: Record<PosRole, number> = {
  owner: 0,
  manager: 1,
  accountant: 2,
  cashier: 3,
  writer: 4,
  technician: 5,
  mechanic: 6,
  viewer: 7,
};

const STATE_ORDER: Record<string, number> = {
  checked_in: 0,
  on_break: 1,
  checked_out: 2,
};

export default function EmployeesPage() {
  const [list, setList] = useState<Employee[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  /*
    HOW THE LIST IS ORDERED, and it is a view of the list rather than a
    reordering of it: the rows come from the server in one order and are
    sorted on their way to the screen, so nothing about who is stored where
    depends on which column somebody last clicked.

    Name ascending to start, because a roster is looked up by name far more
    often than it is grouped by anything.
  */
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDown, setSortDown] = useState(false);
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

  /*
    Every sort falls back to the name, so a column with ties — six
    technicians, everybody active — still lands in an order somebody can
    read, and the same order every time. A stable tiebreak is the difference
    between grouping a list and shuffling it.
  */
  const onSort = (k: SortKey) => {
    if (sortBy === k) setSortDown(!sortDown);
    else {
      setSortBy(k);
      setSortDown(false);
    }
  };

  const sorted = [...list].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    let d = 0;
    if (sortBy === "name") d = byName;
    else if (sortBy === "role") d = (a.role || "~").localeCompare(b.role || "~");
    else if (sortBy === "access") d = ACCESS_ORDER[a.pos_role] - ACCESS_ORDER[b.pos_role];
    else if (sortBy === "status") d = b.active - a.active;
    else if (sortBy === "state")
      d =
        (a.active === 1 ? STATE_ORDER[a.current_state] ?? 3 : 4) -
        (b.active === 1 ? STATE_ORDER[b.current_state] ?? 3 : 4);
    return (sortDown ? -d : d) || byName;
  });

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
              <SortHead label="Name" k="name" sortBy={sortBy} sortDown={sortDown} onSort={onSort} />
              <SortHead label="Role" k="role" sortBy={sortBy} sortDown={sortDown} onSort={onSort} />
              <SortHead label="POS access" k="access" sortBy={sortBy} sortDown={sortDown} onSort={onSort} />
              <SortHead label="Status" k="status" sortBy={sortBy} sortDown={sortDown} onSort={onSort} />
              <SortHead label="Current state" k="state" sortBy={sortBy} sortDown={sortDown} onSort={onSort} />
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((emp) => (
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
