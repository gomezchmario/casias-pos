"use client";

// Imported explicitly, which Next does not need and the print script does: the
// PDF generator renders these same components through `react-dom/server` under
// tsx, which compiles JSX to `React.createElement` rather than the automatic
// runtime. Without this line the manuals build fine and the PDFs die.
import React from "react";
import { formatCents } from "@/lib/money";

/**
 * Pieces of the real interface, rebuilt for the manual.
 *
 * Every specimen below mirrors a control that exists somewhere in the app, and
 * each one names the file it was copied from. That comment is the only thing
 * keeping them honest: a specimen cannot drift because of a data change, but it
 * absolutely can drift if somebody restyles the real control and never looks
 * here. When a control changes, change its twin.
 *
 * They are deliberately NOT the real components. Importing `PaymentPanel` into
 * the manual would drag in the register's auth context, its fetches and its
 * state machine, and a help page that breaks because a sale endpoint changed is
 * a help page nobody can rely on being there. These are inert.
 */

/** The frame a specimen sits in — a pale slab so it reads as "this is a picture
 *  of the screen" rather than as a control on the page you are reading. */
function Slab({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="manual-specimen">
      <div className="manual-specimen-inner" style={wide ? undefined : { maxWidth: 380 }}>
        {children}
      </div>
    </div>
  );
}

/* ── register: the price grid ────────────────────────────────────────────────
   Mirrors the "Price" card in src/app/pos/(shell)/register/page.tsx */
function QuickAmounts() {
  return (
    <Slab>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">Price</div>
        <div className="keypad">
          {["$5", "$10", "$15", "$20", "$25", "$30"].map((l) => (
            <div
              key={l}
              className="btn"
              style={{ background: "#0a2540", color: "#fff", height: 56, fontSize: 18 }}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </Slab>
  );
}

/* ── register: the service grid ─────────────────────────────────────────────
   Mirrors the "Service" card in the same file. Amber, not navy — the colour is
   the only thing telling a thumb which grid it is in. */
function QuickServices() {
  return (
    <Slab>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">Service</div>
        <div className="keypad">
          {["FLAT", "MOUNT & B", "CHECK TIRE", "ROTACION", "DISPOSAL", "AIR"].map((l) => (
            <div
              key={l}
              className="btn"
              style={{
                background: "rgba(255,200,61,0.22)",
                color: "#0a2540",
                height: 56,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </Slab>
  );
}

/* ── register: a ticket line ────────────────────────────────────────────────
   Mirrors the ticket panel rows. Shown with a technician named on one line and
   not on the other, because that difference is the point of the paragraph it
   illustrates. */
function TicketLines() {
  return (
    <Slab wide>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">Ticket</div>
        <div className="divide-y divide-black/5">
          <div className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="font-medium text-brand-500">VANTAGE 225-50-17</div>
              <div className="text-xs text-brand-300">2 × $130.00 · Kevin</div>
            </div>
            <div className="tabular-nums font-semibold text-brand-500">$260.00</div>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="font-medium text-brand-500">MOUNT &amp; B</div>
              <div className="text-xs" style={{ color: "#a71d24" }}>
                4 × $10.00 · sin técnico
              </div>
            </div>
            <div className="tabular-nums font-semibold text-brand-500">$40.00</div>
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-3 pt-3 mt-2 border-t border-black/10">
          <div className="font-semibold text-brand-500">Total</div>
          <div className="tabular-nums text-xl font-bold text-brand-500">$300.00</div>
        </div>
      </div>
    </Slab>
  );
}

/* ── register: tenders ──────────────────────────────────────────────────────
   Mirrors the method grid in src/components/pos/PaymentPanel.tsx, with one
   selected so the difference between chosen and not is visible. */
function Tenders() {
  const methods = ["Cash", "Credit Card", "SNAP", "PO Shop", "Credit Account", "Other"];
  return (
    <Slab>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="grid grid-cols-2 gap-2">
          {methods.map((m) => (
            <div
              key={m}
              className="btn text-sm"
              style={{
                height: 42,
                background: m === "Cash" ? "#0a2540" : "rgba(10,37,64,0.06)",
                color: m === "Cash" ? "#fff" : "#0a2540",
              }}
            >
              {m}
            </div>
          ))}
        </div>
      </div>
    </Slab>
  );
}

/* ── register: the three ways a ticket can end ──────────────────────────────
   Mirrors the foot of PaymentPanel. All three together on purpose: the whole
   point of the paragraph is that they are three different endings, and seeing
   them stacked is what makes the solid one read as the ordinary one. */
function CloseActions() {
  return (
    <Slab>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex justify-between text-lg font-semibold text-brand-500 mb-1">
          <span>Charge</span>
          <span className="tabular-nums">{formatCents(30000)}</span>
        </div>
        <div className="btn btn-primary w-full" style={{ marginTop: 8 }}>
          Complete sale
        </div>
        <div className="btn btn-outline w-full mt-2" style={{ height: 44, fontSize: 14 }}>
          Split payment, or take only part of it
        </div>
        <div className="btn btn-outline w-full mt-2" style={{ height: 44, fontSize: 14 }}>
          Create the ticket to pay at the cashier
        </div>
      </div>
    </Slab>
  );
}

/* ── a confirmation box ─────────────────────────────────────────────────────
   Mirrors src/components/ui/ConfirmModal.tsx. Shown with the unpaid wording,
   because that is the one dialog in the app that must never be clicked
   through — it moves stock and freezes a total. */
function ConfirmUnpaid() {
  return (
    <Slab>
      <div className="manual-modal">
        <div className="text-base font-semibold text-brand-500 mb-2">
          Create the ticket to pay at the cashier?
        </div>
        <div className="text-sm text-brand-400 leading-relaxed">
          <p className="mb-2">
            The ticket is finished at <strong>$300.00</strong> with nothing collected — the
            customer pays at the cashier later. Any tires on it come off the racks now.
          </p>
          <p>
            It sits in <strong>Pending</strong> on Main until the money is taken, and the
            total is frozen.
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <div className="btn btn-ghost" style={{ background: "rgba(10,37,64,0.06)", color: "#0a2540" }}>
            Go back
          </div>
          <div className="btn btn-primary">Create it</div>
        </div>
      </div>
    </Slab>
  );
}

/* ── Main: the two boxes ────────────────────────────────────────────────────
   Mirrors the Pending and Outstanding panels in src/app/pos/(shell)/page.tsx.
   Side by side here although they are stacked on the real screen, because the
   thing being taught is the difference between them. */
function PendingVsOutstanding() {
  return (
    <Slab wide>
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div
          className="rounded-2xl shadow-sm p-4"
          style={{ background: "#fef2f2", border: "1px solid rgba(153,27,27,0.30)" }}
        >
          <div className="text-xs uppercase tracking-wider text-red-800 mb-2">
            ⏳ Pending — 2 tickets
          </div>
          <div className="text-sm text-red-900/80">
            S-2026-000145 · Marisol Cantú
            <div className="tabular-nums font-semibold">$53.00</div>
          </div>
        </div>
        <div
          className="rounded-2xl shadow-sm p-4"
          style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.30)" }}
        >
          <div className="text-xs uppercase tracking-wider text-amber-800 mb-2">
            ⚠️ Outstanding — 1 ticket
          </div>
          <div className="text-sm text-amber-900/80">
            S-2026-000144 · Aurelio Peña
            <div className="tabular-nums font-semibold">Ordered</div>
          </div>
        </div>
      </div>
    </Slab>
  );
}

/* ── close-out: the four figures ────────────────────────────────────────────
   Mirrors the "What the register says" stats in the Close-out page. This is
   the specimen the Sold-versus-Collected section is built around, so both
   figures carry their real sub-labels. */
function DayStats() {
  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div>
      <div className="text-xs uppercase tracking-wider text-brand-300">{label}</div>
      <div className="text-xl font-semibold text-brand-500 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-brand-300">{sub}</div>}
    </div>
  );
  return (
    <Slab wide>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
          What the register says
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <Stat label="Sold" value="$2,791.00" sub="48 tickets" />
          <Stat label="Tips" value="$64.00" sub="to technicians" />
          <Stat label="Terminal tax" value="$13.00" sub="on tips taken out" />
          <Stat
            label="Collected"
            value="$2,842.00"
            sub="what came in, not what was rung"
          />
        </div>
      </div>
    </Slab>
  );
}

/* ── close-out: a warning ───────────────────────────────────────────────────
   Mirrors .eod-flag as it prints. Black box, black text — see eod.css for why
   it is not red. */
function EodFlag() {
  return (
    <Slab wide>
      <div
        style={{
          border: "2px solid #111",
          padding: "12px 16px",
          fontSize: 14,
          color: "#111",
          background: "#fff",
        }}
      >
        <strong>DOES NOT BALANCE</strong> — out by $0.00 across tenders, netting to zero
        overall. Cash −$60.00 · Credit card +$60.00 — possible tender mix-up, see above.
      </div>
    </Slab>
  );
}

/* ── inventory: the pills ───────────────────────────────────────────────────
   Mirrors the low-stock and discount markers on the inventory sheet. */
function StockPills() {
  return (
    <Slab>
      <div className="bg-white rounded-2xl shadow-sm p-4 text-sm">
        <div className="flex items-center justify-between gap-3 py-1.5 border-b border-black/5">
          <span className="text-brand-500">KENDA KENETICA 215-60-17</span>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: "#fee2e2", color: "#991b1b" }}
          >
            none left
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 py-1.5 border-b border-black/5">
          <span className="text-brand-500">VANTAGE 225-50-17</span>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: "#fef3c7", color: "#92400e" }}
          >
            1 left
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 py-1.5">
          <span className="text-brand-500">VANTAGE A/S 205-60-16</span>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: "rgba(255,200,61,0.30)", color: "#0a2540" }}
          >
            Discount!
          </span>
        </div>
      </div>
    </Slab>
  );
}

/* ── the tab bar ────────────────────────────────────────────────────────────
   Mirrors the nav in src/components/pos/PosShell.tsx, with Main selected. */
function TabBar() {
  const tabs = ["Main", "New sale", "Logs", "Inventory", "Close-out"];
  return (
    <Slab wide>
      <div
        className="flex gap-1 rounded-2xl p-2"
        style={{ background: "#0a2540" }}
      >
        {tabs.map((t) => (
          <div
            key={t}
            className="rounded-lg px-3 py-2 text-sm font-medium"
            style={{
              background: t === "Main" ? "#fff" : "transparent",
              color: t === "Main" ? "#0a2540" : "rgba(255,255,255,0.75)",
            }}
          >
            {t}
          </div>
        ))}
      </div>
    </Slab>
  );
}

/* ── outstanding: the status picker ────────────────────────────────────────
   Mirrors the status dropdown on an Outstanding row in Main. Shown open,
   because the whole point of the section it illustrates is that these seven
   words are a sequence and not a set. */
function OrderStatus() {
  const steps = [
    "Ordered",
    "Arrived",
    "Here — call them",
    "Called — no answer",
    "Ready for pick up — call them",
    "Waiting for pickup",
    "Picked up",
  ];
  return (
    <Slab>
      <div
        className="rounded-2xl shadow-sm p-4"
        style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.30)" }}
      >
        <div className="text-xs uppercase tracking-wider text-amber-800 mb-2">
          S-2026-000144 · Aurelio Peña
        </div>
        <div className="rounded-lg bg-white border border-amber-900/20 overflow-hidden">
          {steps.map((s, i) => (
            <div
              key={s}
              className="px-3 py-1.5 text-sm"
              style={{
                background: i === 0 ? "rgba(180,83,9,0.12)" : undefined,
                color: "#7c2d12",
                fontWeight: i === 0 ? 600 : 400,
                borderTop: i ? "1px solid rgba(180,83,9,0.12)" : undefined,
              }}
            >
              {s}
            </div>
          ))}
        </div>
      </div>
    </Slab>
  );
}

/* ── logs: the search, and the warning when it finds nothing ───────────────
   Mirrors the search row on Logs and the amber box that appears on an empty
   result. Both together because the box only ever appears under that field. */
function LogsSearch() {
  return (
    <Slab wide>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div
            className="rounded-lg border border-black/10 px-3 py-2 text-sm text-brand-300 flex-1"
            style={{ minWidth: 180 }}
          >
            Ticket, cliente o teléfono…
          </div>
          <div className="btn text-sm" style={{ background: "rgba(10,37,64,0.06)", color: "#0a2540" }}>
            Today
          </div>
          <div className="rounded-lg border border-black/10 px-3 py-2 text-sm text-brand-400">
            2026-08-08
          </div>
        </div>
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: "#fffbeb", border: "1px solid #fbbf24", color: "#78350f" }}
        >
          <strong>No se encontró nada.</strong> La búsqueda por nombre solo mira
          los días que están en pantalla. Abra las fechas y vuelva a buscar.
        </div>
      </div>
    </Slab>
  );
}

/* ── the close-out, as three sheets ────────────────────────────────────────
   Not a picture of the paper — a diagram of what is on each sheet. A
   photograph of a close-out at manual size is unreadable, and the thing being
   taught is the ORDER of the pages, not their contents. */
function CloseoutPages() {
  const sheets = [
    {
      n: "1",
      title: "Day close-out",
      lines: ["Sold · Tips · Collected", "Las dos gráficas", "Performance", "Tender reconciliation", "— firmas —"],
      foot: "Se firma y se archiva",
    },
    {
      n: "2",
      title: "Financial Report",
      lines: ["Los avisos", "Caja: entradas y salidas", "Cortes de media jornada", "A cuenta hoy", "Quién cobró qué", "Precios cambiados"],
      foot: "Lo que hay que revisar",
    },
    {
      n: "3",
      title: "Logs Report",
      lines: ["Lo que se debe", "Lo que hay que reordenar", "Llantas que salieron", "Lo que llegó", "Todo lo del día, en orden"],
      foot: "El detalle",
    },
  ];
  return (
    <Slab wide>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {sheets.map((s) => (
          <div
            key={s.n}
            className="bg-white p-3"
            style={{ border: "1px solid #c8d0d8", borderRadius: 4, minHeight: 190 }}
          >
            <div className="flex items-baseline gap-2 mb-2 pb-2" style={{ borderBottom: "2px solid #0a2540" }}>
              <span
                className="rounded-full text-white text-xs font-bold flex items-center justify-center"
                style={{ background: "#0a2540", width: 20, height: 20 }}
              >
                {s.n}
              </span>
              <span className="font-semibold text-brand-500 text-sm">{s.title}</span>
            </div>
            <ul className="text-xs text-brand-400" style={{ lineHeight: 1.7 }}>
              {s.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <div className="text-xs text-brand-300 mt-2 pt-2" style={{ borderTop: "1px solid #e2e7ec" }}>
              {s.foot}
            </div>
          </div>
        ))}
      </div>
    </Slab>
  );
}

/* ── clock: the four action buttons ────────────────────────────────────────
   Mirrors src/components/kiosk/ActionButtons.tsx, on the clock's dark ground
   because that colour is half of how they are recognised. All four shown at
   once even though the clock only ever offers one or two — the section it
   illustrates is about which ones appear when. */
function ClockActions() {
  const acts = [
    { label: "Check In", emoji: "🟢", cls: "btn btn-accent" },
    { label: "Take a Break", emoji: "☕", cls: "btn btn-ghost" },
    { label: "End Break", emoji: "🟡", cls: "btn btn-accent" },
    { label: "Check Out", emoji: "🔵", cls: "btn btn-primary" },
  ];
  return (
    <Slab wide>
      <div
        className="rounded-2xl p-5 flex gap-3 justify-center flex-wrap"
        style={{ background: "#22303c" }}
      >
        {acts.map((a) => (
          <div
            key={a.label}
            className={a.cls}
            style={{
              minWidth: 150,
              padding: "0.85rem 1.2rem",
              fontSize: "1.05rem",
              color: a.cls.includes("ghost") ? "#fff" : undefined,
            }}
          >
            <span style={{ fontSize: "1.2rem" }}>{a.emoji}</span>
            {a.label}
          </div>
        ))}
      </div>
    </Slab>
  );
}

/* ── clock: the greeting line ──────────────────────────────────────────────
   Mirrors the "Hi, name" block on the kiosk after a PIN is accepted. This is
   the confirmation the manual tells people to read, so it gets to be seen. */
function ClockGreeting() {
  return (
    <Slab>
      <div className="rounded-2xl p-5 text-center" style={{ background: "#22303c" }}>
        <div className="text-2xl font-semibold text-white">Hi, Jerry</div>
        <div className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>
          You&apos;re currently working.
        </div>
      </div>
    </Slab>
  );
}

/* ── admin: the side nav ───────────────────────────────────────────────────
   Mirrors the nav in src/components/admin/AdminShell.tsx, in full. The clock's
   admin is one password rather than a ladder of roles, so there is no level to
   trim it to — whoever holds the password sees all seven. */
function AdminNav() {
  const items = [
    ["▦", "Dashboard"],
    ["👥", "Employees"],
    ["🔑", "Permissions"],
    ["🕒", "Time Entries"],
    ["📈", "Reports"],
    ["📜", "Audit Log"],
    ["⚙", "Settings"],
  ];
  return (
    <Slab>
      <div className="rounded-2xl p-3" style={{ background: "#0a2540" }}>
        {items.map(([icon, label], i) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
            style={{
              background: i === 3 ? "rgba(255,255,255,0.12)" : "transparent",
              color: i === 3 ? "#fff" : "rgba(255,255,255,0.7)",
              fontWeight: i === 3 ? 600 : 400,
            }}
          >
            <span>{icon}</span>
            {label}
          </div>
        ))}
      </div>
    </Slab>
  );
}

/* ── the New sale screen, whole ────────────────────────────────────────────
   A map rather than a copy. The real screen is two columns of cards and the
   thing people cannot hold in their head is not what any one card looks like —
   it is that the LEFT side adds and the RIGHT side is the ticket, and that the
   right side is one ticket the whole time. So the regions are drawn to scale,
   labelled, and numbered to a legend in the manual. */
function NewSaleMap() {
  const Region = ({
    n,
    label,
    sub,
    tone = "plain",
    h,
  }: {
    n: number;
    label: string;
    sub?: string;
    tone?: "plain" | "navy" | "amber" | "ticket";
    h?: number;
  }) => (
    <div
      className="rounded-xl p-3 relative"
      style={{
        minHeight: h,
        background:
          tone === "navy"
            ? "#0a2540"
            : tone === "amber"
              ? "rgba(255,200,61,0.22)"
              : tone === "ticket"
                ? "#fff"
                : "#fff",
        border: tone === "ticket" ? "2px solid #0a2540" : "1px solid rgba(0,0,0,0.10)",
        color: tone === "navy" ? "#fff" : "#0a2540",
      }}
    >
      <span
        className="absolute rounded-full text-white text-xs font-bold flex items-center justify-center"
        style={{ background: "#a8760a", width: 22, height: 22, left: -9, top: -9, border: "2px solid #fff" }}
      >
        {n}
      </span>
      <div className="text-sm font-semibold">{label}</div>
      {sub && (
        <div className="text-xs mt-0.5" style={{ opacity: tone === "navy" ? 0.75 : 0.6 }}>
          {sub}
        </div>
      )}
    </div>
  );

  return (
    <Slab wide>
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
        <div className="flex flex-col gap-3">
          <Region n={1} label="Services  |  Inventory" sub="Los dos modos. Cambia todo lo de abajo." />
          <Region n={2} label="PRICE" sub="Botones azules — cantidades sueltas" tone="navy" h={62} />
          <Region n={3} label="SERVICE" sub="Botones amarillos — los trabajos" tone="amber" h={62} />
          <Region n={4} label="Buscador de llantas" sub="Solo en el modo Inventory" h={50} />
        </div>
        <Region
          n={5}
          label="TICKET  S-2026-000118"
          sub="Aquí se va juntando todo. Es UN solo ticket."
          tone="ticket"
          h={240}
        />
      </div>
    </Slab>
  );
}

/* ── one ticket, several lines ─────────────────────────────────────────────
   Built for one misunderstanding and no other: that a ticket is a container,
   and two tires go ON it rather than needing two of it. The same size appears
   twice on purpose — once as a quantity of two, once as two separate lines —
   because both are correct and people ask which. */
function TwoTires() {
  const Line = ({ what, sub, amt }: { what: string; sub: string; amt: string }) => (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-black/5">
      <div className="min-w-0">
        <div className="font-medium text-brand-500">{what}</div>
        <div className="text-xs text-brand-300">{sub}</div>
      </div>
      <div className="tabular-nums font-semibold text-brand-500">{amt}</div>
    </div>
  );
  return (
    <Slab wide>
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
            Así — un ticket
          </div>
          <Line what="VANTAGE 225-50-17" sub="2 × $130.00 · Kevin" amt="$260.00" />
          <Line what="MOUNT & B" sub="2 × $10.00 · Kevin" amt="$20.00" />
          <div className="flex items-baseline justify-between gap-3 pt-3 mt-1">
            <div className="font-semibold text-brand-500">Total</div>
            <div className="tabular-nums text-xl font-bold text-brand-500">$280.00</div>
          </div>
        </div>
        <div
          className="rounded-2xl p-4"
          style={{ background: "#fef2f2", border: "1px solid rgba(153,27,27,0.30)" }}
        >
          <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "#991b1b" }}>
            Así no — dos tickets
          </div>
          <div className="text-sm" style={{ color: "#7f1d1d", lineHeight: 1.6 }}>
            TICKET S-2026-000118 — $140.00
            <br />
            TICKET S-2026-000119 — $140.00
            <div className="mt-2 text-xs">
              Dos recibos, dos cobros, y el cliente se lleva dos papeles por un
              solo trabajo.
            </div>
          </div>
        </div>
      </div>
    </Slab>
  );
}

/* ── the ticket drawer ─────────────────────────────────────────────────────
   Mirrors src/components/pos/TicketDrawer.tsx top to bottom. Drawn as the
   panel it is, with every block it can show, because the drawer is where every
   correction happens and the manual's job is to say which block does what. */
function TicketDrawerMap() {
  const Row = ({ n, label, sub }: { n: number; label: string; sub: string }) => (
    <div className="flex gap-3 items-start py-2 border-b border-black/5 last:border-0">
      <span
        className="rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0"
        style={{ background: "#a8760a", width: 22, height: 22, marginTop: 2 }}
      >
        {n}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-brand-500">{label}</div>
        <div className="text-xs text-brand-300">{sub}</div>
      </div>
    </div>
  );
  return (
    <Slab>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-baseline justify-between mb-1">
          <div className="font-semibold text-brand-500">
            <span className="tracking-wide">TICKET</span>{" "}
            <span className="tabular-nums">S-2026-000118</span>
          </div>
        </div>
        <div className="text-xs text-brand-300 mb-3">Rung by Kevin · 11:04 AM</div>
        <Row n={1} label="Print receipt" sub="Vuelve a imprimir el recibo del cliente." />
        <Row n={2} label="Details" sub="Cliente, vehículo y la nota que sale en el recibo." />
        <Row n={3} label="Status / Outstanding order" sub="Mover el ticket entre los estados de espera." />
        <Row n={4} label="Pin it" sub="Recado interno. No sale en el recibo." />
        <Row n={5} label="Los renglones" sub="Cada uno con Change the price, How many y su técnico." />
        <Row n={6} label="Take a payment" sub="Cobrar lo que falta. Sale solo si hay saldo." />
        <Row n={7} label="Tip added later" sub="Agregar una propina que se olvidó." />
        <Row n={8} label="Void" sub="Anular el ticket. Solo gerente." />
      </div>
    </Slab>
  );
}

/* ── inventory: the receive sheet ──────────────────────────────────────────
   Mirrors the panel behind "+ Receive stock" in the inventory page. Shown with
   a tire already picked, because confirming you grabbed the right one out of
   five near-identical sizes is what that step is for. */
function ReceiveSheet() {
  const Field = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
    <label className="text-sm text-brand-400 flex-1 block">
      {label}
      <div className="rounded-lg border border-black/10 px-3 py-2 mt-1 text-brand-500 bg-white">
        {value}
      </div>
      {hint && <div className="text-xs text-brand-300 mt-0.5">{hint}</div>}
    </label>
  );
  return (
    <Slab>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-3">
          Receive stock
        </div>
        <div className="flex gap-1 mb-3">
          {["New tires", "Used tires"].map((t) => (
            <div
              key={t}
              className="rounded-lg px-3 py-1.5 text-sm font-medium"
              style={{
                background: t === "New tires" ? "#0a2540" : "rgba(10,37,64,0.06)",
                color: t === "New tires" ? "#fff" : "#0a2540",
              }}
            >
              {t}
            </div>
          ))}
        </div>
        <div
          className="rounded-lg px-3 py-2 mb-3"
          style={{ background: "rgba(10,37,64,0.04)" }}
        >
          <div className="text-sm text-brand-500">KENDA KENETICA 215-60-17</div>
          <div className="text-xs text-brand-300">215-60-17 · 2 en estante</div>
        </div>
        <div className="flex gap-3 mb-3">
          <Field label="How many" value="12" />
          <Field label="Cost each" value="72.00" />
        </div>
        <div className="flex gap-3 mb-3">
          <Field label="Supplier" value="Alamo Tire Supply" />
          <Field label="Reference" value="INV-44118" />
        </div>
        <div className="text-xs text-brand-400 underline">Not in the list? Add a tire</div>
      </div>
    </Slab>
  );
}

/* ── inventory: the row controls ───────────────────────────────────────────
   Mirrors a product row on the inventory sheet. The two small links on the
   right are the whole reason this specimen exists — they are easy to miss and
   they are how every stock mistake gets fixed. */
function StockRow() {
  return (
    <Slab wide>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-black/5">
              <td className="py-2 text-brand-500">KENDA KENETICA 215-60-17</td>
              <td className="py-2 text-brand-400 tabular-nums">14</td>
              <td className="py-2 text-brand-400 tabular-nums">$150.00</td>
              <td className="py-2 text-right whitespace-nowrap">
                <span className="text-xs text-brand-400 underline">Edit</span>
                <span className="text-xs text-brand-400 underline ml-3">Count</span>
              </td>
            </tr>
            <tr>
              <td className="py-2 text-brand-500">VANTAGE 225-50-17</td>
              <td className="py-2 text-brand-400 tabular-nums">1</td>
              <td className="py-2 text-brand-400 tabular-nums">$130.00</td>
              <td className="py-2 text-right whitespace-nowrap">
                <span className="text-xs text-brand-400 underline">Edit</span>
                <span className="text-xs text-brand-400 underline ml-3">Count</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Slab>
  );
}

/**
 * Everything the manual can drop into a paragraph, by name.
 *
 * A missing name renders a visible placeholder rather than nothing: a specimen
 * that silently disappears leaves a sentence pointing at empty space, and the
 * reader assumes the page is broken rather than the reference.
 */
export const SPECIMENS: Record<string, () => React.ReactElement> = {
  "quick-amounts": QuickAmounts,
  "quick-services": QuickServices,
  "ticket-lines": TicketLines,
  tenders: Tenders,
  "close-actions": CloseActions,
  "confirm-unpaid": ConfirmUnpaid,
  "pending-vs-outstanding": PendingVsOutstanding,
  "day-stats": DayStats,
  "eod-flag": EodFlag,
  "stock-pills": StockPills,
  "tab-bar": TabBar,
  "order-status": OrderStatus,
  "logs-search": LogsSearch,
  "closeout-pages": CloseoutPages,
  "clock-actions": ClockActions,
  "clock-greeting": ClockGreeting,
  "admin-nav": AdminNav,
  "new-sale-map": NewSaleMap,
  "two-tires": TwoTires,
  "ticket-drawer-map": TicketDrawerMap,
  "receive-sheet": ReceiveSheet,
  "stock-row": StockRow,
};

export function Specimen({ name }: { name: string }) {
  const S = SPECIMENS[name];
  if (!S)
    return (
      <div className="manual-specimen-missing">
        Missing specimen: <code>{name}</code>
      </div>
    );
  return <S />;
}
