import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { buildWeeklyReport, currentWeekRange } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { requireAdminApi } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const format = (sp.get("format") || "csv").toLowerCase();
  const weekStartDay = parseInt(getSetting("week_start_day"), 10) || 0;
  const range = currentWeekRange(weekStartDay);
  const startDate = sp.get("startDate") || range.startDate;
  const endDate = sp.get("endDate") || range.endDate;
  const employeeId = sp.get("employeeId")
    ? parseInt(sp.get("employeeId")!, 10)
    : undefined;

  const report = buildWeeklyReport({
    startDate,
    endDate,
    weekStartDay,
    employeeId,
  });

  const filenameBase = `timeclock_${startDate}_to_${endDate}`;

  if (format === "csv") {
    const lines: string[] = [];
    lines.push(
      "Employee,Worked (h:m),Worked (decimal),Break (h:m),Net (h:m),Daily Breakdown",
    );
    for (const r of report.rows) {
      const daily = r.daily
        .map((d) => `${d.date}: ${(d.workedMinutes / 60).toFixed(2)}h`)
        .join("; ");
      lines.push(
        [
          escapeCsv(r.employee_name),
          r.workedHHMM,
          r.workedDecimal,
          r.breakHHMM,
          r.netHHMM,
          escapeCsv(daily),
        ].join(","),
      );
    }
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
      },
    });
  }

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Casias Tire Shop Time Clock";
    wb.created = new Date();

    const summary = wb.addWorksheet("Summary");
    summary.columns = [
      { header: "Employee", key: "name", width: 24 },
      { header: "Worked (h:m)", key: "worked", width: 14 },
      { header: "Worked (hours)", key: "workedDec", width: 14 },
      { header: "Break (h:m)", key: "break", width: 14 },
      { header: "Net (h:m)", key: "net", width: 14 },
      { header: "Flagged?", key: "flagged", width: 10 },
    ];
    summary.getRow(1).font = { bold: true };
    summary.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0A2540" },
    };
    summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    for (const r of report.rows) {
      summary.addRow({
        name: r.employee_name,
        worked: r.workedHHMM,
        workedDec: parseFloat(r.workedDecimal),
        break: r.breakHHMM,
        net: r.netHHMM,
        flagged: r.hasFlagged ? "Yes" : "",
      });
    }

    const daily = wb.addWorksheet("Daily Breakdown");
    daily.columns = [
      { header: "Employee", key: "name", width: 24 },
      { header: "Date", key: "date", width: 12 },
      { header: "Worked (h:m)", key: "worked", width: 14 },
      { header: "Worked (hours)", key: "workedDec", width: 14 },
      { header: "Break (h:m)", key: "break", width: 14 },
      { header: "Shifts", key: "shifts", width: 8 },
      { header: "Notes", key: "notes", width: 30 },
    ];
    daily.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    daily.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0A2540" },
    };
    for (const r of report.rows) {
      for (const d of r.daily) {
        daily.addRow({
          name: r.employee_name,
          date: d.date,
          worked: minutesToHMM(d.workedMinutes),
          workedDec: parseFloat((d.workedMinutes / 60).toFixed(2)),
          break: minutesToHMM(d.breakMinutes),
          shifts: d.shifts,
          notes: [
            d.hasOpenShift ? "Open shift" : "",
            d.hasFlagged ? "Has flagged entry" : "",
          ]
            .filter(Boolean)
            .join("; "),
        });
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "format must be csv or xlsx" }, { status: 400 });
}

function escapeCsv(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function minutesToHMM(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${String(mm).padStart(2, "0")}m`;
}
