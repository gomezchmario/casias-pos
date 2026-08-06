"use client";

import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  ALARM_ALERT_DAYS,
  ALARM_ICON,
  ALARM_STYLE,
  ALARM_WARN_DAYS,
  alarmLevel,
  daysSinceDate,
  formatCheckDate,
  type InventoryCheck,
} from "@/lib/inventory-alarm";
import { formatCents, parseCents } from "@/lib/money";
import type { QuickButton, QuickButtonKind } from "@/lib/quick-buttons";

/**
 * Everything about the register that is set once and then left alone.
 *
 * This was the "Buttons" screen. The two were never really different things —
 * the quick-button grid IS a setting — and the alternative was a gear icon
 * leading to one page plus a second page for everything else that belongs
 * behind a gear.
 *
 * Sections are gated one at a time rather than the page as a whole. Every
 * capability here is owner-level today so it makes no visible difference, but
 * the day a manager is allowed to change the buttons and not the lock timer,
 * this page already behaves.
 */
export default function SettingsPage() {
  const { can } = usePosAuth();
  const [buttons, setButtons] = useState<QuickButton[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newKind, setNewKind] = useState<QuickButtonKind>("amount");
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const canButtons = can("manageQuickButtons");

  const load = useCallback(async () => {
    if (!canButtons) return;
    const res = await fetch("/api/pos/quick-buttons");
    if (!res.ok) {
      setError("Could not load the buttons");
      return;
    }
    const d: { buttons: QuickButton[] } = await res.json();
    setButtons(d.buttons);
  }, [canButtons]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (id: number, body: Record<string, unknown>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const res = await fetch(`/api/pos/quick-buttons/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(d.error || "Could not save that change");
        return;
      }
      await load();
    },
    [busy, load],
  );

  async function create() {
    if (busy) return;
    const amountCents = newKind === "amount" ? parseCents(newAmount) : null;
    if (newKind === "amount" && amountCents === null) {
      setError("Enter a valid price");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/pos/quick-buttons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: newLabel,
        kind: newKind,
        amountCents,
        description: newKind === "service" ? newDesc : null,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not add that button");
      return;
    }
    setNewLabel("");
    setNewAmount("");
    setNewDesc("");
    await load();
  }

  // Swap sort_order with the neighbour above or below, which is enough ordering
  // control for a grid this size and needs no drag library on a touch screen.
  function move(list: QuickButton[], index: number, delta: number) {
    const other = list[index + delta];
    if (!other) return;
    const b = list[index];
    void (async () => {
      await patch(b.id, { sortOrder: other.sort_order });
      await patch(other.id, { sortOrder: b.sort_order });
    })();
  }

  const canShop = can("manageSettings");

  if (!canButtons && !canShop) {
    return <div className="text-brand-400">Your account can&apos;t change the settings.</div>;
  }

  const amounts = buttons?.filter((b) => b.kind === "amount") ?? [];
  const services = buttons?.filter((b) => b.kind !== "amount") ?? [];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-500">Settings</h1>
        <p className="text-brand-400 text-sm">
          How the register behaves, and what it shows.
        </p>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {canShop && <LockCard onError={setError} />}
      {canShop && <InventoryAlarmCard onError={setError} />}

      {canButtons && !buttons && <div className="text-brand-300">Loading…</div>}

      {canButtons && buttons && (
        <>
      <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">Register buttons</div>
        <p className="text-sm text-brand-400 mb-3">
          What the register shows. Retiring a button hides it without touching the
          tickets it has already rung.
        </p>
        <div className="grid gap-3" style={{ gridTemplateColumns: "130px 1fr 130px auto" }}>
          <select
            className="input"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as QuickButtonKind)}
          >
            <option value="amount">Price</option>
            <option value="service">Service</option>
          </select>
          <input
            className="input"
            placeholder="Button label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          {newKind === "amount" ? (
            <input
              className="input text-right tabular-nums"
              placeholder="0.00"
              inputMode="decimal"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
            />
          ) : (
            <input
              className="input"
              placeholder="Ticket line text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
          )}
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
            Add
          </button>
        </div>
      </div>

      <Section title="Price">
        {amounts.map((b, i) => (
          <Row
            key={b.id}
            button={b}
            busy={busy}
            onSave={(body) => void patch(b.id, body)}
            onMove={(d) => move(amounts, i, d)}
          />
        ))}
      </Section>

      <Section title="Service">
        {services.map((b, i) => (
          <Row
            key={b.id}
            button={b}
            busy={busy}
            onSave={(body) => void patch(b.id, body)}
            onMove={(d) => move(services, i, d)}
          />
        ))}
      </Section>
        </>
      )}
    </div>
  );
}

/**
 * How long the register waits before it locks itself.
 *
 * In minutes here and seconds in the database, because nobody thinks about this
 * in seconds and "900" in a box invites somebody to try 90 and lock the counter
 * every minute and a half.
 */
function LockCard({ onError }: { onError: (m: string | null) => void }) {
  const [minutes, setMinutes] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pos/settings");
      if (!res.ok) return;
      const d: { settings: { posIdleLockSeconds: number } } = await res.json();
      const m = Math.round(d.settings.posIdleLockSeconds / 60);
      setSaved(m);
      setMinutes(String(m));
    })();
  }, []);

  const n = parseInt(minutes ?? "", 10);
  const dirty = Number.isInteger(n) && n !== saved;

  async function save() {
    onError(null);
    if (!Number.isInteger(n) || n < 1) {
      onError("Enter the number of minutes");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pos/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posIdleLockSeconds: n * 60 }),
    });
    setBusy(false);
    if (!res.ok) {
      onError((await res.json().catch(() => ({}))).error || "Could not save that");
      return;
    }
    const d: { settings: { posIdleLockSeconds: number } } = await res.json();
    setSaved(Math.round(d.settings.posIdleLockSeconds / 60));
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">Register lock</div>
      <p className="text-sm text-brand-400 mb-3">
        With nobody touching it for this long, the register signs itself out and asks
        for a PIN. Anyone&apos;s PIN opens it again, and whoever types theirs is who
        the next ticket belongs to.
      </p>
      <div className="flex items-center gap-2">
        <input
          className="input text-right tabular-nums"
          style={{ width: 90 }}
          inputMode="numeric"
          value={minutes ?? ""}
          onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
          aria-label="Minutes before the register locks"
          disabled={minutes === null}
        />
        <span className="text-sm text-brand-400">minutes</span>
        {dirty && (
          <button type="button" className="btn btn-primary text-sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {/*
        Said out loud because the number is only half the rule. A cashier
        watching the screen go dark mid-conversation will assume the lock is
        broken unless somebody has told them scrolling counts.
      */}
      <p className="text-xs text-brand-300 mt-2">
        Typing, tapping and scrolling all count as somebody being here. Moving the
        mouse does not — a knocked mouse on a counter is not a cashier.
      </p>
    </div>
  );
}

/**
 * The stock sheet's nag, and the button that quiets it.
 *
 * It shows the real state first and the button second, on purpose: this is a
 * decision to live with an uncounted rack, and it should be made while looking
 * at how long the rack has gone uncounted.
 */
function InventoryAlarmCard({ onError }: { onError: (m: string | null) => void }) {
  const [check, setCheck] = useState<InventoryCheck | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/inventory?all=0");
    if (!res.ok) return;
    const d: { lastCheck: InventoryCheck } = await res.json();
    setCheck(d.lastCheck);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function clear() {
    onError(null);
    setBusy(true);
    const res = await fetch("/api/pos/settings/inventory-alarm", { method: "POST" });
    setBusy(false);
    setAsking(false);
    if (!res.ok) {
      onError("Could not clear the alarm");
      return;
    }
    setCheck(await res.json());
  }

  const level = check ? alarmLevel(check) : "ok";
  const days = check?.date ? daysSinceDate(check.date) : null;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
        Inventory check alarm
      </div>
      <p className="text-sm text-brand-400 mb-3">
        The stock sheet turns yellow after {ALARM_WARN_DAYS} days without a physical
        count and red after {ALARM_ALERT_DAYS}. Clearing buys another{" "}
        {ALARM_WARN_DAYS} quiet days. It does not record a count — the sheet still
        says when it was really last walked.
      </p>

      {check && (
        <div
          className="rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-3"
          style={ALARM_STYLE[level]}
        >
          <span className="text-brand-400">
            {ALARM_ICON[level] && (
              <span className="mr-1.5" aria-hidden="true">
                {ALARM_ICON[level]}
              </span>
            )}
            {check.date ? (
              <>
                Last counted {formatCheckDate(check.date)}
                {check.by && ` · ${check.by}`}
                {days !== null && days > 0 && ` · ${days} ${days === 1 ? "day" : "days"} ago`}
                {days !== null && days <= 0 && " · today"}
              </>
            ) : (
              <>Never counted</>
            )}
            {check.clearedOn > check.date && (
              <span className="text-brand-300">
                {" · alarm cleared "}
                {formatCheckDate(check.clearedOn)}
                {check.clearedBy && ` by ${check.clearedBy}`}
              </span>
            )}
          </span>
          <button
            type="button"
            className="btn btn-ghost whitespace-nowrap"
            style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
            onClick={() => setAsking(true)}
            disabled={busy || level === "ok"}
          >
            {level === "ok" ? "Nothing to clear" : "Clear"}
          </button>
        </div>
      )}

      <ConfirmModal
        open={asking}
        onCancel={() => setAsking(false)}
        onConfirm={() => void clear()}
        busy={busy}
        title="Clear the alarm?"
        confirmLabel="Clear it"
        cancelLabel="Leave it"
      >
        <p>
          The stock sheet stops shouting for {ALARM_WARN_DAYS} days. It keeps saying
          when the racks were really last counted, and it will say that you were the
          one who cleared it.
        </p>
      </ConfirmModal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">{title}</div>
      <div className="flex flex-col divide-y divide-black/5">{children}</div>
    </div>
  );
}

function Row({
  button,
  busy,
  onSave,
  onMove,
}: {
  button: QuickButton;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onMove: (delta: number) => void;
}) {
  const [label, setLabel] = useState(button.label);
  const [amount, setAmount] = useState(
    button.amount_cents === null ? "" : (button.amount_cents / 100).toFixed(2),
  );
  const [desc, setDesc] = useState(button.description ?? "");
  const retired = button.active === 0;

  const dirty =
    label !== button.label ||
    desc !== (button.description ?? "") ||
    parseCents(amount) !== button.amount_cents;

  function save() {
    const body: Record<string, unknown> = { label };
    if (button.kind === "amount") {
      const cents = parseCents(amount);
      if (cents === null) return;
      body.amountCents = cents;
    } else {
      body.description = desc;
    }
    onSave(body);
  }

  return (
    <div
      className="py-2 grid items-center gap-2"
      style={{ gridTemplateColumns: "1fr 1fr 110px auto auto", opacity: retired ? 0.5 : 1 }}
    >
      <input
        className="input"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        aria-label="Label"
      />
      {button.kind === "amount" ? (
        <div className="text-sm text-brand-300">
          Puts {formatCents(button.amount_cents ?? 0)} on the ticket
        </div>
      ) : (
        <input
          className="input"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Ticket line text"
          aria-label="Ticket line text"
        />
      )}
      {button.kind === "amount" ? (
        <input
          className="input text-right tabular-nums"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Price"
        />
      ) : (
        <div />
      )}
      <div className="flex gap-1">
        <button
          type="button"
          className="text-xs px-2 py-1 text-brand-400"
          onClick={() => onMove(-1)}
          disabled={busy}
          aria-label={`Move ${button.label} earlier`}
        >
          ↑
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 text-brand-400"
          onClick={() => onMove(1)}
          disabled={busy}
          aria-label={`Move ${button.label} later`}
        >
          ↓
        </button>
      </div>
      <div className="flex gap-2 justify-end">
        {dirty && (
          <button type="button" className="btn btn-primary text-xs" onClick={save} disabled={busy}>
            Save
          </button>
        )}
        <button
          type="button"
          className="text-xs underline text-brand-400"
          onClick={() => onSave({ active: retired })}
          disabled={busy}
        >
          {retired ? "Bring back" : "Retire"}
        </button>
      </div>
    </div>
  );
}
