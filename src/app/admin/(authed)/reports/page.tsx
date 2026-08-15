"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";

type Employee = { id: number; name: string };
type DailyBreakdown = {
  date: string;
  workedMinutes: number;
  breakMinutes: number;
  shifts: number;
  hasOpenShift: boolean;
  hasFlagged: boolean;
};
type EmployeeWeekly = {
  employee_id: number;
  employee_name: string;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  netWorkedMinutes: number;
  workedHHMM: string;
  breakHHMM: string;
  netHHMM: string;
  workedDecimal: string;
  daily: DailyBreakdown[];
  hasFlagged: boolean;
};
type WeeklyReport = {
  startDate: string;
  endDate: string;
  weekStartDay: number;
  rows: EmployeeWeekly[];
};

/** Minutes as "41:30", the shape the per-person columns already use. */
function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function startOfWeekLocal(d: Date, weekStartDay: number) {
  const day = d.getDay();
  const diff = (day - weekStartDay + 7) % 7;
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - diff);
  return r;
}

export default function ReportsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [weekStartDay, setWeekStartDay] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/employees?includeInactive=true").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]).then(([emps, sets]) => {
      setEmployees(emps.employees || []);
      const wsd = parseInt(sets.settings.week_start_day, 10) || 0;
      setWeekStartDay(wsd);
      const today = new Date();
      const start = startOfWeekLocal(today, wsd);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      setStartDate(isoDate(start));
      setEndDate(isoDate(end));
    });
  }, []);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (startDate) sp.set("startDate", startDate);
    if (endDate) sp.set("endDate", endDate);
    if (employeeId) sp.set("employeeId", employeeId);
    return sp.toString();
  }, [startDate, endDate, employeeId]);

  function load() {
    if (!startDate || !endDate) return;
    setLoading(true);
    fetch(`/api/reports/weekly?${queryString}`)
      .then((r) => r.json())
      .then((d) => setReport(d))
      .finally(() => setLoading(false));
  }

  useEffect(() => { if (startDate && endDate) load(); }, [queryString]);

  function shiftWeek(direction: -1 | 1) {
    const s = new Date(`${startDate}T00:00:00`);
    s.setDate(s.getDate() + direction * 7);
    const e = new Date(`${endDate}T00:00:00`);
    e.setDate(e.getDate() + direction * 7);
    setStartDate(isoDate(s));
    setEndDate(isoDate(e));
  }

  function thisWeek() {
    const today = new Date();
    const start = startOfWeekLocal(today, weekStartDay);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    setStartDate(isoDate(start));
    setEndDate(isoDate(end));
  }

  function exportCsv() {
    window.open(`/api/reports/export?format=csv&${queryString}`, "_blank");
  }
  function exportXlsx() {
    window.open(`/api/reports/export?format=xlsx&${queryString}`, "_blank");
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6 no-print">
        <div>
          <h1 className="text-3xl font-semibold text-brand-500 mb-1">Weekly Hours</h1>
          <p className="text-brand-400">Hours worked, breaks, and daily breakdown.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖨 Print</button>
          <button type="button" className="btn btn-ghost" onClick={exportCsv}>⬇ CSV</button>
          <button type="button" className="btn btn-primary" onClick={exportXlsx}>⬇ XLSX</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4 mb-6 flex flex-wrap gap-3 items-end no-print">
        <div className="flex items-end gap-1">
          <button type="button" className="btn btn-ghost" onClick={() => shiftWeek(-1)} aria-label="Previous week">◀</button>
          <Field label="From">
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
          <button type="button" className="btn btn-ghost" onClick={() => shiftWeek(1)} aria-label="Next week">▶</button>
        </div>
        <button type="button" className="btn btn-ghost" onClick={thisWeek}>This week</button>
        <Field label="Employee">
          <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">All employees</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 print:shadow-none print:p-0">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-brand-500">
            {startDate} → {endDate}
          </h2>
          <span className="text-sm text-brand-400">
            {loading ? "Loading…" : report ? `${report.rows.length} employees` : ""}
          </span>
        </div>

        {/*
          The same rows as bars, because the table answers "how many hours did
          Jerry work" and cannot answer "who worked the most" without reading
          every line and holding them in your head. Payroll asks the first
          question; fairness arguments ask the second, and they happen at this
          screen with two people looking at it.
        */}
        {report && report.rows.length > 1 && (
          <div className="mb-6">
            {(() => {
              const max = Math.max(...report.rows.map((r) => r.netWorkedMinutes), 1);
              return [...report.rows]
                .sort((a, b) => b.netWorkedMinutes - a.netWorkedMinutes)
                .map((r) => (
                  <div key={r.employee_id} className="flex items-center gap-3 py-1">
                    <span
                      className="text-sm text-brand-500 truncate text-right"
                      style={{ width: 120, flex: "none" }}
                    >
                      {r.employee_name}
                    </span>
                    <div className="flex-1 rounded-md" style={{ background: "rgba(10,37,64,0.05)" }}>
                      <div
                        className="rounded-md"
                        style={{
                          width: `${Math.max(1, (r.netWorkedMinutes / max) * 100)}%`,
                          height: 16,
                          background: "linear-gradient(90deg, #1f3f64, #0a2540)",
                        }}
                      />
                    </div>
                    <span
                      className="text-sm tabular-nums font-semibold text-brand-500 text-right"
                      style={{ width: 64, flex: "none" }}
                    >
                      {r.netHHMM}
                    </span>
                  </div>
                ));
            })()}
          </div>
        )}

        {report && (
          <table className="w-full text-sm">
            <thead style={{ background: "rgba(10,37,64,0.03)" }}>
              <tr className="text-left text-brand-400 uppercase text-xs tracking-wider">
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2 text-right">Worked</th>
                <th className="px-3 py-2 text-right">Hours (decimal)</th>
                <th className="px-3 py-2 text-right">Break</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <EmployeeRow key={row.employee_id} row={row} />
              ))}
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-brand-300">
                    No data for this range.
                  </td>
                </tr>
              )}
            </tbody>
            {/*
              The line payroll actually copies out. Every column summed, because
              this table's whole destination is a wage calculation and the sheet
              was making somebody add a column of h:mm figures by hand — which
              is the one kind of arithmetic people reliably get wrong.
            */}
            {report.rows.length > 1 && (
              <tfoot>
                <tr
                  className="border-t-2"
                  style={{ borderColor: "rgba(10,37,64,0.2)" }}
                >
                  <td className="px-3 py-3 font-semibold text-brand-500">
                    Everybody · {report.rows.length}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">
                    {hhmm(report.rows.reduce((n, r) => n + r.totalWorkedMinutes, 0))}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">
                    {(report.rows.reduce((n, r) => n + r.totalWorkedMinutes, 0) / 60).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-brand-400">
                    {hhmm(report.rows.reduce((n, r) => n + r.totalBreakMinutes, 0))}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-bold text-brand-500">
                    {hhmm(report.rows.reduce((n, r) => n + r.netWorkedMinutes, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}

function EmployeeRow({ row }: { row: EmployeeWeekly }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-black/5">
        <td className="px-3 py-3 font-medium text-brand-500">
          {row.employee_name}
          {row.hasFlagged && <Badge tone="danger" size="sm">⚠</Badge>}
        </td>
        <td className="px-3 py-3 text-right tabular-nums">{row.workedHHMM}</td>
        <td className="px-3 py-3 text-right tabular-nums">{row.workedDecimal}</td>
        <td className="px-3 py-3 text-right tabular-nums text-brand-400">{row.breakHHMM}</td>
        <td className="px-3 py-3 text-right tabular-nums font-semibold text-brand-500">{row.netHHMM}</td>
        <td className="px-3 py-3 text-right no-print">
          <button
            type="button"
            className="text-xs text-brand-400 hover:text-brand-500 underline"
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide days" : "By day"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-black/5">
          <td colSpan={6} className="px-3 py-3 bg-black/[0.015]">
            <div className="grid grid-cols-7 gap-2">
              {row.daily.map((d) => (
                <div
                  key={d.date}
                  className="text-xs text-center rounded-lg p-2"
                  style={{
                    background: d.workedMinutes > 0 ? "rgba(255,200,61,0.10)" : "rgba(10,37,64,0.04)",
                    border: d.hasFlagged ? "1px solid rgba(216,68,76,0.4)" : "1px solid transparent",
                  }}
                >
                  <div className="font-medium text-brand-400">
                    {new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })}
                  </div>
                  <div className="tabular-nums text-brand-500 mt-1 font-semibold">
                    {(d.workedMinutes / 60).toFixed(2)}h
                  </div>
                  {d.breakMinutes > 0 && (
                    <div className="tabular-nums text-brand-300">br {(d.breakMinutes / 60).toFixed(2)}h</div>
                  )}
                  {d.hasOpenShift && (
                    <div className="text-[10px] text-orange-700 mt-1">open</div>
                  )}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
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
