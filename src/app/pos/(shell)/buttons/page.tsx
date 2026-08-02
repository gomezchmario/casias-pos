"use client";

import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents, parseCents } from "@/lib/money";
import type { QuickButton, QuickButtonKind } from "@/lib/quick-buttons";

export default function ButtonsPage() {
  const { can } = usePosAuth();
  const [buttons, setButtons] = useState<QuickButton[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newKind, setNewKind] = useState<QuickButtonKind>("amount");
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/quick-buttons");
    if (!res.ok) {
      setError("Could not load the buttons");
      return;
    }
    const d: { buttons: QuickButton[] } = await res.json();
    setButtons(d.buttons);
  }, []);

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

  if (!can("manageQuickButtons")) {
    return <div className="text-brand-400">Your account can&apos;t change the buttons.</div>;
  }
  if (!buttons) return <div className="text-brand-300">Loading…</div>;

  const amounts = buttons.filter((b) => b.kind === "amount");
  const services = buttons.filter((b) => b.kind !== "amount");

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-500">Register buttons</h1>
        <p className="text-brand-400 text-sm">
          What the register shows. Retiring a button hides it without touching the
          tickets it has already rung.
        </p>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-3">Add a button</div>
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
