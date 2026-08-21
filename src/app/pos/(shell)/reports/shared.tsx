"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/components/pos/LangToggle";
import { ShopLogo } from "@/components/ui/ShopLogo";
import type { Staffing } from "@/lib/reports-bi";
import type {
  AgingBucket,
  CategoryRow,
  ControlStats,
  CustomerStats,
  DeadStockRow,
  EmployeeRow,
  Headline,
  HourCell,
  LostRow,
  ProductRow,
  PurchaseSummary,
  ReorderRow,
  RestockRow,
  StockValueRow,
  TenderRow,
  TrendPoint,
  WeekdayRow,
} from "@/lib/reports-bi";
import type {
  CategoryTrend,
  FleetBook,
  RetentionBook,
  SeasonalMonth,
  SpecialOrders,
} from "@/lib/reports-suite";

/**
 * What every page of the reports suite shares.
 *
 * THE SUITE IS SEVERAL PAGES READING ONE PAYLOAD. Splitting the old four-screen
 * report into areas only works if the areas cannot disagree — same window, same
 * fetch, same moment. So the window control, the fetch, the tab strip and the
 * payload type live here, once, and a page is only the panels it draws.
 *
 * The window rides in the URL (`?from&to`) so it SURVIVES the tab strip: pick
 * a fortnight on Sales, open Financial, and it is the same fortnight. History
 * is written with `replaceState` rather than the router so flicking through
 * presets does not bury the back button under nine date ranges.
 */

// ── The payload, typed once ────────────────────────────────────────────────
export type SuiteData = {
  from: string;
  to: string;
  days: number;
  grain: "day" | "week" | "month";
  today: string;
  firstDate: string;
  headline: Headline;
  trend: TrendPoint[];
  categories: CategoryRow[];
  tenders: TenderRow[];
  heatmap: HourCell[];
  staffing: Staffing;
  weekdays: WeekdayRow[];
  bestSellers: ProductRow[];
  stock: { totalUnits: number; totalCostCents: number; byBrand: StockValueRow[]; byRim: StockValueRow[] };
  dead: DeadStockRow[];
  deadTotal: { sizes: number; costCents: number };
  reorder: ReorderRow[];
  restock: RestockRow[];
  aging: AgingBucket[];
  customers: CustomerStats;
  control: ControlStats;
  lost: { recorded: LostRow[]; searched: LostRow[] };
  purchases: PurchaseSummary;
  categoryTrend: CategoryTrend;
  specialOrders: SpecialOrders;
  seasonalCats: SeasonalMonth[];
  retention: RetentionBook;
  fleet: FleetBook;
  techs: {
    employeeId: number;
    name: string;
    newTires: number;
    usedTires: number;
    otherCount: number;
    ticketCount: number;
    incomeCents: number;
    tipCents: number;
    incomePct: number;
  }[];
  employees: {
    rows: EmployeeRow[];
    priorFrom: string;
    priorTo: string;
    priorTradingDays: number;
  };
  sparks: { months: string[]; byEmployee: Record<number, number[]> };
};

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function hourLabel(hour: number): string {
  return hour === 0
    ? "12 AM"
    : hour < 12
      ? `${hour} AM`
      : hour === 12
        ? "12 PM"
        : `${hour - 12} PM`;
}

/** The bucket key as a chart label: "8/9", "wk 8/4", "Aug". */
export function bucketLabel(bucket: string, grain: SuiteData["grain"]): string {
  if (grain === "month") {
    const [, m] = bucket.split("-");
    return (
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
        Number(m) - 1
      ] ?? bucket
    );
  }
  const [, m, d] = bucket.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// ── The window, and the one fetch ──────────────────────────────────────────

const PRESETS: { key: string; label: string; days: number }[] = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: 0 },
];
const RANGE = "range";

function shiftDays(from: string, n: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type ReportWindow = {
  preset: string;
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  setPreset: (v: string) => void;
  choose: (key: string, data: SuiteData | null) => void;
};

export function useSuite(): {
  data: SuiteData | null;
  error: string | null;
  win: ReportWindow;
} {
  // Read once, synchronously, before the first fetch — a page opened from the
  // tab strip carries its window in the URL and must not load thirty days
  // first and the right window second.
  const [init] = useState(() => {
    if (typeof window === "undefined") return { from: "", to: "" };
    const sp = new URLSearchParams(window.location.search);
    return { from: sp.get("from") ?? "", to: sp.get("to") ?? "" };
  });
  const [preset, setPreset] = useState(init.from || init.to ? RANGE : "30");
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [data, setData] = useState<SuiteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    const res = await fetch(`/api/pos/reports/business?${sp}`);
    if (!res.ok) {
      setError("Could not load the reports");
      return;
    }
    setData(await res.json());
    setError(null);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // The URL follows the state, so the tab strip and a copied link both carry
  // the window somebody actually chose.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (from) sp.set("from", from);
    else sp.delete("from");
    if (to) sp.set("to", to);
    else sp.delete("to");
    const qs = sp.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [from, to]);

  const choose = useCallback((key: string, d: SuiteData | null) => {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    // `to` stays empty so the server uses its own idea of today — the browser
    // and the shop can disagree about what day it is at four in the morning.
    setTo("");
    setFrom("");
    if (key === "all") setFrom(d?.firstDate ?? "");
    else if (d?.today) setFrom(shiftDays(d.today, -(p.days - 1)));
  }, []);

  return { data, error, win: { preset, from, to, setFrom, setTo, setPreset, choose } };
}

/** The window's query string, for links that must keep it. */
export function windowQuery(win: ReportWindow): string {
  const sp = new URLSearchParams();
  if (win.from) sp.set("from", win.from);
  if (win.to) sp.set("to", win.to);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

// ── The chrome every page wears ────────────────────────────────────────────

export const AREAS: { href: string; label: string }[] = [
  { href: "/pos/reports", label: "Overview" },
  { href: "/pos/reports/sales", label: "Sales & Revenue" },
  { href: "/pos/reports/tires", label: "Inventory & Tires" },
  { href: "/pos/reports/crew", label: "Technicians" },
  { href: "/pos/reports/customers", label: "Customers & Fleet" },
  { href: "/pos/reports/financial", label: "Financial" },
  { href: "/pos/reports/trends", label: "Trends" },
];

export function ReportsNav({ win }: { win?: ReportWindow }) {
  const { t: tr } = useLang();
  const pathname = usePathname();
  // Trends takes no window on principle — see its own header — so its tab
  // carries none rather than handing the page a query it would have to ignore.
  const qs = win ? windowQuery(win) : "";
  return (
    <nav className="rp-tabs rp-no-print" aria-label={tr("Report areas")}>
      {AREAS.map((a) => {
        const active = pathname === a.href;
        return (
          <Link
            key={a.href}
            href={a.href === "/pos/reports/trends" ? a.href : `${a.href}${qs}`}
            className={active ? "rp-tab rp-tab-on" : "rp-tab"}
            aria-current={active ? "page" : undefined}
          >
            {tr(a.label)}
          </Link>
        );
      })}
    </nav>
  );
}

export function ExperimentalNote() {
  const { t: tr } = useLang();
  return (
    <div className="rp-experimental rp-no-print" role="status">
      <strong>{tr("Reports are still being built.")}</strong>{" "}
      {tr("These figures are experimental and for the development team.")}
    </div>
  );
}

/**
 * The heading, the window control and the print masthead, shared whole.
 *
 * One control that swaps what it shows, not presets and date boxes side by
 * side — both on screen at once invites the reading that a preset and a range
 * are somehow both in force.
 */
export function RangeBar({
  title,
  blurb,
  data,
  win,
  printTitle,
}: {
  title: string;
  blurb: string;
  data: SuiteData | null;
  win: ReportWindow;
  printTitle: string;
}) {
  const { t: tr } = useLang();
  const [printedOn, setPrintedOn] = useState("");
  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 rp-no-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{title}</h1>
          <p className="text-brand-400 text-sm">{blurb}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {win.preset === RANGE ? (
            <>
              <span className="rp-range-note">{tr("Between")}</span>
              <input
                type="date"
                className="input"
                style={{ height: 34, fontSize: 13 }}
                value={win.from || data?.from || ""}
                max={win.to || data?.to || ""}
                onChange={(e) => win.setFrom(e.target.value)}
              />
              <span className="rp-range-note">{tr("and")}</span>
              <input
                type="date"
                className="input"
                style={{ height: 34, fontSize: 13 }}
                value={win.to || data?.to || ""}
                min={win.from || data?.from || ""}
                max={data?.today}
                onChange={(e) => win.setTo(e.target.value)}
              />
            </>
          ) : (
            PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={win.preset === p.key ? "btn btn-primary" : "btn btn-outline"}
                style={{ height: 34, fontSize: 13 }}
                onClick={() => win.choose(p.key, data)}
              >
                {tr(p.label)}
              </button>
            ))
          )}
          <button
            type="button"
            className={win.preset === RANGE ? "btn btn-primary" : "btn btn-outline"}
            style={{ height: 34, fontSize: 13 }}
            aria-pressed={win.preset === RANGE}
            onClick={() => {
              if (win.preset === RANGE) {
                win.choose("30", data);
                return;
              }
              win.setFrom(win.from || data?.from || "");
              win.setTo(win.to || data?.to || "");
              win.setPreset(RANGE);
            }}
          >
            {win.preset === RANGE ? tr("Done") : tr("Range")}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ height: 34, fontSize: 13 }}
            onClick={() => window.print()}
          >
            {tr("Print")}
          </button>
        </div>
      </div>

      {data && (
        <div className="rp-range rp-no-print">
          <span className="rp-range-note">
            {data.from} → {data.to} · {data.days} {data.days === 1 ? tr("day") : tr("days")} ·{" "}
            {tr("compared with the same length before it")}
          </span>
        </div>
      )}

      {/* On paper only — a sheet taken to an accountant has to say whose shop
          it is and what period it covers. */}
      <div className="rp-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>{printTitle}</div>
          <div style={{ fontSize: "9pt" }}>
            {data ? `${data.from} → ${data.to}` : ""} · {tr("printed")} {printedOn}
          </div>
        </div>
      </div>
    </>
  );
}

/** A titled block of the report, with the sentence that says how to read it. */
export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rp-section" id={id}>
      <h2 className="rp-h2">{title}</h2>
      {/* The sentence under the heading is not decoration. Every panel on this
          page can be read wrong, and the commonest way is assuming a figure
          covers something it does not. */}
      {note && <p className="rp-note">{note}</p>}
      {children}
    </section>
  );
}

export function Panel({
  title,
  note,
  children,
  fill,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  /** Stretch to the height of the row and let the content use it — .rp-fill. */
  fill?: boolean;
}) {
  return (
    <div className={`rp-panel${fill ? " rp-fill" : ""}`}>
      <div className="rp-panel-head">
        <span>{title}</span>
        {note && <em>{note}</em>}
      </div>
      {children}
    </div>
  );
}

/**
 * A door on the overview: where an area is, what it holds, and the two or
 * three figures that say whether it needs opening today.
 */
export function Door({
  href,
  title,
  blurb,
  facts,
  win,
}: {
  href: string;
  title: string;
  blurb: string;
  facts: { label: string; value: string; tone?: "warn" | "bad" | "good" }[];
  win: ReportWindow;
}) {
  return (
    <Link href={`${href}${href === "/pos/reports/trends" ? "" : windowQuery(win)}`} className="rp-door">
      <div className="rp-door-head">
        <span className="rp-door-title">{title}</span>
        <span className="rp-door-go" aria-hidden>
          →
        </span>
      </div>
      <p className="rp-door-blurb">{blurb}</p>
      <div className="rp-door-facts">
        {facts.map((f) => (
          <div key={f.label} className={`rp-door-fact${f.tone ? ` rp-door-${f.tone}` : ""}`}>
            <span className="rp-door-val">{f.value}</span>
            <span className="rp-door-lab">{f.label}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}
