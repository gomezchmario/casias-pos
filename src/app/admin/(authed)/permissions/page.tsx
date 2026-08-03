"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  CAPABILITY_GROUPS,
  CAPABILITY_INFO,
  POS_ROLES,
  ROLE_LABELS,
  can,
  type Capability,
  type PosRole,
} from "@/lib/roles";

type Employee = {
  id: number;
  name: string;
  role: string | null;
  pos_role: PosRole;
  active: number;
};

const ROLE_SUMMARY: Record<PosRole, string> = {
  technician: "Look things up. Cannot ring a sale or touch money.",
  cashier: "Runs the register: sells, takes payment, counts the drawer.",
  manager: "Fixes mistakes and handles stock — voids, refunds, receiving.",
  owner: "Everything, including what the shop paid and payroll.",
};

/**
 * Seeded by scripts/seed-test-accounts.mjs. They are real logins with real
 * PINs (1111/2222/3333/4444), so an active "Test Owner" is a back door into
 * every number in the shop. Flagged here rather than in a README because this
 * is the screen where someone is actually thinking about who can do what.
 */
const TEST_ACCOUNT_NAMES = new Set([
  "Test Technician",
  "Test Cashier",
  "Test Manager",
  "Test Owner",
]);

export default function PermissionsPage() {
  const [list, setList] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/employees")
      .then((r) => r.json())
      .then((d) => setList(d.employees || []))
      .catch(() => setError("Could not load employees"))
      .finally(() => setLoading(false));
  }, []);

  const owners = useMemo(
    () => list.filter((e) => e.pos_role === "owner" && e.active === 1),
    [list],
  );
  const liveTestAccounts = useMemo(
    () => list.filter((e) => e.active === 1 && TEST_ACCOUNT_NAMES.has(e.name)),
    [list],
  );

  /**
   * Save on change, one employee at a time. No "Save all" button on purpose:
   * a permission change is a single deliberate decision, and a screen full of
   * unsaved dropdowns is a screen where someone closes the tab believing they
   * granted access they did not. The row shows "Saved" so there is no doubt.
   */
  async function setRole(emp: Employee, posRole: PosRole) {
    if (posRole === emp.pos_role) return;

    // Demoting the last owner does not lock anyone out -- admin login is a
    // separate account -- but it does mean nobody at the register can see costs
    // or run payroll until an admin comes back to this page. Worth a pause.
    if (
      emp.pos_role === "owner" &&
      posRole !== "owner" &&
      owners.length === 1 &&
      owners[0].id === emp.id &&
      !confirm(
        `${emp.name} is the only Owner. After this change nobody signed in at the register will be able to see costs or run payroll.\n\nYou can still change it back here at any time. Continue?`,
      )
    ) {
      return;
    }

    setError(null);
    setSaving(emp.id);
    const previous = emp.pos_role;
    setList((l) => l.map((e) => (e.id === emp.id ? { ...e, pos_role: posRole } : e)));

    const res = await fetch(`/api/employees/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posRole }),
    });
    setSaving(null);

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || `Could not change ${emp.name}'s access`);
      setList((l) => l.map((e) => (e.id === emp.id ? { ...e, pos_role: previous } : e)));
      return;
    }
    setSavedAt((s) => ({ ...s, [emp.id]: Date.now() }));
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-brand-500 mb-1">Permissions</h1>
        <p className="text-brand-400">
          What each person can do at the register. Changes take effect the next
          time they sign in, and every change is written to the audit log.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm bg-red-50 text-red-700">
          {error}
        </div>
      )}

      {owners.length === 0 && !loading && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm bg-amber-50 text-amber-800">
          No active employee has Owner access, so nobody at the register can see
          what the shop paid for stock or run payroll.
        </div>
      )}

      {liveTestAccounts.length > 0 && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm bg-amber-50 text-amber-800">
          <strong>Test accounts are still active:</strong>{" "}
          {liveTestAccounts.map((e) => e.name).join(", ")}. Their PINs are
          public knowledge — deactivate them on the Employees page before the
          shop goes live.
        </div>
      )}

      <section className="bg-white rounded-2xl shadow-sm overflow-hidden mb-8">
        <header className="px-5 py-4 border-b border-black/5">
          <h2 className="font-semibold text-brand-500">Who has what</h2>
          <p className="text-sm text-brand-400">
            Pick a level and it saves straight away.
          </p>
        </header>
        <table className="w-full text-sm">
          <thead style={{ background: "rgba(10,37,64,0.03)" }}>
            <tr className="text-left text-brand-400 uppercase text-xs tracking-wider">
              <th className="px-5 py-3">Employee</th>
              <th className="px-5 py-3">Register access</th>
              <th className="px-5 py-3">What that means</th>
            </tr>
          </thead>
          <tbody>
            {list.map((emp) => (
              <tr key={emp.id} className="border-t border-black/5">
                <td className="px-5 py-3">
                  <div className="font-medium text-brand-500">{emp.name}</div>
                  {emp.role && (
                    <div className="text-xs text-brand-300">{emp.role}</div>
                  )}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <select
                      className="input"
                      value={emp.pos_role}
                      disabled={saving === emp.id}
                      onChange={(e) => setRole(emp, e.target.value as PosRole)}
                    >
                      {POS_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    {saving === emp.id && (
                      <span className="text-xs text-brand-300">Saving…</span>
                    )}
                    {saving !== emp.id && savedAt[emp.id] && (
                      <span className="text-xs text-green-700">Saved</span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 text-brand-400">
                  {ROLE_SUMMARY[emp.pos_role]}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-brand-300">
                  {loading ? "Loading…" : "No active employees."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <CapabilityMatrix />
    </div>
  );
}

/**
 * The permission model, rendered from the code that enforces it.
 *
 * Nothing here is hand-maintained: the rows come from CAPABILITIES and the
 * ticks come from can(), the same function the server calls. A permission
 * cannot be changed in one place and stale on this screen, which is the whole
 * reason it is worth showing an owner at all.
 */
function CapabilityMatrix() {
  const byGroup = useMemo(() => {
    // Ordered by CAPABILITY_INFO, not CAPABILITIES: the former is arranged the
    // way a person reads down the list, the latter the way the code grew.
    // Both are total over Capability, so nothing can be dropped either way.
    const keys = Object.keys(CAPABILITY_INFO) as Capability[];
    return CAPABILITY_GROUPS.map((group) => ({
      group,
      caps: keys.filter((c) => CAPABILITY_INFO[c].group === group),
    })).filter((g) => g.caps.length > 0);
  }, []);

  return (
    <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <header className="px-5 py-4 border-b border-black/5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-brand-500">What each level can do</h2>
          <p className="text-sm text-brand-400">
            Each level includes everything below it. This is read from the
            system itself, so it is always what is actually enforced.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost no-print"
          onClick={() => window.print()}
        >
          Print
        </button>
      </header>

      <table className="w-full text-sm">
        <thead style={{ background: "rgba(10,37,64,0.03)" }}>
          <tr className="text-brand-400 uppercase text-xs tracking-wider">
            <th className="px-5 py-3 text-left">Can…</th>
            {POS_ROLES.map((r) => (
              <th key={r} className="px-3 py-3 text-center">
                {ROLE_LABELS[r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {byGroup.map(({ group, caps }) => (
            <Fragment key={group}>
              <tr style={{ background: "rgba(10,37,64,0.02)" }}>
                <td
                  colSpan={POS_ROLES.length + 1}
                  className="px-5 py-2 text-xs uppercase tracking-wider text-brand-400 font-semibold border-t border-black/5"
                >
                  {group}
                </td>
              </tr>
              {caps.map((c) => (
                <tr key={c} className="border-t border-black/5">
                  <td className="px-5 py-2 text-brand-500">
                    {CAPABILITY_INFO[c].label}
                  </td>
                  {POS_ROLES.map((r) => (
                    <td key={r} className="px-3 py-2 text-center">
                      {can(r, c) ? (
                        <span className="text-green-700" title="Allowed">
                          ✓
                        </span>
                      ) : (
                        <span className="text-brand-200" title="Not allowed">
                          ·
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <footer className="px-5 py-4 border-t border-black/5 text-sm text-brand-400">
        {POS_ROLES.map((r) => (
          <div key={r}>
            <strong className="text-brand-500">{ROLE_LABELS[r]}</strong> —{" "}
            {ROLE_SUMMARY[r]}
          </div>
        ))}
        {/*
          The one row above that a setting can move. Noted here rather than left
          implicit, because a screen that says "Cashier ✓" while the register
          says otherwise is worse than no screen.
        */}
        <p className="mt-3 text-xs text-brand-300">
          "Sell stock the system says is gone" also depends on the{" "}
          <em>Allow overselling</em> shop setting. While it is on, a cashier can
          do it and the sale is flagged for review; switch it off and it becomes
          a manager's decision.
        </p>
      </footer>
    </section>
  );
}
