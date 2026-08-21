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
      {canShop && <CostsCard onError={setError} />}
      {canShop && <ReportCard />}
      {canShop && <TireStudyCard onError={setError} />}
      {canShop && <WallTipsCard onError={setError} />}
      {canShop && <NotesStoryCard />}
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
/**
 * The written trends report — the Spanish PDF — a click away.
 *
 * A plain link in a new tab rather than a fetch with a spinner, on purpose. The
 * server rebuilds the document from live figures before answering, which takes
 * several seconds, and a browser tab already knows how to show "working on it"
 * — its own spinner — and then how to show a PDF: its own viewer, with print
 * and save built in. Reimplementing that dance with a busy flag and a blob URL
 * buys a popup-blocker fight and nothing else. The card's text carries the one
 * thing the tab cannot say, which is that the wait is the figures being
 * recalculated.
 */
function ReportCard() {
  const { t: tr } = useLang();
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
        {tr("Trends report")}
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div style={{ maxWidth: 560 }}>
          <p className="text-sm text-brand-400">
            {tr("The written report, in Spanish, as a printable PDF: where the business is heading, why, and the evidence — every chart explained in plain words. It is rebuilt from today's figures each time, so opening it takes a few seconds.")}
          </p>
        </div>
        <a
          className="btn btn-primary"
          href="/api/pos/reports/document"
          target="_blank"
          rel="noreferrer"
        >
          {tr("Open the report")}
        </a>
      </div>
    </div>
  );
}

/**
 * Whether the wall board shows tips at all.
 *
 * The switch lives here and the enforcement lives on the PUBLIC ENDPOINT:
 * off, the tip figures leave the response, not just the screen — a monitor
 * in the waiting area is exactly the place where "hidden by CSS" means
 * "published". The tips themselves keep being recorded either way; this is
 * about the wall, not the money.
 */
function WallTipsCard({ onError }: { onError: (m: string | null) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pos/settings");
      if (res.ok) {
        const d: { settings: { leaderboardShowTips: boolean } } = await res.json();
        setOn(d.settings.leaderboardShowTips);
      }
    })();
  }, []);

  async function toggle() {
    if (on === null) return;
    setBusy(true);
    onError(null);
    const res = await fetch("/api/pos/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaderboardShowTips: !on }),
    });
    setBusy(false);
    if (!res.ok) {
      onError("Could not change that");
      return;
    }
    const d: { settings: { leaderboardShowTips: boolean } } = await res.json();
    setOn(d.settings.leaderboardShowTips);
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
        Tips on the wall board
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div style={{ maxWidth: 560 }}>
          <p className="text-sm text-brand-400">
            The leaderboard&apos;s corner with tonight&apos;s tips. Switched off, the tip figures
            stop being sent to that screen at all — the corner disappears rather than going
            blank.
          </p>
          <p className="text-xs text-brand-300 mt-1">
            Tips keep being recorded on tickets either way. This only decides what the wall
            says out loud.
          </p>
        </div>
        <button
          type="button"
          className={on ? "btn btn-primary" : "btn btn-outline"}
          disabled={busy || on === null}
          aria-pressed={on === true}
          onClick={() => void toggle()}
        >
          {on === null ? "…" : on ? "Showing" : "Hidden"}
        </button>
      </div>
    </div>
  );
}

/**
 * The corkboard's story: every note that has come down, who wrote it, who
 * took it down and when. Here rather than on the board, because the board is
 * for what stands — a public archive under it would tempt people to write
 * for the record instead of for the counter. Loaded when the card is opened;
 * fifty notes of history is not worth fetching on every visit to Settings.
 */
function NotesStoryCard() {
  const [open, setOpen] = useState(false);
  const [story, setStory] = useState<
    | {
        id: number;
        by: string;
        body: string;
        putUp: string;
        takenDownBy: string | null;
        takenDownAt: string | null;
      }[]
    | null
  >(null);

  async function unfold() {
    const next = !open;
    setOpen(next);
    if (next && story === null) {
      const res = await fetch("/api/pos/notice/history");
      if (res.ok) setStory(((await res.json()) as { story: typeof story }).story ?? []);
    }
  }

  const when = (at: string | null) =>
    at
      ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "";

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
      <button type="button" className="w-full flex items-center justify-between gap-3" aria-expanded={open} onClick={() => void unfold()}>
        <span className="text-xs uppercase tracking-wider text-brand-300">
          The notes that came down
        </span>
        <span className="text-brand-300">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-3">
          {story === null ? (
            <div className="text-sm text-brand-300">Reading the story…</div>
          ) : story.length === 0 ? (
            <div className="text-sm text-brand-300">Nothing has been taken down yet.</div>
          ) : (
            <div className="divide-y divide-brand-100">
              {story.map((s) => (
                <div key={s.id} className="py-2 text-sm">
                  <div className="text-brand-500 whitespace-pre-wrap">{s.body}</div>
                  <div className="text-xs text-brand-300 mt-0.5">
                    {s.by} · {when(s.putUp)} — taken down
                    {s.takenDownBy ? ` by ${s.takenDownBy}` : ""} {when(s.takenDownAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

/**
 * What things cost the shop.
 *
 * THE SCREEN THAT ANSWERS "not enough cost data". A tire carries a cost because
 * it was bought from a supplier at a price somebody typed in; nothing else in
 * the register ever did. Two thirds of what this shop sells is labour — flats,
 * mounts, rotations, oil — and every one of those lines reached the margin
 * report with no cost at all, so the report could only say it did not know.
 *
 * It leads with the coverage figure rather than with the boxes, because that is
 * the number being moved and it is the only thing that makes a list of thirty
 * boxes worth working through. Each one saved moves it, immediately.
 *
 * Ranked by revenue and cut at thirty. There are 1,346 distinct service
 * descriptions in this shop's history and the top two are 39% of the money — a
 * screen listing all of them is a screen nobody fills in.
 *
 * MATERIALS, NOT LABOUR, and the card says so. What a flat repair consumes is a
 * patch and a valve; the hour is a fixed cost of opening the doors and does not
 * scale with one more repair. Folding wages in here would make every margin on
 * the reports depend on how busy the day happened to be.
 */
function CostsCard({ onError }: { onError: (m: string | null) => void }) {
  const { t: tr } = useLang();
  const [data, setData] = useState<{
    from: string;
    to: string;
    coverage: {
      revenueCents: number;
      costedCents: number;
      pct: number;
      linesWithout: number;
      /** Revenue covered only by the tire assumption — never folded into pct. */
      assumedCents: number;
      assumedPct: number;
    };
    services: {
      key: string;
      avgPriceCents: number;
      costCents: number | null;
      lines: number;
      revenueCents: number;
      setByName: string | null;
    }[];
    productsMissing: { productId: number; name: string; lines: number; revenueCents: number }[];
  } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /**
   * Typed margin percentages, by service.
   *
   * The stored truth is always a COST in cents — one number, one meaning, and
   * every report already reads it. But a shop owner pricing a flat repair
   * thinks "that's about eighty per cent margin", not "that's three dollars
   * forty of patch and valve", so the row takes either and converts against
   * what the service actually sells for. Typing in one box clears the other:
   * two boxes that disagree about the same row is worse than one box.
   */
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});
// Opened for you the first time it is worth opening. Below four fifths, the
  // margin on every report is a fact about part of the shop dressed as a fact
  // about the shop, and this is the only screen that fixes it.
  useEffect(() => {
    if (data && data.coverage.pct < 80) setOpen(true);
  }, [data]);

  /**
   * Give every listed tire a cost worked back from what it actually sold for.
   *
   * Confirmed by hand because it writes a real figure to every tire on the
   * list, and somebody should know that before pressing it rather than
   * afterwards. It skips anything already costed, so pressing it twice cannot
   * overwrite work done by hand.
   */
  async function fillProductCosts(count: number) {
    if (
      !window.confirm(
        `Give ${count} ${count === 1 ? "tire" : "tires"} a cost worked back from what each one sold for, at 20% markup?\n\nThis is an estimate, not an invoice. Anything already costed is left alone, and any of them can be corrected in Inventory afterwards.`,
      )
    )
      return;
    setBusy("__fill__");
    onError(null);
    const res = await fetch("/api/pos/costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fillProducts: true }),
    });
    setBusy(null);
    if (!res.ok) {
      onError(tr("That did not save"));
      return;
    }
    setData(await res.json());
  }

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/costs");
    if (!res.ok) return;
    const d = await res.json();
    setData(d);
    setDraft(
      Object.fromEntries(
        d.services.map((s: { key: string; costCents: number | null }) => [
          s.key,
          s.costCents === null ? "" : (s.costCents / 100).toFixed(2),
        ]),
      ),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Cost in cents from a margin percentage against the typical price. */
  const costFromMargin = (pct: number, avgPriceCents: number) =>
    Math.max(0, Math.round(avgPriceCents * (1 - pct / 100)));

  async function save(key: string, explicitCents?: number) {
    const raw = draft[key] ?? "";
    // An empty box means "not answered", which is a different fact from zero.
    // Clearing one takes the answer away rather than recording that the job
    // consumes nothing.
    const costCents =
      explicitCents !== undefined ? explicitCents : raw.trim() === "" ? null : parseCents(raw);
    if (explicitCents === undefined && raw.trim() !== "" && costCents === null) {
      onError(tr("That is not an amount"));
      return;
    }
    setBusy(key);
    onError(null);
    const res = await fetch("/api/pos/costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: key, costCents }),
    });
    setBusy(null);
    if (!res.ok) {
      onError(tr("That did not save"));
      return;
    }
    const d = await res.json();
    setData((cur) => (cur ? { ...cur, coverage: d.coverage } : cur));
  }

  if (!data) return null;
  const c = data.coverage;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
        {tr("What things cost")}
      </div>

      {/* The number this screen exists to move, and what moving it buys. */}
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <span
          className="text-2xl font-semibold tabular-nums"
          style={{ color: c.pct >= 80 ? "#15803d" : c.pct >= 40 ? "#b45309" : "#b91c1c" }}
        >
          {c.pct}%
        </span>
        <span className="text-sm text-brand-400">
          {tr("of the last year's takings has a cost the shop recorded")}
        </span>
      </div>

      {/*
        The assumption, said out loud and kept apart from the measurement.

        Most of this shop's tire money arrives as free text with no product row
        behind it, so it has no recorded cost and never will retrospectively.
        Those lines are now counted at the posted markup — a floor, not an
        estimate — which is what makes a margin over the whole shop possible at
        all. It is reported on its own line rather than added to the figure
        above, because a coverage number that counted a guess as a measurement
        would destroy the one thing it is for.
      */}
      {c.assumedPct > 0 && (
        <div className="flex items-baseline gap-3 flex-wrap mb-1">
          <span className="text-lg font-semibold tabular-nums text-brand-400">
            +{c.assumedPct}%
          </span>
          <span className="text-sm text-brand-400">
            {tr(
              "assumed: tires with no cost recorded, counted at the shop's posted markup and no better",
            )}
          </span>
        </div>
      )}
      <p className="text-sm text-brand-400 mb-3" style={{ maxWidth: "70ch" }}>
        {tr(
          "Gross Margin on the Reports tab is worked out only over the part that can. Below about a fifth it shows no figure at all, because a margin over a fifth of the shop is not a margin for the shop. Filling these in raises it.",
        )}{" "}
        <strong>{tr("Materials only")}</strong>{" "}
        {tr(
          "— what the job consumes. Not wages: those are a cost of opening the doors and do not change with one more repair.",
        )}
      </p>

      <button
        type="button"
        className={open ? "btn btn-primary" : "btn btn-outline"}
        style={{ height: 34, fontSize: 13 }}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? tr("Hide the list") : tr("Fill these in")}
        <span className="text-xs font-normal">
          {" · "}
          {data.services.filter((s) => s.costCents === null).length} {tr("unanswered")}
        </span>
      </button>

      {open && (
        <>
          <table className="w-full text-sm mt-3">
            <thead>
              <tr className="text-brand-300 text-xs uppercase tracking-wider">
                <th className="text-left py-2 font-medium">{tr("Service")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Times sold")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Brought in")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Sells for")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Margin %")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Costs us, each")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.services.map((s) => (
                <tr key={s.key} className="border-t border-black/5">
                  <td className="py-1.5 text-brand-500">{s.key}</td>
                  <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400">{s.lines}</td>
                  <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400">
                    {formatCents(s.revenueCents)}
                  </td>
                  <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400">
                    {formatCents(s.avgPriceCents)}
                  </td>
                  {/* Either box fills the other. What gets STORED is always the
                      cost — see the note on `pctDraft`. */}
                  <td className="py-1.5 pl-4 text-right">
                    <input
                      className="input text-right tabular-nums"
                      style={{ width: 70, height: 30 }}
                      inputMode="decimal"
                      placeholder="—"
                      value={
                        pctDraft[s.key] ??
                        (s.costCents !== null && s.avgPriceCents > 0
                          ? (((s.avgPriceCents - s.costCents) / s.avgPriceCents) * 100).toFixed(0)
                          : "")
                      }
                      onChange={(e) => {
                        setPctDraft((d) => ({ ...d, [s.key]: e.target.value }));
                        setDraft((d) => ({ ...d, [s.key]: "" }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={() => {
                        const raw = pctDraft[s.key];
                        if (raw === undefined) return;
                        const pct = Number(raw);
                        if (raw.trim() === "" || !Number.isFinite(pct)) return;
                        const cents = costFromMargin(pct, s.avgPriceCents);
                        setDraft((d) => ({ ...d, [s.key]: (cents / 100).toFixed(2) }));
                        setPctDraft((d) => {
                          const n = { ...d };
                          delete n[s.key];
                          return n;
                        });
                        void save(s.key, cents);
                      }}
                    />
                  </td>
                  <td className="py-1.5 pl-4 text-right">
                    {/* Saved on leaving the box as well as on Enter. Thirty of
                        these get filled in with a keyboard, and a row that
                        needed a button pressed as well as a number typed is a
                        row somebody skips. */}
                    <input
                      className="input text-right tabular-nums"
                      style={{ width: 90, height: 30 }}
                      inputMode="decimal"
                      placeholder="—"
                      value={draft[s.key] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void save(s.key);
                      }}
                      onBlur={() => {
                        const was = s.costCents === null ? "" : (s.costCents / 100).toFixed(2);
                        if ((draft[s.key] ?? "") !== was) void save(s.key);
                      }}
                    />
                  </td>
                  <td className="py-1.5 pl-2 text-xs text-brand-300 whitespace-nowrap">
                    {busy === s.key ? tr("Saving…") : (s.setByName ?? "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.productsMissing.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
                {tr("Tires with no cost")}
              </div>
              <p className="text-sm text-brand-400 mb-2">
                {tr(
                  "These have sold and the shop has never recorded what it paid for them. A tire's cost is set on the tire itself, in Inventory.",
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.productsMissing.slice(0, 20).map((p) => (
                  <span
                    key={p.productId}
                    className="pos-grant"
                    style={{ background: "rgba(216,68,76,0.12)", color: "#a71d24" }}
                  >
                    {p.name}
                    <em style={{ fontStyle: "normal", opacity: 0.65 }}>
                      {formatCents(p.revenueCents)}
                    </em>
                  </span>
                ))}
              </div>
              {/*
                One press for the whole list.

                Typing a cost for each of these means finding an invoice that in
                most cases no longer exists — they are tires sold years ago, or
                sizes the shop has stopped carrying. Worked back from what each
                one ACTUALLY SOLD FOR, so a \$340 tire gets a \$283 cost and a
                \$45 one gets \$37: an estimate the right size, rather than no
                margin at all on those lines forever.

                It writes to the same field somebody would type into, so a real
                invoice later is one edit — and the next receipt of that tire
                records its true cost against the lot regardless.
              */}
              <button
                type="button"
                className="btn btn-outline mt-2"
                style={{ height: 32, fontSize: 12 }}
                disabled={busy !== null}
                onClick={() => void fillProductCosts(data.productsMissing.length)}
              >
                {busy === "__fill__"
                  ? tr("Working…")
                  : `${tr("Give all of them a cost at 20% markup")} (${data.productsMissing.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
