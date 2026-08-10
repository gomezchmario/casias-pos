"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import {
  CAPABILITIES,
  CAPABILITY_INFO,
  ROLE_LABELS,
  can,
  roleAtLeast,
  type Capability,
  type PosRole,
} from "@/lib/roles";
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
import type {
  QuickButton,
  QuickButtonKind,
  ServiceCategory,
} from "@/lib/quick-buttons";

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
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newKind, setNewKind] = useState<QuickButtonKind>("amount");
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCat, setNewCat] = useState<string>("");

  const canButtons = can("manageQuickButtons");

  const load = useCallback(async () => {
    if (!canButtons) return;
    const res = await fetch("/api/pos/quick-buttons");
    if (!res.ok) {
      setError("Could not load the buttons");
      return;
    }
    const d: { buttons: QuickButton[]; categories: ServiceCategory[] } = await res.json();
    setButtons(d.buttons);
    setCategories(d.categories ?? []);
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
        categoryId: newKind === "service" && newCat ? Number(newCat) : null,
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
    setNewCat("");
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
      {canShop && <TireStudyCard onError={setError} />}
      {can("managePermissions") && <ExtraPermissionsCard onError={setError} />}
      {canShop && <InventoryAlarmCard onError={setError} />}

      {canButtons && !buttons && <div className="text-brand-300">Loading…</div>}

      {canButtons && buttons && (
        <>
      <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">Register buttons</div>
        {/* The sentence about counting is here rather than beside the dropdown
            because it is the thing nobody knew. A button was once relabelled
            from NEW TIRE to AIR and went on booking new tires for a day — the
            label is what the counter reads, the category is what the reports
            read, and until this field existed there was no way to see that they
            had come apart. */}
        <p className="text-sm text-brand-400 mb-3">
          What the register shows. Retiring a button hides it without touching the
          tickets it has already rung. <strong>Counts as</strong> is what the
          leaderboard and the close-out add it up under — it is not the label, and
          renaming a button does not change it.
        </p>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "130px 1fr 130px 150px auto" }}
        >
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
          {newKind === "service" ? (
            <select
              className="input"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              aria-label="Counts as"
            >
              <option value="">Counts as…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <div />
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
            categories={categories}
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
            categories={categories}
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
/**
 * The tire study: the switch, and the way to the report it produces.
 *
 * Both in one card, deliberately. A switch that turns on data collection and a
 * report that reads it are one thing to the person deciding whether to run it,
 * and separating them is how a study gets switched on in March and remembered
 * in November.
 *
 * The switch says what it costs the floor, because that is the question an owner
 * actually has about it — not "what does this do" but "what does this put in
 * front of my cashier while there is a queue".
 */
function TireStudyCard({ onError }: { onError: (m: string | null) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  /** How many sizes have been recorded, so the card can say whether it is worth reading. */
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pos/settings");
      if (res.ok) {
        const d: { settings: { tireDemandEnabled: boolean } } = await res.json();
        setOn(d.settings.tireDemandEnabled);
      }
      const r2 = await fetch("/api/pos/tire-demand");
      if (r2.ok) setCount((await r2.json()).totals?.tires ?? 0);
    })();
  }, []);

  async function toggle() {
    if (on === null) return;
    setBusy(true);
    onError(null);
    const res = await fetch("/api/pos/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tireDemandEnabled: !on }),
    });
    setBusy(false);
    if (!res.ok) {
      onError("Could not change that");
      return;
    }
    const d: { settings: { tireDemandEnabled: boolean } } = await res.json();
    setOn(d.settings.tireDemandEnabled);
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
        Tire study
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div style={{ maxWidth: 560 }}>
          <p className="text-sm text-brand-400">
            Puts a small, faded button in the corner of every register screen. The
            counter presses it when a customer asks for a size the shop does not
            have and leaves without it — the one number the shop has never had.
          </p>
          <p className="text-xs text-brand-300 mt-1">
            It takes a size and a quantity, changes nothing about the day, and is
            never part of a ticket.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={on ? "btn btn-primary" : "btn btn-outline"}
            disabled={busy || on === null}
            aria-pressed={on === true}
            onClick={() => void toggle()}
          >
            {on === null ? "…" : on ? "Recording" : "Switched off"}
          </button>
          {/* Always offered, on or off. Switching the study off does not delete
              what it collected, and the commonest reason to open this card at
              all is to go and read the numbers. */}
          <Link href="/pos/demand" className="btn btn-outline">
            The report
            {count !== null && count > 0 && (
              <span className="text-xs font-normal"> · {count}</span>
            )}
          </Link>
        </div>
      </div>
    </div>
  );
}

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
  categories,
  busy,
  onSave,
  onMove,
}: {
  button: QuickButton;
  categories: ServiceCategory[];
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onMove: (delta: number) => void;
}) {
  const [label, setLabel] = useState(button.label);
  const [amount, setAmount] = useState(
    button.amount_cents === null ? "" : (button.amount_cents / 100).toFixed(2),
  );
  const [desc, setDesc] = useState(button.description ?? "");
  const [cat, setCat] = useState(button.category_id === null ? "" : String(button.category_id));
  const retired = button.active === 0;

  const dirty =
    label !== button.label ||
    desc !== (button.description ?? "") ||
    cat !== (button.category_id === null ? "" : String(button.category_id)) ||
    parseCents(amount) !== button.amount_cents;

  function save() {
    const body: Record<string, unknown> = { label };
    if (button.kind === "amount") {
      const cents = parseCents(amount);
      if (cents === null) return;
      body.amountCents = cents;
    } else {
      body.description = desc;
      body.categoryId = cat === "" ? null : Number(cat);
    }
    onSave(body);
  }

  return (
    <div
      className="py-2 grid items-center gap-2"
      style={{
        gridTemplateColumns: "1fr 1fr 110px 150px auto auto",
        opacity: retired ? 0.5 : 1,
      }}
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
      {/* Blank is allowed and is not the same as Other: an uncategorised line
          falls into the Other column of every report anyway, so forcing a
          choice here would only invite a wrong one. What must never happen
          again is a category nobody can see. */}
      {button.kind === "amount" ? (
        <div />
      ) : (
        <select
          className="input"
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          aria-label={`What ${button.label} counts as`}
        >
          <option value="">Not counted</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
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

/**
 * Permissions handed to one person, over and above their role.
 *
 * HERE RATHER THAN ON THE ADMIN PERMISSIONS SCREEN, which is where the role
 * matrix lives and where somebody thinking about who-can-do-what naturally
 * looks. The reason is attribution: that screen is behind the admin PASSWORD,
 * whose session knows an admin username and not an employee, and a grant has to
 * be signed by a person on the staff list. Here the owner is PIN-authenticated
 * as themselves, so the audit row names them.
 *
 * Only capabilities the person's role does not already carry are offered, and
 * anything their role is denied by name is refused with the reason — see
 * `grants.ts`. A list that offered every permission to everybody would be a
 * list where the useful entries are lost among forty that change nothing.
 */
function ExtraPermissionsCard({ onError }: { onError: (m: string | null) => void }) {
  const { t: tr } = useLang();
  const [rows, setRows] = useState<
    { id: number; name: string; posRole: PosRole; active: number; grants: Capability[] }[] | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/permissions");
    if (!res.ok) return;
    setRows((await res.json()).employees);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function set(employeeId: number, capability: Capability, grant: boolean) {
    setBusy(true);
    onError(null);
    const res = await fetch("/api/pos/permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, capability, grant }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onError(d.error || "That did not save");
      return;
    }
    await load();
  }

  if (!rows) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
        {tr("Extra permissions")}
      </div>
      <p className="text-sm text-brand-400 mb-3">
        {tr(
          "One permission, given to one person, without moving them to another role. Their role is unchanged and everything else about it stays exactly as it was.",
        )}
      </p>

      <table className="w-full text-sm">
        <tbody>
          {rows
            .filter((e) => e.active === 1)
            .map((e) => {
              // What they could still be given: not already theirs by rank, and
              // not denied to their role by name. Computed here so the list a
              // person sees matches the list the server will accept.
              const offerable = (Object.keys(CAPABILITY_INFO) as Capability[]).filter(
                (c) => !can(e.posRole, c) && !DENIED_BY_NAME(e.posRole, c),
              );
              return (
                <tr key={e.id} className="border-t border-black/5 align-top">
                  <td className="py-2">
                    <div className="font-medium text-brand-500">{e.name}</div>
                    <div className="text-xs text-brand-300">{ROLE_LABELS[e.posRole]}</div>
                  </td>
                  <td className="py-2 pl-4 w-full">
                    {e.grants.length === 0 ? (
                      <span className="text-brand-300 text-xs">{tr("nothing extra")}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {e.grants.map((c) => (
                          <span key={c} className="pos-grant">
                            {CAPABILITY_INFO[c]?.label ?? c}
                            <button
                              type="button"
                              aria-label={tr("Take it back")}
                              disabled={busy}
                              onClick={() => void set(e.id, c, false)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {open === e.id && (
                      <select
                        className="input mt-2"
                        style={{ maxWidth: 420 }}
                        defaultValue=""
                        disabled={busy}
                        onChange={(ev) => {
                          if (ev.target.value) {
                            void set(e.id, ev.target.value as Capability, true);
                            setOpen(null);
                          }
                        }}
                      >
                        <option value="">{tr("Pick a permission…")}</option>
                        {offerable
                          .filter((c) => !e.grants.includes(c))
                          .map((c) => (
                            <option key={c} value={c}>
                              {CAPABILITY_INFO[c].label}
                            </option>
                          ))}
                      </select>
                    )}
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="text-xs text-brand-400 hover:text-brand-500 underline"
                      disabled={busy || offerable.length === 0}
                      onClick={() => setOpen(open === e.id ? null : e.id)}
                    >
                      {open === e.id ? tr("Cancel") : tr("Give one")}
                    </button>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Denied to the role by name rather than merely out of reach by rank.
 *
 * The same test `grants.ts` makes on the server, and it has to be made here as
 * well or the dropdown offers permissions the server will refuse. `can` applies
 * the denial list before rank, so a role that clears the minimum and is still
 * refused has been refused deliberately.
 */
const DENIED_BY_NAME = (role: PosRole, capability: Capability) =>
  roleAtLeast(role, CAPABILITIES[capability]) && !can(role, capability);
