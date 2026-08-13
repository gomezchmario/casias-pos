"use client";

import { useCallback, useEffect, useState } from "react";
import { use } from "react";
import { formatCents } from "@/lib/money";
import type { DirProfile, DirDriver } from "@/lib/directory";

/**
 * A company's own page.
 *
 * The whole screen is one of two things: the gate, or the profile. There is no
 * navigation off it, no link back into the shop's system, and nothing that
 * moves money — see the rules at the top of `src/lib/directory.ts`, which are
 * enforced on the server and merely reflected here.
 *
 * Which of the two shows is decided by asking the server for the profile, not
 * by looking at a cookie: the client cannot tell a live session from an expired
 * one, and a page that guessed would show an empty account to somebody whose
 * session had simply run out.
 */
export default function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [profile, setProfile] = useState<DirProfile | null>(null);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/dir/profile");
    setProfile(res.ok ? (await res.json()).profile : null);
    setChecked(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!checked) return <div className="dir-gate" />;
  if (!profile) return <Gate slug={slug} onIn={() => void load()} />;
  return <Profile profile={profile} onChanged={() => void load()} />;
}

/* ─────────────────────────────────────────────────────────────────────────
   The gate
   ───────────────────────────────────────────────────────────────────────── */

function Gate({ slug, onIn }: { slug: string; onIn: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (pin.length !== 4) return;
    setBusy(true);
    const res = await fetch(`/api/dir/${slug}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "That code does not open this page.");
      setPin("");
      return;
    }
    onIn();
  }

  return (
    <div className="dir-gate">
      <div className="dir-gate-box">
        {/*
          The company's name is deliberately NOT shown before the code is
          typed. The address is derived from the name and so is guessable, and
          a page that confirmed "yes, this is Williams Insulation's account"
          to anybody who typed the address would hand out the one fact the
          code exists to protect: which companies the shop carries on account.
        */}
        <h1>Casias Tire &amp; Muffler</h1>
        <p>Type the four-letter code we gave you to open your account.</p>

        <input
          autoFocus
          maxLength={4}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          aria-label="Four-letter code"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase());
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button type="button" onClick={() => void submit()} disabled={busy || pin.length !== 4}>
          {busy ? "Checking…" : "Open my account"}
        </button>

        {error && <div className="dir-gate-err">{error}</div>}

        <div className="dir-gate-shop">
          Lost the code? Call the shop on (210) 543-0909 and we will set a new one.
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   The profile
   ───────────────────────────────────────────────────────────────────────── */

type Tab = "account" | "drivers";

function Profile({ profile, onChanged }: { profile: DirProfile; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("account");
  const [error, setError] = useState<string | null>(null);

  const owing = profile.balanceCents > 0;

  async function signOut() {
    await fetch("/api/dir/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <main className="dir-portal">
      <header className="dir-portal-head">
        <div>
          <span className="dir-label">Account</span>
          <h1>{profile.company.name}</h1>
          {profile.company.phone && <div className="dir-sub">{profile.company.phone}</div>}
        </div>
        <div className={`dir-balance ${owing ? "owing" : "clear"}`}>
          <strong>{formatCents(Math.abs(profile.balanceCents))}</strong>
          <small>
            {profile.balanceCents > 0
              ? "outstanding"
              : profile.balanceCents < 0
                ? "in credit"
                : "nothing outstanding"}
          </small>
        </div>
      </header>

      {error && <div className="dir-portal-error">{error}</div>}

      <div className="dir-tabs">
        <button
          type="button"
          className="dir-tab"
          aria-pressed={tab === "account"}
          onClick={() => setTab("account")}
        >
          What we billed
        </button>
        <button
          type="button"
          className="dir-tab"
          aria-pressed={tab === "drivers"}
          onClick={() => setTab("drivers")}
        >
          Drivers &amp; vehicles
        </button>
      </div>

      {tab === "account" ? (
        <AccountTab profile={profile} />
      ) : (
        <DriversTab profile={profile} onChanged={onChanged} onError={setError} />
      )}

      <footer className="dir-foot">
        <span>Casias Tire &amp; Muffler · 8715 Grissom Rd, San Antonio TX 78251 · (210) 543-0909</span>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </footer>
    </main>
  );
}

function AccountTab({ profile }: { profile: DirProfile }) {
  return (
    <>
      <section className="dir-section">
        <h2>Work charged to the account</h2>
        <p className="dir-section-note">
          Every ticket billed to {profile.company.name}, newest last, with the driver and the
          vehicle it was done on.
        </p>
        {profile.charges.length === 0 ? (
          <p className="dir-sub">Nothing charged yet.</p>
        ) : (
          <div className="dir-scroll">
            <table className="dir-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Date</th>
                  <th>Driver</th>
                  <th>What was done</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {profile.charges.map((c) => (
                  <tr key={c.saleId}>
                    <td>{c.saleNo}</td>
                    <td className="num">{c.businessDate}</td>
                    <td>{c.driverName ?? "—"}</td>
                    <td>
                      {c.what ?? "—"}
                      {c.vehicle && <div className="dir-sub">{c.vehicle}</div>}
                    </td>
                    <td className="num">{formatCents(c.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dir-section">
        <h2>Payments received</h2>
        {profile.payments.length === 0 ? (
          <p className="dir-sub">No payments recorded yet.</p>
        ) : (
          <div className="dir-scroll">
            <table className="dir-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>How</th>
                  <th>Note</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {profile.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{p.businessDate}</td>
                    <td>{p.how ?? "—"}</td>
                    <td>{p.note ?? "—"}</td>
                    <td className="num">{formatCents(p.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/*
        Said plainly rather than left to be discovered by somebody hunting for
        a Pay button that does not exist. A company reading a figure it
        disagrees with should reach for the phone, and this is the line that
        tells it to.
      */}
      <div className="dir-money-note">
        These figures are the shop&rsquo;s own books and can only be changed here at the counter.
        If something does not look right, call us on (210) 543-0909 and we will go through it
        with you.
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Drivers and vehicles — the only part they can change
   ───────────────────────────────────────────────────────────────────────── */

function DriversTab({
  profile,
  onChanged,
  onError,
}: {
  profile: DirProfile;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [addingDriver, setAddingDriver] = useState(false);

  return (
    <>
      <section className="dir-section">
        <h2>Your drivers</h2>
        <p className="dir-section-note">
          Keep these right and every ticket we ring reaches the correct name and truck. Adding a
          VIN is the single most useful thing here — two white F-250s on one account are one
          description and two vehicles, and the VIN is what tells them apart.
        </p>

        {profile.drivers.length === 0 && profile.ownVehicles.length === 0 && (
          <p className="dir-sub">No drivers on the account yet.</p>
        )}

        {profile.drivers.map((d) => (
          <DriverBlock key={d.id} driver={d} onChanged={onChanged} onError={onError} />
        ))}

        {addingDriver ? (
          <DriverForm
            onCancel={() => setAddingDriver(false)}
            onSave={async (body) => {
              const res = await fetch("/api/dir/drivers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              if (!res.ok) {
                onError((await res.json().catch(() => ({}))).error ?? "Could not add the driver");
                return false;
              }
              onError(null);
              setAddingDriver(false);
              onChanged();
              return true;
            }}
          />
        ) : (
          <div className="dir-form-actions" style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={() => setAddingDriver(true)}>
              Add a driver
            </button>
          </div>
        )}
      </section>

      {profile.ownVehicles.length > 0 && (
        <section className="dir-section">
          <h2>Vehicles on the company itself</h2>
          <p className="dir-section-note">
            Rung on {profile.company.name} rather than on a named driver.
          </p>
          <CarList
            cars={profile.ownVehicles}
            ownerId={profile.company.id}
            onChanged={onChanged}
            onError={onError}
          />
        </section>
      )}
    </>
  );
}

function DriverBlock({
  driver,
  onChanged,
  onError,
}: {
  driver: DirDriver;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="dir-driver">
      <div className="dir-driver-top">
        <div>
          <span className="dir-driver-name">{driver.name}</span>
          {driver.phone && <span className="dir-sub"> · {driver.phone}</span>}
        </div>
        <div className="dir-sub">
          {formatCents(driver.chargedCents)} charged
          {driver.lastVisit && ` · last in ${driver.lastVisit}`}
        </div>
      </div>

      {editing ? (
        <DriverForm
          initial={driver}
          onCancel={() => setEditing(false)}
          onSave={async (body) => {
            const res = await fetch(`/api/dir/drivers/${driver.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.ok) {
              onError((await res.json().catch(() => ({}))).error ?? "Could not save");
              return false;
            }
            onError(null);
            setEditing(false);
            onChanged();
            return true;
          }}
        />
      ) : (
        <div className="dir-form-actions" style={{ marginTop: "0.35rem" }}>
          <button type="button" onClick={() => setEditing(true)}>
            Edit name or phone
          </button>
        </div>
      )}

      <CarList
        cars={driver.vehicles}
        ownerId={driver.id}
        onChanged={onChanged}
        onError={onError}
      />
    </div>
  );
}

function DriverForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; phone: string | null };
  onSave: (body: { name: string; phone: string }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="dir-form">
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
      </label>
      <div className="dir-form-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="dir-primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            await onSave({ name, phone });
            setBusy(false);
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

type Car = DirDriver["vehicles"][number];

function CarList({
  cars,
  ownerId,
  onChanged,
  onError,
}: {
  cars: Car[];
  ownerId: number;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <>
      {cars.length === 0 ? (
        <div className="dir-car-none">No vehicles recorded.</div>
      ) : (
        <div className="dir-cars">
          {cars.map((c) =>
            editing === c.id ? (
              <CarForm
                key={c.id}
                initial={c}
                onCancel={() => setEditing(null)}
                onSave={async (body) => {
                  const res = await fetch(`/api/dir/vehicles/${c.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  });
                  if (!res.ok) {
                    onError((await res.json().catch(() => ({}))).error ?? "Could not save");
                    return false;
                  }
                  onError(null);
                  setEditing(null);
                  onChanged();
                  return true;
                }}
              />
            ) : (
              <div className="dir-car" key={c.id}>
                <div>
                  {c.label || "Vehicle"}
                  <div className="dir-sub">
                    {c.vin ? `VIN ${c.vin}` : "No VIN recorded"}
                    {c.tire_size && ` · ${c.tire_size}`}
                  </div>
                </div>
                <button type="button" onClick={() => setEditing(c.id)}>
                  Edit
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {adding ? (
        <CarForm
          onCancel={() => setAdding(false)}
          onSave={async (body) => {
            const res = await fetch("/api/dir/vehicles", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...body, ownerId }),
            });
            if (!res.ok) {
              onError((await res.json().catch(() => ({}))).error ?? "Could not add the vehicle");
              return false;
            }
            onError(null);
            setAdding(false);
            onChanged();
            return true;
          }}
        />
      ) : (
        <div className="dir-form-actions" style={{ marginTop: "0.4rem" }}>
          <button type="button" onClick={() => setAdding(true)}>
            Add a vehicle
          </button>
        </div>
      )}
    </>
  );
}

function CarForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Car;
  onSave: (body: Record<string, string>) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    year: initial?.year ?? "",
    make: initial?.make ?? "",
    model: initial?.model ?? "",
    color: initial?.color ?? "",
    plate: initial?.plate ?? "",
    vin: initial?.vin ?? "",
    tireSize: initial?.tire_size ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="dir-form">
      <label>
        Year
        <input value={f.year} onChange={set("year")} inputMode="numeric" />
      </label>
      <label>
        Make
        <input value={f.make} onChange={set("make")} />
      </label>
      <label>
        Model
        <input value={f.model} onChange={set("model")} />
      </label>
      <label>
        Colour
        <input value={f.color} onChange={set("color")} />
      </label>
      <label>
        Plate
        <input value={f.plate} onChange={set("plate")} />
      </label>
      <label>
        Tire size
        <input value={f.tireSize} onChange={set("tireSize")} placeholder="265-70-17" />
      </label>
      {/*
        Full width: seventeen characters in a half-width box is a box nobody can
        check what they typed into, and a VIN nobody checks is worse than none.
      */}
      <label className="dir-form-wide">
        VIN
        <input
          value={f.vin}
          onChange={(e) => setF((p) => ({ ...p, vin: e.target.value.toUpperCase() }))}
          maxLength={17}
          placeholder="1FTFW1E50MFA12345"
          spellCheck={false}
        />
      </label>
      <div className="dir-form-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="dir-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(f);
            setBusy(false);
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
