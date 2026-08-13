"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { formatCents, parseCents } from "@/lib/money";
import "./customers.css";
import { useLang } from "@/components/pos/LangToggle";

/**
 * The customer book.
 *
 * The register has always been able to FIND a customer — that is what the
 * type-ahead on a ticket does — and has never been able to show you one. So
 * "when was he last in", "what did we put on it", and "does he still owe us"
 * were questions answered by remembering, or by not answering them.
 *
 * Two panes rather than two pages. The question is nearly always asked with a
 * customer on the phone and a name half-remembered, which means moving between
 * candidates quickly; a page per customer would put a load and a back button
 * between every guess.
 */

type Row = {
  id: number;
  customerNo: string;
  name: string;
  phone: string | null;
  vehicles: number;
  tickets: number;
  spentCents: number;
  owedCents: number;
  creditTickets: number;
  accountBalanceCents: number;
  lastVisit: string | null;
  hasNote: boolean;
  creditApproved: boolean;
  fleetId: number | null;
  fleetName: string | null;
  isFleet: number;
  fleetMembers: number;
};

type Vehicle = {
  id: number;
  year: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  plate: string | null;
  tireSize: string | null;
  notes: string | null;
};

type Detail = {
  customer: {
    id: number;
    customerNo: string;
    name: string;
    phone: string | null;
    notes: string | null;
    pinnedNote: string | null;
    pinnedNoteBy: string | null;
    pinnedNoteAt: string | null;
    creditApproved: boolean;
    fleetId: number | null;
    isFleet: boolean;
    address: string | null;
    email: string | null;
    billingName: string | null;
    billingPhone: string | null;
    billingEmail: string | null;
    since: string;
  };
  fleet: { id: number; name: string; customerNo: string } | null;
  members: {
    id: number;
    customerNo: string;
    name: string;
    phone: string | null;
    vehicles: number;
    chargedCents: number;
    lastVisit: string | null;
  }[];
  vehicles: Vehicle[];
  tickets: {
    saleId: number;
    saleNo: string;
    businessDate: string;
    status: string;
    fulfillmentStatus: string;
    totalCents: number;
    paidCents: number;
    balanceCents: number;
    po: string | null;
    vehicle: string | null;
    what: string | null;
  }[];
  creditOnly: boolean;
};

const carLine = (v: Vehicle) =>
  [v.year, v.make, v.model, v.color].filter(Boolean).join(" ") || "Vehicle";

export default function CustomersPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const [q, setQ] = useState("");
  const [owing, setOwing] = useState(false);
  const [credit, setCredit] = useState(false);
  const [notApproved, setNotApproved] = useState(false);
  /** Companies only — the ones other customers are billed to. */
  const [companies, setCompanies] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);

  /*
    The list as displayed: grouped under the company when Companies is ticked.

    A company's drivers scattered through the alphabet answer "who is on this
    account" only to somebody who already knows. Grouped, each company is a
    heading with its people directly beneath — the same shape as the statement
    that gets printed for them. Orphan drivers (fleet deleted, member kept)
    fall through to the bottom rather than vanishing.

    Everywhere else the list stays flat and alphabetical, which is right for
    "find this person while they stand at the counter".
  */
  const displayRows = React.useMemo(() => {
    if (!rows) return [];
    if (!companies) return rows;
    const fleets = rows.filter((c) => c.isFleet === 1);
    const members = rows.filter((c) => c.isFleet !== 1);
    const out: typeof rows = [];
    for (const f of fleets) {
      out.push(f);
      for (const m of members.filter((m) => m.fleetId === f.id)) out.push(m);
    }
    for (const m of members.filter((m) => !fleets.some((f) => f.id === m.fleetId))) out.push(m);
    return out;
  }, [rows, companies]);

  /*
    The filtered list's own arithmetic, shown above it.

    Ticking a box asks a question — "who runs an account", "which companies" —
    and the total is half of why it was asked. Summed from exactly the rows on
    screen, so the header and the list can never disagree.
  */
  const tally = React.useMemo(() => {
    if (!rows || !(owing || credit || notApproved || companies)) return null;
    const people = rows.length;
    const tickets = rows.reduce((n, c) => n + Math.max(0, c.owedCents), 0);
    const account = rows.reduce((n, c) => n + Math.max(0, c.accountBalanceCents), 0);
    return { people, tickets, account, companies: rows.filter((c) => c.isFleet === 1).length };
  }, [rows, owing, credit, notApproved, companies]);
  const [picked, setPicked] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Editing state. Null when nothing is open — the panel is a reading screen
  // first and only becomes a form when somebody asks it to.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  /**
   * The book's own way in, for the person whose job is the book.
   *
   * Customers have always been minted from a ticket — the right shape at the
   * counter, and no shape at all for the accountant setting up a fleet account
   * before its first invoice. Her actual workaround was ringing a test ticket
   * to get a record to exist, which is how test tickets end up in the day's
   * takings.
   */
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", phone: "", notes: "", fleetId: "" });
  /** Every company somebody can be billed to — for both pickers on this page. */
  const [fleets, setFleets] = useState<
    { id: number; customerNo: string; name: string; creditApproved: number; members: number }[]
  >([]);
  /**
   * The company block's draft.
   *
   * Held as a draft and saved on a button rather than on every keystroke,
   * unlike the rest of this panel. An address is typed in pieces — three lines
   * and a zip — and a field that saved itself halfway through would write a
   * half-address, then again, then again, filling the audit log with versions
   * of a sentence nobody finished.
   */
  const [company, setCompany] = useState({
    address: "",
    email: "",
    billingName: "",
    billingPhone: "",
    billingEmail: "",
  });
  const [companyDirty, setCompanyDirty] = useState(false);
  const [note, setNote] = useState("");
  const [editCar, setEditCar] = useState<Vehicle | null>(null);
  const [removingCar, setRemovingCar] = useState<Vehicle | null>(null);
  const [removingCustomer, setRemovingCustomer] = useState(false);
  // Bumped when anything on the panel changes, so the account reloads with it.
  const [accountReload] = useState(0);

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (owing) sp.set("owing", "1");
    if (credit) sp.set("credit", "1");
    if (notApproved) sp.set("notApproved", "1");
    if (companies) sp.set("companies", "1");
    const res = await fetch(`/api/pos/customers/list?${sp}`);
    if (!res.ok) {
      setError("Could not load the customer list");
      return;
    }
    setRows((await res.json()).customers);
    setError(null);
  }, [q, owing, credit, notApproved, companies]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (picked === null) {
      setDetail(null);
      return;
    }
    const res = await fetch(`/api/pos/customers/${picked}?credit=${credit ? "1" : "0"}`);
    if (!res.ok) return;
    const d: Detail = await res.json();
    setDetail(d);
    setForm({
      name: d.customer.name,
      phone: d.customer.phone ?? "",
      notes: d.customer.notes ?? "",
    });
    setNote(d.customer.pinnedNote ?? "");
    setCompany({
      address: d.customer.address ?? "",
      email: d.customer.email ?? "",
      billingName: d.customer.billingName ?? "",
      billingPhone: d.customer.billingPhone ?? "",
      billingEmail: d.customer.billingEmail ?? "",
    });
    setCompanyDirty(false);
  }, [picked, credit]);

  useEffect(() => {
    setEditing(false);
    void loadDetail();
  }, [loadDetail]);

  const loadFleets = useCallback(async () => {
    const res = await fetch("/api/pos/fleets");
    if (res.ok) setFleets((await res.json()).fleets);
  }, []);
  useEffect(() => {
    void loadFleets();
  }, [loadFleets]);

  /** One writer for every change on this panel, so errors surface in one place. */
  async function send(url: string, init: RequestInit) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const res = await fetch(url, init);
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "That did not save");
      return false;
    }
    await loadDetail();
    await load();
    return true;
  }

  const patchCustomer = (body: Record<string, unknown>) =>
    send(`/api/pos/customers/${picked}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  /** Not through `send` — on success the new person becomes the selection. */
  async function addCustomer() {
    if (busy || !addForm.name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/pos/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: addForm.name,
        phone: addForm.phone.trim() || null,
        notes: addForm.notes.trim() || null,
        fleetId: addForm.fleetId ? Number(addForm.fleetId) : null,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // The duplicate-phone refusal lands here, naming who already has the
      // number — worth keeping on screen next to the form rather than the
      // page's banner, but the banner is where errors live on this page.
      setError(d.error || "That did not save");
      return;
    }
    setAdding(false);
    setAddForm({ name: "", phone: "", notes: "", fleetId: "" });
    await load();
    setPicked(d.customer.id);
  }

  if (!can("viewLog"))
    return <div className="text-brand-400">Your account can&apos;t see the customer list.</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 cu-hide-on-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{tr("Customers")}</h1>
          <p className="text-brand-400 text-sm">
            Everyone the shop has taken a name from. Click one to see their cars
            and everything they have had done.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Whoever may correct the book may add to it — the accountant by
              name, managers by rank. Readers of the book don't get the button:
              minting people is how duplicates happen, and the fewer hands the
              better. */}
          {can("manageCustomers") && (
            <button
              type="button"
              className={adding ? "btn btn-primary" : "btn btn-outline"}
              aria-expanded={adding}
              onClick={() => setAdding((v) => !v)}
            >
              {tr("New customer")}
            </button>
          )}
          {/* Only for the people who handle account money. Everybody else can
              read this book — that is what `viewLog` above allows — and nobody
              else has any business with a month's worth of what is owed. */}
          {can("manageCreditAccounts") && (
            <Link href="/pos/customers/month" className="btn btn-outline">{tr("Accounts this month")}</Link>
          )}
          <Link href="/pos/entries" className="btn btn-outline">
            ← Logs
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {adding && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 cu-hide-on-print">
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
            {tr("New customer")}
          </div>
          <p className="text-sm text-brand-400 mb-3" style={{ maxWidth: "70ch" }}>
            {tr("Straight into the book, no ticket involved — for an account being set up before its first invoice. A name is enough; the phone and the cars can come later.")}
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-sm text-brand-400">
              {tr("Name")}
              <input
                className="input block mt-1"
                style={{ width: 220 }}
                autoFocus
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addCustomer();
                }}
              />
            </label>
            <label className="text-sm text-brand-400">
              {tr("Phone")}
              <input
                className="input block mt-1"
                style={{ width: 160 }}
                inputMode="tel"
                value={addForm.phone}
                onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addCustomer();
                }}
              />
            </label>
            <label className="text-sm text-brand-400" style={{ flex: "1 1 220px" }}>
              {tr("Who they are")}
              <input
                className="input block mt-1 w-full"
                placeholder={tr("optional — “Fleet: Gomez Landscaping”")}
                value={addForm.notes}
                onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addCustomer();
                }}
              />
            </label>
            {/* The whole point of adding a driver from here: say who they
                work for in the same breath. Their charges go on that company's
                tab from the first ticket, so nobody has to remember to link
                them afterwards. */}
            <label className="text-sm text-brand-400">
              {tr("Billed to")}
              <select
                className="input block mt-1"
                style={{ width: 200 }}
                value={addForm.fleetId}
                onChange={(e) => setAddForm((f) => ({ ...f, fleetId: e.target.value }))}
              >
                <option value="">{tr("Themselves")}</option>
                {fleets.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.creditApproved === 0 ? ` (${tr("not approved")})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !addForm.name.trim()}
              onClick={() => void addCustomer()}
            >
              {tr("Add them")}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,360px) minmax(0,1fr)" }}>
        <div className="bg-white rounded-2xl shadow-sm p-3 cu-hide-on-print">
          <input
            className="input w-full mb-2"
            placeholder={tr("Name, phone or customer number…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {/* Two narrowings, and they compose: both ticked asks for people who
              owe money AND run an account, which is the shortest and most
              useful list on the page. */}
          {/* Buttons that are on or off, not checkboxes. On a counter
              touchscreen a 14px checkbox is a miss half the time, and the tick
              itself adds nothing the pressed state does not say — these are
              filters somebody stabs at with a thumb between customers. */}
          <div className="cu-filters">
            <button
              type="button"
              className={`cu-filter${owing ? " is-on" : ""}`}
              aria-pressed={owing}
              onClick={() => setOwing((v) => !v)}
            >{tr("Owes money")}</button>
            <button
              type="button"
              className={`cu-filter${credit ? " is-on" : ""}`}
              aria-pressed={credit}
              onClick={() => setCredit((v) => !v)}
            >{tr("Credit account")}</button>
            {can("manageCreditAccounts") && (
              <button
                type="button"
                className={`cu-filter is-warn${notApproved ? " is-on" : ""}`}
                aria-pressed={notApproved}
                onClick={() => setNotApproved((v) => !v)}
              >{tr("Not approved")}</button>
            )}
            <button
              type="button"
              className={`cu-filter${companies ? " is-on" : ""}`}
              aria-pressed={companies}
              onClick={() => setCompanies((v) => !v)}
            >{tr("Companies")}</button>
          </div>
          {tally && (
            <div className="cu-tally">
              <b>
                {companies
                  ? `${tally.companies} ${tally.companies === 1 ? tr("company") : tr("companies")}`
                  : `${tally.people} ${tally.people === 1 ? tr("person") : tr("people")}`}
              </b>
              {tally.tickets > 0 && (
                <span>{formatCents(tally.tickets)} {tr("owed on tickets")}</span>
              )}
              {tally.account > 0 && (
                <span>{formatCents(tally.account)} {tr("owing to account")}</span>
              )}
              {tally.tickets === 0 && tally.account === 0 && <span>{tr("nothing owed")}</span>}
            </div>
          )}
          <div className="overflow-y-auto" style={{ maxHeight: 620 }}>
            {rows === null ? (
              <div className="text-brand-300 p-2">{tr("Loading…")}</div>
            ) : rows.length === 0 ? (
              <div className="text-brand-300 p-2">
                {owing || credit || notApproved || companies
                  ? "Nobody matches those."
                  : "Nobody by that name."}
              </div>
            ) : (
              displayRows.map((c) => {
                /*
                  BOTH debts, always.

                  These used to switch on which filter was ticked, which meant
                  the list answered a different question depending on how it was
                  reached — and a customer owing on tickets AND running a tab
                  showed only half their debt whichever way you looked. They are
                  different money: the ticket balance is work not yet paid for,
                  the account is the standing tab. Both lines, whenever either
                  is non-zero.
                */
                const moneyLines: { amount: string; label: string; bad: boolean }[] = [];
                if (c.owedCents > 0)
                  moneyLines.push({
                    amount: formatCents(c.owedCents),
                    label: "owed on tickets",
                    bad: true,
                  });
                if (c.accountBalanceCents !== 0)
                  moneyLines.push({
                    amount: formatCents(Math.abs(c.accountBalanceCents)),
                    label: c.accountBalanceCents > 0 ? "owing to account" : "in credit",
                    bad: c.accountBalanceCents > 0,
                  });

                /* One separator, applied between the parts that exist, rather
                   than each part carrying its own leading dot — which is what
                   made the line read as a mush with uneven gaps. */
                const meta: React.ReactNode[] = [];
                if (c.phone) meta.push(<span className="cu-phone" key="p">{c.phone}</span>);
                meta.push(
                  <span key="t">
                    {c.tickets} {c.tickets === 1 ? "ticket" : "tickets"}
                  </span>,
                );
                if (c.creditTickets > 0) meta.push(<span key="a">{tr("account")}</span>);
                if (c.isFleet === 1)
                  meta.push(
                    <span className="cu-fleet-tag" key="f">
                      {tr("company")} · {c.fleetMembers}
                    </span>,
                  );
                if (c.fleetName) meta.push(<span key="fn">{c.fleetName}</span>);
                if (c.lastVisit) meta.push(<span key="l">{tr("last")} {c.lastVisit}</span>);

                return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPicked(c.id)}
                  className={`cu-pick${picked === c.id ? " is-picked" : ""}${
                    companies && c.isFleet !== 1 ? " cu-pick-member" : ""
                  }${companies && c.isFleet === 1 ? " cu-pick-fleet" : ""}`}
                >
                  {/*
                    A fixed slot for the markers, so every name starts at the
                    same place. They used to sit inline, which pushed the name
                    of anybody with approved credit a few pixels right of the
                    name above it — down a column of forty that reads as a
                    wobble rather than as a badge.
                  */}
                  <span className="cu-marks">
                    {c.creditApproved && (
                      <span className="cu-star" title="Store credit approved">★</span>
                    )}
                    {c.hasNote && (
                      <span className="cu-note-dot" title="Has a note" aria-hidden="true" />
                    )}
                  </span>

                  <span className="cu-who">
                    <span className="cu-name">{c.name}</span>
                    <span className="cu-meta">
                      {meta.map((m, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <span className="cu-sep" aria-hidden="true">·</span>}
                          {m}
                        </React.Fragment>
                      ))}
                    </span>
                  </span>

                  {/* Right-aligned and tabular, so a column of amounts stacks
                      and can be compared at a glance. Inline after a
                      variable-length name they landed at a different place on
                      every row and could only be read one at a time. */}
                  {moneyLines.length > 0 && (
                    <span className="cu-money">
                      {moneyLines.map((m) => (
                        <span key={m.label} className={`cu-money-line${m.bad ? "" : " is-good"}`}>
                          <span className="cu-amount">{m.amount}</span>
                          <span className="cu-money-label">{tr(m.label)}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </button>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 cu-detail">
          {!detail ? (
            <div className="text-brand-300 py-12 text-center">Pick somebody on the left.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold text-brand-500">
                    {detail.customer.creditApproved && <span className="cu-star">★</span>}
                    {detail.customer.name}
                  </h2>
                  <div className="text-sm text-brand-400">
                    {detail.customer.phone ?? "no phone"} · {detail.customer.customerNo}
                  </div>
                  {/* The decision, on the screen where it is made. A manager
                      ticks it once and every register that meets this customer
                      afterwards says so — which is the point: it stops being
                      decided at the counter by whoever is standing there. */}
                  {can("manageCustomers") ? (
                    <label className="flex items-center gap-1.5 mt-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={detail.customer.creditApproved}
                        disabled={busy}
                        onChange={(e) =>
                          void patchCustomer({ creditApproved: e.target.checked })
                        }
                      />
                      <span className={detail.customer.creditApproved ? "cu-approved-on" : "text-brand-400"}>
                        Store credit approved
                      </span>
                    </label>
                  ) : (
                    detail.customer.creditApproved && (
                      <div className="cu-approved mt-2">★ Store credit approved</div>
                    )
                  )}

                  {/* ── Fleet ────────────────────────────────────────────
                      Two different rows depending on which side of the
                      relationship this customer is on. A driver gets "billed
                      to <company>" and a way to change it; a company gets its
                      driver count and the door to its statement. */}
                  {can("manageCustomers") && !detail.customer.isFleet && (
                    <label className="flex items-center gap-1.5 mt-2 text-sm">
                      <span className="text-brand-400">{tr("Billed to")}</span>
                      <select
                        className="input"
                        style={{ height: 28, fontSize: 13, maxWidth: 220 }}
                        value={detail.customer.fleetId ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          void send("/api/pos/fleets", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              customerId: detail.customer.id,
                              fleetId: e.target.value ? Number(e.target.value) : null,
                            }),
                          })
                        }
                      >
                        <option value="">{tr("Themselves")}</option>
                        {fleets.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!can("manageCustomers") && detail.fleet && (
                    <div className="mt-2 text-sm text-brand-400">
                      {tr("Billed to")} <strong>{detail.fleet.name}</strong>
                    </div>
                  )}

                  {/* Making somebody a company is a credit decision, so it
                      follows the account permission rather than the one for
                      correcting a phone number. */}
                  {can("manageCreditAccounts") && !detail.customer.fleetId && (
                    <label className="flex items-center gap-1.5 mt-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={detail.customer.isFleet}
                        disabled={busy}
                        onChange={(e) =>
                          void send("/api/pos/fleets", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              customerId: detail.customer.id,
                              isFleet: e.target.checked,
                            }),
                          })
                        }
                      />
                      <span className="text-brand-400">
                        {tr("This is a company others can be billed to")}
                      </span>
                    </label>
                  )}

                  {detail.customer.isFleet && (
                    <div className="mt-2 flex items-center gap-3 text-sm flex-wrap">
                      <span className="cu-fleet">
                        {tr("Company account")} · {detail.members.length}{" "}
                        {detail.members.length === 1 ? tr("driver") : tr("drivers")}
                      </span>
                      {can("manageCreditAccounts") && (
                        <Link href={`/pos/fleets/${detail.customer.id}`} className="underline text-brand-400">
                          {tr("Statement")} →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {can("manageCustomers") && !editing && (
                    <button
                      type="button"
                      className="text-brand-400 hover:text-brand-500 underline"
                      onClick={() => setEditing(true)}
                    >{tr("Edit")}</button>
                  )}
                  {can("deleteCustomer") && (
                    <button
                      type="button"
                      className="text-red-600 hover:text-red-800 underline"
                      onClick={() => setRemovingCustomer(true)}
                    >{tr("Remove")}</button>
                  )}
                </div>
              </div>

              {editing && (
                <div className="mt-3 rounded-xl border border-black/10 p-3">
                  <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <label className="text-sm">
                      <span className="block text-brand-400 mb-1">{tr("Name")}</span>
                      <input
                        className="input w-full"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="block text-brand-400 mb-1">Phone</span>
                      <input
                        className="input w-full"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="text-sm block mt-2">
                    <span className="block text-brand-400 mb-1">
                      About them — who they are, how they pay
                    </span>
                    <input
                      className="input w-full"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </label>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !form.name.trim()}
                      onClick={async () => {
                        if (await patchCustomer(form)) setEditing(false);
                      }}
                    >{tr("Save")}</button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        setEditing(false);
                        setForm({
                          name: detail.customer.name,
                          phone: detail.customer.phone ?? "",
                          notes: detail.customer.notes ?? "",
                        });
                      }}
                    >{tr("Cancel")}</button>
                  </div>
                </div>
              )}

              {!editing && detail.customer.notes && (
                <p className="mt-2 text-sm text-brand-400 italic">{detail.customer.notes}</p>
              )}

              {/*
                The note the counter leaves for the counter, written by anybody.

                Deliberately the same object as the notice board on Main, down to
                the pin and the wording of its buttons: they are the same kind of
                message about different subjects, and somebody who has learned
                one should not have to learn the other. Above the cars and the
                history because it is the only thing on this panel addressed to
                whoever opened it, rather than describing what already happened.
              */}
              <CustomerNote
                note={detail.customer.pinnedNote}
                by={detail.customer.pinnedNoteBy}
                at={detail.customer.pinnedNoteAt}
                busy={busy}
                draft={note}
                setDraft={setNote}
                onSave={(text) => patchCustomer({ pinnedNote: text || null })}
              />

              {/* ── The company's billing details ───────────────────────
                  Only on a company, and only for whoever keeps the accounts.
                  A tab that gets invoiced needs somewhere to send the invoice
                  and somebody to send it to — and the person who pays is
                  rarely the person who hands over the keys, which is why the
                  contact is separate from the drivers below. */}
              {detail.customer.isFleet && can("manageCreditAccounts") && (
                <div className="mt-4">
                  <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
                    {tr("Billing details")}
                  </div>
                  <p className="text-sm text-brand-400 mb-2">
                    {tr("Where the statement goes, and who settles it. Printed on the company's statement.")}
                  </p>
                  <div className="grid gap-2">
                    <textarea
                      className="input w-full"
                      rows={2}
                      placeholder={tr("Street address")}
                      value={company.address}
                      onChange={(e) => {
                        setCompany((c) => ({ ...c, address: e.target.value }));
                        setCompanyDirty(true);
                      }}
                    />
                    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
                      {/* The company's own number is the customer's phone —
                          the one at the top of this panel. Not repeated here,
                          because two boxes for one number is two answers the
                          first time somebody changes only one of them. */}
                      <input
                        className="input"
                        placeholder={tr("Company email")}
                        inputMode="email"
                        value={company.email}
                        onChange={(e) => {
                          setCompany((c) => ({ ...c, email: e.target.value }));
                          setCompanyDirty(true);
                        }}
                      />
                      <input
                        className="input"
                        placeholder={tr("Who to bill — name")}
                        value={company.billingName}
                        onChange={(e) => {
                          setCompany((c) => ({ ...c, billingName: e.target.value }));
                          setCompanyDirty(true);
                        }}
                      />
                    </div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
                      <input
                        className="input"
                        placeholder={tr("Their phone")}
                        inputMode="tel"
                        value={company.billingPhone}
                        onChange={(e) => {
                          setCompany((c) => ({ ...c, billingPhone: e.target.value }));
                          setCompanyDirty(true);
                        }}
                      />
                      <input
                        className="input"
                        placeholder={tr("Their email")}
                        inputMode="email"
                        value={company.billingEmail}
                        onChange={(e) => {
                          setCompany((c) => ({ ...c, billingEmail: e.target.value }));
                          setCompanyDirty(true);
                        }}
                      />
                    </div>
                    {companyDirty && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ height: 32, fontSize: 13 }}
                          disabled={busy}
                          onClick={async () => {
                            const ok = await patchCustomer({
                              address: company.address.trim() || null,
                              email: company.email.trim() || null,
                              billingName: company.billingName.trim() || null,
                              billingPhone: company.billingPhone.trim() || null,
                              billingEmail: company.billingEmail.trim() || null,
                            });
                            if (ok) setCompanyDirty(false);
                          }}
                        >
                          {tr("Save billing details")}
                        </button>
                        <button
                          type="button"
                          className="text-sm text-brand-400 underline"
                          onClick={() => {
                            setCompany({
                              address: detail.customer.address ?? "",
                              email: detail.customer.email ?? "",
                              billingName: detail.customer.billingName ?? "",
                              billingPhone: detail.customer.billingPhone ?? "",
                              billingEmail: detail.customer.billingEmail ?? "",
                            });
                            setCompanyDirty(false);
                          }}
                        >
                          {tr("Cancel")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Drivers on this company's account ───────────────────
                  Only on a fleet, and it answers the question the panel is
                  usually opened with: who is allowed to put tires on this tab.
                  Each row carries what that driver has run up all time,
                  because "which of my drivers is spending" is the second
                  question every single time. */}
              {detail.customer.isFleet && detail.members.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
                    {tr("Drivers on this account")}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {detail.members.map((m) => (
                        <tr key={m.id} className="border-t border-black/5">
                          <td className="py-1.5">
                            <button
                              type="button"
                              className="underline text-brand-500"
                              onClick={() => setPicked(m.id)}
                            >
                              {m.name}
                            </button>
                            {m.phone && (
                              <span className="text-brand-300 text-xs"> · {m.phone}</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-brand-400 whitespace-nowrap">
                            {m.vehicles} {m.vehicles === 1 ? tr("vehicle") : tr("vehicles")}
                          </td>
                          <td className="py-1.5 pl-4 text-right tabular-nums whitespace-nowrap">
                            {formatCents(m.chargedCents)}
                          </td>
                          <td className="py-1.5 pl-4 text-right tabular-nums text-brand-300 whitespace-nowrap">
                            {m.lastVisit ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-4">
                <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">Cars</div>
                {detail.vehicles.length === 0 ? (
                  <div className="text-sm text-brand-300">No car on file.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {detail.vehicles.map((v) =>
                      editCar?.id === v.id ? (
                        <CarForm
                          key={v.id}
                          car={editCar}
                          busy={busy}
                          onChange={setEditCar}
                          onCancel={() => setEditCar(null)}
                          onSave={async () => {
                            const ok = await send(`/api/pos/vehicles/${v.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(editCar),
                            });
                            if (ok) setEditCar(null);
                          }}
                        />
                      ) : (
                        <div
                          key={v.id}
                          className="flex items-center justify-between gap-2 text-sm rounded-lg px-2 py-1"
                          style={{ background: "rgba(10,37,64,0.05)" }}
                        >
                          <span className="truncate">
                            {carLine(v)}
                            {v.plate && <span className="text-brand-300"> · {v.plate}</span>}
                            {v.tireSize && <span className="text-brand-300"> · {v.tireSize}</span>}
                          </span>
                          {can("manageCustomers") && (
                            <span className="flex gap-3 whitespace-nowrap">
                              <button
                                type="button"
                                className="text-xs text-brand-400 hover:text-brand-500 underline"
                                onClick={() => setEditCar(v)}
                              >{tr("Edit")}</button>
                              <button
                                type="button"
                                className="text-xs text-red-600 hover:text-red-800 underline"
                                onClick={() => setRemovingCar(v)}
                              >{tr("Remove")}</button>
                            </span>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4">
                <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
                  {detail.creditOnly
                    ? "What they have put on the account"
                    : "Everything they have had done"}
                </div>
                {detail.tickets.length === 0 ? (
                  <div className="text-brand-300 py-4">
                    {detail.creditOnly ? "Nothing on the account." : "No tickets yet."}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {detail.tickets.map((t) => (
                        <tr
                          key={t.saleId}
                          className="border-t border-black/5 align-top cu-row"
                        >
                          <td className="py-2 whitespace-nowrap">
                            <Link
                              href={`/pos/sale/${t.saleId}/receipt`}
                              className="hover:underline text-brand-500"
                              style={
                                t.status === "voided"
                                  ? { textDecoration: "line-through", opacity: 0.55 }
                                  : undefined
                              }
                            >
                              {t.saleNo}
                            </Link>
                            <div className="text-xs text-brand-300 tabular-nums">
                              {t.businessDate}
                            </div>
                          </td>
                          {/* Indented off the ticket number beside it, or the
                              two run together — "S-2026-000183VANTAGE". */}
                          <td className="py-2 pl-4 text-brand-400">
                            {t.what ?? "—"}
                            {t.vehicle && (
                              <div className="text-xs text-brand-300">{t.vehicle}</div>
                            )}
                          </td>
                          <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">
                            {formatCents(t.totalCents)}
                            {t.balanceCents > 0 && (
                              <div className="text-xs font-semibold text-red-700">
                                owes {formatCents(t.balanceCents)}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {can("manageCreditAccounts") && (
                <AccountPanel
                  customerId={detail.customer.id}
                  name={detail.customer.name}
                  reload={accountReload}
                  onError={setError}
                />
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        open={removingCar !== null}
        onCancel={() => setRemovingCar(null)}
        onConfirm={async () => {
          if (!removingCar) return;
          const ok = await send(
            `/api/pos/vehicles/${removingCar.id}?reason=${encodeURIComponent("Removed from the customer book")}`,
            { method: "DELETE" },
          );
          if (ok) setRemovingCar(null);
        }}
        busy={busy}
        title="Remove this car?"
        confirmLabel="Yes, remove it"
        cancelLabel="Keep it"
        danger
      >
        <p>
          <strong className="text-brand-500">{removingCar && carLine(removingCar)}</strong> stops
          appearing under this customer.
        </p>
        <p className="mt-2">
          Every ticket that named it still names it. This only takes it off the
          list of cars you can pick from.
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={removingCustomer}
        onCancel={() => setRemovingCustomer(false)}
        onConfirm={async () => {
          const ok = await send(
            `/api/pos/customers/${picked}?reason=${encodeURIComponent("Removed from the customer book")}`,
            { method: "DELETE" },
          );
          if (ok) {
            setRemovingCustomer(false);
            setPicked(null);
          }
        }}
        busy={busy}
        title="Remove this customer?"
        confirmLabel="Yes, remove them"
        cancelLabel="Keep them"
        acknowledge="I know their cars go with them"
        danger
      >
        <p>
          <strong className="text-brand-500">{detail?.customer.name}</strong> and their{" "}
          {detail?.vehicles.length ?? 0}{" "}
          {(detail?.vehicles.length ?? 0) === 1 ? "car" : "cars"} stop appearing anywhere
          they can be looked up.
        </p>
        <p className="mt-2">
          Their tickets are untouched and still carry the name. Nothing about what
          the shop did for them changes.
        </p>
        {(detail?.tickets.some((t) => t.balanceCents > 0) ?? false) && (
          <p className="mt-2 text-red-700">
            <strong>They still owe money on at least one ticket.</strong> Removing
            them here does not clear the debt, it only makes it harder to find.
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}

type AccountData = {
  account: {
    chargedCents: number;
    paidCents: number;
    balanceCents: number;
    chargeCount: number;
    creditApproved: number;
  } | null;
  charges: {
    paymentId: number;
    saleId: number;
    saleNo: string;
    businessDate: string;
    amountCents: number;
    isReversal: number;
    reversedById: number | null;
    saleVoided: number;
    what: string | null;
    reviewedByName: string | null;
    reviewedAt: string | null;
  }[];
  payments: {
    id: number;
    amountCents: number;
    paidAt: string;
    how: string | null;
    toAccount: string | null;
    note: string | null;
    reversesId: number | null;
    reversedById: number | null;
    byName: string;
  }[];
};

/**
 * The house account: what has gone onto the tab and what has come in against it.
 *
 * Its own panel below the ticket history rather than mixed into it, because
 * they answer different questions to different people. The history is "what did
 * we do for them"; this is "what do they owe us", and only the owner and the
 * accountant see it at all.
 *
 * Payments here are against the TOTAL, never against a ticket. Somebody hands
 * over $400 across nine open charges and nobody decides which nine-ninths of
 * which job that settles — forcing an allocation would invent a fact the shop
 * does not have.
 */
function AccountPanel({
  customerId,
  name,
  reload,
  onError,
}: {
  customerId: number;
  name: string;
  reload: number;
  onError: (m: string | null) => void;
}) {
  const { t: tr } = useLang();
  // Stamped after mount: the print date depends on the browser clock, and
  // rendering it during the server pass would mismatch on hydration.
  const [printedOn, setPrintedOn] = useState("");
  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);
  const [data, setData] = useState<AccountData | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // Opened on request, and forced open for a print so the statement is whole.
  const [showPayments, setShowPayments] = useState(false);
  // Charges that netted themselves out. Off by default, and off on paper
  // whatever this says — see the button beside the tab heading.
  const [showCancelled, setShowCancelled] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [how, setHow] = useState("");
  const [toAccount, setToAccount] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/pos/customers/${customerId}/account`);
    if (!res.ok) return;
    setData(await res.json());
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  // Today, in the browser's own calendar. Set after mount because the server
  // has no idea what day it is where the accountant is sitting.
  useEffect(() => {
    setPaidAt(new Date().toISOString().slice(0, 10));
  }, [customerId]);

  async function save() {
    const cents = parseCents(amount);
    if (cents === null || cents <= 0) {
      onError("Enter how much came in");
      return;
    }
    setBusy(true);
    onError(null);
    const res = await fetch(`/api/pos/customers/${customerId}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountCents: cents, paidAt, how, toAccount }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onError(d.error || "Could not record that");
      return;
    }
    setAmount("");
    setHow("");
    setToAccount("");
    setOpen(false);
    await load();
  }

  async function review(paymentId: number) {
    setBusy(true);
    onError(null);
    const res = await fetch(`/api/pos/customers/${customerId}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewChargeId: paymentId, note: "This transaction was audited" }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onError(d.error || "Could not sign that off");
      return;
    }
    await load();
  }

  /** Take a sign-off back off — the tick is one row away from the wrong charge. */
  async function unreview(paymentId: number) {
    setBusy(true);
    onError(null);
    const res = await fetch(`/api/pos/customers/${customerId}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unreviewChargeId: paymentId }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onError(d.error || "Could not undo that");
      return;
    }
    await load();
  }

  async function undo(id: number) {
    setBusy(true);
    onError(null);
    const res = await fetch(`/api/pos/customers/${customerId}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reverseId: id, reason: "Entered by mistake" }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onError(d.error || "Could not undo that");
      return;
    }
    await load();
  }

  // Nothing has ever gone onto this customer's tab. Drawing an empty account
  // for every walk-in would make the one panel that matters invisible.
  if (!data?.account) return null;
  const a = data.account;

  /**
   * A charge that is not on the tab: it IS a reversal, one points at it, or the
   * ticket it came from was voided.
   *
   * All three tested, not just the reversal. Fading only the row that undid it
   * left the original reading as a live charge — which is exactly how a card
   * sale that had been corrected off the account still looked like money owed.
   */
  const cancelled = (c: (typeof data.charges)[number]) =>
    c.isReversal === 1 || c.reversedById !== null || c.saleVoided === 1;
  const cancelledCount = data.charges.filter(cancelled).length;
  const shownCharges = showCancelled
    ? data.charges
    : data.charges.filter((c) => !cancelled(c));

  return (
    <div className="cu-account mt-5">
      {/* The letterhead, on paper only. A statement handed to a customer or
          filed with the month's paperwork has to say whose shop it came from
          and whose account it is — the screen has all of that in the panes
          around it, and the sheet has nothing. */}
      <div className="cu-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>
            Casias Muffler and Tire Shop
          </div>
          <div style={{ fontSize: "9pt" }}>
            Account statement · {name} · {printedOn}
          </div>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-xs uppercase tracking-wider text-brand-300">{tr("House account")}</div>
        <div className="flex items-baseline gap-3">
          <div className="text-sm text-brand-400">
            {formatCents(a.chargedCents)} charged · {formatCents(a.paidCents)} paid
          </div>
          <button
            type="button"
            className="text-sm text-brand-400 hover:text-brand-500 underline no-print"
            onClick={() => window.print()}
          >{tr("Print statement")}</button>
        </div>
      </div>

      <div className="flex items-baseline gap-3 mt-1 flex-wrap">
        <div
          className={`text-2xl font-semibold tabular-nums ${
            a.balanceCents > 0 ? "text-red-700" : "text-green-700"
          }`}
        >
          {a.balanceCents > 0
            ? `${formatCents(a.balanceCents)} owing`
            : a.balanceCents < 0
              ? `${formatCents(-a.balanceCents)} in credit`
              : "Settled"}
        </div>
        {/* The one thing that makes an account a problem rather than a
            relationship: money on a tab nobody agreed to. */}
        {a.creditApproved === 0 && (
          <span className="cu-unapproved">not approved for credit</span>
        )}
      </div>

      {!open ? (
        <div className="flex items-center gap-2 mt-3 no-print">
          <button
            type="button"
            className="btn btn-primary"
            style={{ height: 36, fontSize: 14 }}
            onClick={() => setOpen(true)}
          >{tr("Record a payment")}</button>
          {/* The money-in list, behind a press. It is the shortest part of this
              panel on most accounts and the longest on the few that matter, and
              it is not what the screen is opened for — the balance is. It prints
              regardless: a statement without the payments on it is half a
              statement. */}
          <button
            type="button"
            className={showPayments ? "btn btn-primary" : "btn btn-outline"}
            style={{ height: 36, fontSize: 14 }}
            aria-pressed={showPayments}
            onClick={() => setShowPayments((v) => !v)}
          >
            {showPayments ? "Hide payments" : "Show payments"}
            {data.payments.length > 0 && (
              <span className="text-xs font-normal"> · {data.payments.length}</span>
            )}
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-black/10 p-3">
          <div className="grid gap-2" style={{ gridTemplateColumns: "120px 150px 1fr 1fr" }}>
            <label className="text-sm">
              <span className="block text-brand-400 mb-1 text-xs">{tr("How much")}</span>
              <input
                className="input w-full text-right tabular-nums"
                inputMode="decimal"
                placeholder="0.00"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            {/* When the money arrived, not when it was typed. A cheque dated the
                3rd that reaches the desk on the 11th is the 3rd's money. */}
            <label className="text-sm">
              <span className="block text-brand-400 mb-1 text-xs">When it was paid</span>
              <input
                className="input w-full"
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="block text-brand-400 mb-1 text-xs">How</span>
              <input
                className="input w-full"
                placeholder="Cheque 4471 · cash in person · card over the phone"
                value={how}
                onChange={(e) => setHow(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="block text-brand-400 mb-1 text-xs">To what account</span>
              <input
                className="input w-full"
                placeholder="Frost checking · register"
                value={toAccount}
                onChange={(e) => setToAccount(e.target.value)}
              />
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Working…" : "Record it"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{tr("Cancel")}</button>
          </div>
        </div>
      )}

      {data.payments.length > 0 && (
        <div className={showPayments ? "mt-4" : "mt-4 cu-print-only"}>
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">{tr("Money in")}</div>
          <table className="w-full text-sm">
            <tbody>
              {data.payments.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-black/5 cu-row"
                  style={p.reversedById || p.reversesId ? { opacity: 0.55 } : undefined}
                >
                  <td className="py-1.5 whitespace-nowrap tabular-nums">
                    {p.paidAt.slice(0, 10)}
                  </td>
                  <td className="py-1.5 pl-4 text-brand-400">
                    {[p.how, p.toAccount].filter(Boolean).join(" · ") || "—"}
                    <div className="text-xs text-brand-300">
                      {p.byName}
                      {p.note ? ` · ${p.note}` : ""}
                    </div>
                  </td>
                  <td className="py-1.5 pl-4 text-right tabular-nums whitespace-nowrap">
                    {formatCents(p.amountCents)}
                  </td>
                  <td className="py-1.5 pl-3 text-right" style={{ width: 60 }}>
                    {!p.reversedById && !p.reversesId && (
                      <button
                        type="button"
                        className="text-xs text-brand-300 underline"
                        disabled={busy}
                        onClick={() => void undo(p.id)}
                      >{tr("Void")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <div className="text-xs uppercase tracking-wider text-brand-300">{tr("What went on the tab")}</div>
          {/* Charges that came straight back off — a voided ticket, or the
              commonest one by far, a sale rung to the account and then fixed to
              the card the customer actually paid with.

              HIDDEN BY DEFAULT, and never printed. On the tab they are a pair
              that nets to nothing, so a customer handed a statement with a $210
              charge and a −$210 beside it has been given arithmetic to do
              before they can read what they owe. On screen they are worth
              keeping reachable, because "why did that come off" gets asked out
              loud and the answer is these two rows. */}
          {cancelledCount > 0 && (
            <button
              type="button"
              className="text-xs text-brand-300 hover:text-brand-500 underline no-print"
              aria-pressed={showCancelled}
              onClick={() => setShowCancelled((v) => !v)}
            >
              {showCancelled ? "hide" : "show"} {cancelledCount} cancelled
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <tbody>
            {shownCharges.map((c) => (
              <tr
                key={c.paymentId}
                /* `cu-cancelled` drops the row from the printed statement even
                   when it is showing on screen. The toggle above is about what
                   somebody standing at the desk can see; the sheet handed to a
                   customer states what is on the tab, and a charge that came
                   straight back off never was. */
                className={`border-t border-black/5 cu-row align-top${
                  cancelled(c) ? " cu-cancelled" : ""
                }`}
                style={cancelled(c) ? { opacity: 0.5 } : undefined}
              >
                <td className="py-1.5 whitespace-nowrap">
                  <Link
                    href={`/pos/sale/${c.saleId}/receipt`}
                    className="hover:underline text-brand-500"
                  >
                    {c.saleNo}
                  </Link>
                  <div className="text-xs text-brand-300 tabular-nums">{c.businessDate}</div>
                </td>
                <td className="py-1.5 pl-4 text-brand-400">
                  {c.what ?? "—"}
                  {/* A charge taken back off the tab. It stays on the list
                      because "why did that come off" is asked out loud. */}
                  {c.isReversal === 1 && (
                    <div className="text-xs text-brand-300">taken back off the account</div>
                  )}
                  {/* Says so on the charge itself, not only on the row that
                      undid it. Usually a tender correction: rung to the account,
                      then fixed to whatever the customer actually paid with. */}
                  {c.reversedById !== null && c.isReversal === 0 && (
                    <div className="text-xs text-brand-300">
                      no longer on the account — settled another way
                    </div>
                  )}
                  {c.reviewedByName && (
                    <div className="text-xs text-green-700">
                      audited · {c.reviewedByName}
                      {c.reviewedAt ? ` · ${c.reviewedAt.slice(0, 10)}` : ""}
                      {/* Beside the sign-off rather than in the column at the
                          end, because that column is empty on an audited row —
                          the tick is what emptied it. Sitting against the words
                          it undoes, it reads as part of the same fact.

                          On paper the green line stays and the word goes: a
                          statement is a record of what was decided, not a
                          screen to press. */}
                      <button
                        type="button"
                        className="ml-2 underline text-brand-300 hover:text-brand-500 no-print"
                        disabled={busy}
                        onClick={() => void unreview(c.paymentId)}
                      >
                        undo
                      </button>
                    </div>
                  )}
                </td>
                <td className="py-1.5 pl-4 text-right tabular-nums whitespace-nowrap">
                  {formatCents(c.amountCents)}
                </td>
                {/* Only offered on the charges that are actually flagged: a real
                    charge, on a customer nobody approved, that nobody has looked
                    at yet. Signing it off does not approve the customer — it
                    records that this one transaction was checked, which is the
                    answer most of the time. */}
                <td className="py-1.5 pl-3 text-right no-print" style={{ width: 90 }}>
                  {a.creditApproved === 0 &&
                    c.isReversal === 0 &&
                    !c.reviewedByName && (
                      <button
                        type="button"
                        className="text-xs text-brand-400 hover:text-brand-500 underline"
                        disabled={busy}
                        onClick={() => void review(c.paymentId)}
                      >
                        Mark audited
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "Aug 2, 3:40 PM" — enough to judge whether a note has gone stale. */
function whenWritten(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The customer's pinned note, built to be the notice board on Main.
 *
 * Nothing is drawn when there is no note but the invitation to leave one — a
 * permanently visible empty box is furniture, and furniture is invisible. The
 * whole value of the strip is that a glance tells you whether there is
 * something to know about this person.
 */
function CustomerNote({
  note,
  by,
  at,
  busy,
  draft,
  setDraft,
  onSave,
}: {
  note: string | null;
  by: string | null;
  at: string | null;
  busy: boolean;
  draft: string;
  setDraft: (v: string) => void;
  onSave: (text: string) => Promise<boolean>;
}) {
  const { t: tr } = useLang();
  const [editing, setEditing] = useState(false);

  // Closed whenever the panel moves to another customer, or the box would open
  // on the next person still holding the last one's words.
  useEffect(() => {
    setEditing(false);
  }, [note, by, at]);

  if (editing) {
    return (
      <div className="cu-note mt-3">
        <label className="block text-xs uppercase tracking-wider text-amber-800 mb-2 font-medium">
          Note about this customer
        </label>
        <textarea
          className="input w-full"
          rows={3}
          maxLength={500}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Coming Friday for the balance. Do not release the truck to the son."
        />
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              if (await onSave(draft)) setEditing(false);
            }}
          >
            {busy ? "Saving…" : "Save note"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setDraft(note ?? "");
              setEditing(false);
            }}
          >{tr("Cancel")}</button>
          {/* Its own button rather than "save an empty box", so taking the note
              down is a decision somebody makes instead of something that
              happens by backspacing. */}
          {note && (
            <button
              type="button"
              className="btn btn-ghost ml-auto text-red-700"
              disabled={busy}
              onClick={async () => {
                setDraft("");
                if (await onSave("")) setEditing(false);
              }}
            >{tr("Take it down")}</button>
          )}
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="mt-3">
        <button
          type="button"
          className="text-sm text-brand-300 hover:text-brand-500 hover:underline"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          + Leave a note about this customer
        </button>
      </div>
    );
  }

  return (
    <div className="cu-note mt-3 flex items-start gap-3">
      <span aria-hidden style={{ fontSize: 18, lineHeight: "24px" }}>
        📌
      </span>
      <div className="flex-1 min-w-0">
        {/* Newlines the writer typed are newlines on the panel. */}
        <div className="text-amber-900 whitespace-pre-wrap">{note}</div>
        {by && (
          <div className="text-xs text-amber-700/80 mt-1">
            {by}
            {at ? ` · ${whenWritten(at)}` : ""}
          </div>
        )}
      </div>
      <button
        type="button"
        className="text-sm text-amber-800 hover:underline shrink-0"
        onClick={() => {
          setDraft(note);
          setEditing(true);
        }}
      >{tr("Edit")}</button>
    </div>
  );
}

/** The car, opened for correction. Its own component only to keep the panel readable. */
function CarForm({
  car,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  car: Vehicle;
  busy: boolean;
  onChange: (v: Vehicle) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t: tr } = useLang();
  const field = (
    key: keyof Vehicle,
    label: string,
    placeholder?: string,
  ) => (
    <label className="text-sm">
      <span className="block text-brand-400 mb-1 text-xs">{label}</span>
      <input
        className="input w-full"
        placeholder={placeholder}
        value={(car[key] as string | null) ?? ""}
        onChange={(e) => onChange({ ...car, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="rounded-lg border border-black/10 p-3">
      <div className="grid gap-2" style={{ gridTemplateColumns: "80px 1fr 1fr 90px" }}>
        {field("year", "Year", "2014")}
        {field("make", "Make", "Ford")}
        {field("model", "Model", "F-150")}
        {field("color", "Colour", "White")}
      </div>
      <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {field("plate", "Plate", "ABC1234")}
        {field("tireSize", "Tire size", "265-70-17")}
      </div>
      <div className="flex gap-2 mt-3">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onSave}>{tr("Save")}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>{tr("Cancel")}</button>
      </div>
    </div>
  );
}
