"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Where the clock may be punched, and which devices are excused.
 *
 * ONE SCREEN FOR BOTH HALVES, because they are one rule with an exception and
 * reading either alone gives the wrong impression of the shop's position. A
 * fence with six trusted devices behind it is not a fence; a page that showed
 * only the radius would never say so.
 *
 * THE FENCE IS SET FROM A READING TAKEN HERE, NOT TYPED. Whoever presses the
 * button must be standing at the shop with a phone that has real GPS. A
 * geocoded address lands on the road centreline or the wrong end of the lot,
 * and a fence built on one is fifty metres wrong before it is switched on.
 */

type Device = {
  id: number;
  label: string;
  user_agent: string | null;
  first_ip: string | null;
  enrolled_by_name: string | null;
  enrolled_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  revoked_by_name: string | null;
};

type Fence = {
  lat: string;
  lng: string;
  radiusM: string;
  setBy: string;
  setAt: string;
  trustedOnly: boolean;
  curfew: { enabled: boolean; startMinute: number; endMinute: number; allow: number[] };
  curfewCandidates: { id: number; name: string; role: string }[];
};

const toHHMM = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const fromHHMM = (v: string): number => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/** "Chrome on Android", near enough, from a string nobody should have to read. */
function browserWords(ua: string | null): string {
  if (!ua) return "unknown browser";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iOS/i.test(ua)
      ? "iPhone or iPad"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS/i.test(ua)
          ? "Mac"
          : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "browser";
  return os ? `${browser} on ${os}` : browser;
}

export default function FencePage() {
  const [fence, setFence] = useState<Fence | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [thisDevice, setThisDevice] = useState<Device | null>(null);
  const [radius, setRadius] = useState("250");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  /*
    The night rule's four pieces, held as local state so half-typed hours do
    not fire a save per keystroke — the time boxes save on blur, the ticks
    save on change, and every save posts the WHOLE rule (see the route).
  */
  const [curfewOn, setCurfewOn] = useState(false);
  const [curfewStart, setCurfewStart] = useState("20:00");
  const [curfewEnd, setCurfewEnd] = useState("06:00");
  const [curfewAllow, setCurfewAllow] = useState<number[]>([]);

  const load = useCallback(async () => {
    const [f, d] = await Promise.all([
      fetch("/api/admin/fence").then((r) => r.json()),
      fetch("/api/admin/devices").then((r) => r.json()),
    ]);
    setFence(f);
    setRadius(f.radiusM || "250");
    setDevices(d.devices ?? []);
    setThisDevice(d.thisDevice ?? null);
    if (f.curfew) {
      setCurfewOn(f.curfew.enabled);
      setCurfewStart(toHHMM(f.curfew.startMinute));
      setCurfewEnd(toHHMM(f.curfew.endMinute));
      setCurfewAllow(f.curfew.allow);
    }
  }, []);

  /** Post the whole night rule, with any piece overridden by the caller. */
  async function saveCurfew(over: { enabled?: boolean; allow?: number[] }) {
    setBusy(true);
    setError(null);
    setSaid(null);
    const res = await fetch("/api/admin/curfew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: over.enabled ?? curfewOn,
        startMinute: fromHHMM(curfewStart),
        endMinute: fromHHMM(curfewEnd),
        allow: over.allow ?? curfewAllow,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save the night rule");
      void load();
      return;
    }
    setSaid("The night rule is saved.");
    void load();
  }

  useEffect(() => {
    void load();
  }, [load]);

  /** Ask this browser where it is, then store that as the shop. */
  async function setFromHere() {
    setError(null);
    setSaid(null);
    if (!navigator.geolocation) {
      setError("This browser cannot tell us where it is. Try a phone.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const res = await fetch("/api/admin/fence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            radiusM: Number(radius),
          }),
        });
        setBusy(false);
        if (!res.ok) {
          setError((await res.json().catch(() => ({}))).error || "Could not save the fence");
          return;
        }
        setSaid(
          `Fence set where you are standing, accurate to about ${Math.round(pos.coords.accuracy)} m.`,
        );
        void load();
      },
      (err) => {
        setBusy(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "This browser refused to share its location. Allow location for this site and press it again."
            : "Could not get a location fix. Step outside and try again.",
        );
      },
      // A real fix, not the cached one from an hour ago in another part of
      // town — the whole value of this button is that it is taken here, now.
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function saveRadius() {
    if (!fence?.lat) return;
    setBusy(true);
    const res = await fetch("/api/admin/fence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: Number(fence.lat),
        lng: Number(fence.lng),
        radiusM: Number(radius),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save");
      return;
    }
    setSaid("Radius saved.");
    void load();
  }

  async function clearFence() {
    if (
      !window.confirm(
        "Take the fence down? Anybody with a PIN will be able to clock in from anywhere.",
      )
    )
      return;
    setBusy(true);
    await fetch("/api/admin/fence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });
    setBusy(false);
    setSaid("Fence taken down. Every punch is allowed from anywhere.");
    void load();
  }

  async function toggleTrustedOnly(on: boolean) {
    setBusy(true);
    setError(null);
    setSaid(null);
    const res = await fetch("/api/admin/fence", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trustedOnly: on }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not change that");
      return;
    }
    setSaid(
      on
        ? "Only trusted devices can punch the clock now. Everything else is refused, wherever it is."
        : "Untrusted devices can clock in again from inside the fence.",
    );
    void load();
  }

  async function trustThis() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not trust this device");
      return;
    }
    setLabel("");
    setSaid("This device is trusted. It can punch the clock from anywhere.");
    void load();
  }

  async function revoke(id: number, name: string) {
    if (!window.confirm(`Stop trusting "${name}"? It will have to be inside the fence again.`))
      return;
    setBusy(true);
    await fetch("/api/admin/devices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(false);
    void load();
  }

  const live = devices.filter((d) => !d.revoked_at);
  const gone = devices.filter((d) => d.revoked_at);
  const hasFence = !!fence?.lat;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-brand-500 mb-1">Where the clock can be punched</h1>
      {/* The one line that states the shop's actual rule, which is not the same
          sentence in the two modes — and a page that described the fence while
          the strict box was ticked would be quietly wrong about the thing it
          exists to explain. */}
      <p className="text-brand-400 text-sm mb-5">
        {fence?.trustedOnly
          ? "Only the devices you trust here can punch the clock. Everything else is refused, wherever it is standing."
          : "Everybody has to be at the shop to clock in — except the devices you trust here, which can punch from anywhere."}
      </p>

      {error && <div className="alert alert-error mb-4">{error}</div>}
      {said && <div className="alert alert-success mb-4">{said}</div>}

      {/* ── Trusted-only: the strict setting, first because it overrides ──
          the fence below and reading them the other way round leaves the
          wrong impression of what the shop's rule actually is. */}
      <section className="card p-4 mb-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={!!fence?.trustedOnly}
            disabled={busy || (live.length === 0 && !fence?.trustedOnly)}
            onChange={(e) => void toggleTrustedOnly(e.target.checked)}
          />
          <span>
            <span className="font-semibold">Only trusted devices may clock in</span>
            <span className="block text-sm text-brand-400 mt-0.5">
              The strictest setting. A phone that has not been set up here cannot punch the clock
              at all — not even standing in the shop — and the fence below stops mattering.
            </span>
            {live.length === 0 && !fence?.trustedOnly && (
              <span className="block text-xs mt-1" style={{ color: "#b45309" }}>
                Trust a device below first. With none trusted, this would lock everybody out.
              </span>
            )}
          </span>
        </label>
      </section>

      {/* ── The fence ────────────────────────────────────────────────────── */}
      <section className={`card p-4 mb-5${fence?.trustedOnly ? " opacity-60" : ""}`}>
        <h2 className="font-semibold mb-2">
          The fence
          {fence?.trustedOnly && (
            <span className="text-xs font-normal text-brand-400"> · not in use while the box above is ticked</span>
          )}
        </h2>
        {hasFence ? (
          <p className="text-sm text-brand-400 mb-3">
            Set at {Number(fence!.lat).toFixed(5)}, {Number(fence!.lng).toFixed(5)} — anybody within{" "}
            <strong>{fence!.radiusM} m</strong> of that spot may clock in.
            {fence!.setBy && (
              <>
                {" "}
                Put there by {fence!.setBy}
                {fence!.setAt ? ` on ${fence!.setAt.slice(0, 10)}` : ""}.
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-brand-400 mb-3">
            No fence yet, so the clock can be punched from anywhere. Stand at the shop, on a phone,
            and press the button below.
          </p>
        )}

        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-sm">
            How far out, in metres
            <input
              className="input mt-1 w-32"
              inputMode="numeric"
              value={radius}
              onChange={(e) => setRadius(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void setFromHere()}>
            Set the fence from where I&apos;m standing
          </button>
          {hasFence && (
            <>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void saveRadius()}>
                Save the radius only
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void clearFence()}>
                Take the fence down
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-brand-400 mt-3">
          Press it on a phone, standing in the lot. A phone knows where it is to within a few
          metres; a desktop computer guesses from the internet connection and can be a mile out.
          250 m is a good starting radius — tight enough to exclude somebody at home, loose enough
          that a phone indoors still counts.
        </p>
      </section>

      {/* ── The devices excused from it ──────────────────────────────────── */}
      <section className="card p-4">
        <h2 className="font-semibold mb-2">Devices that skip the fence</h2>

        {thisDevice && !thisDevice.revoked_at ? (
          <p className="text-sm mb-3" style={{ color: "#15803d" }}>
            ✓ This device is trusted — enrolled as “{thisDevice.label}”.
          </p>
        ) : (
          <div className="flex items-end gap-3 flex-wrap mb-3">
            <label className="text-sm">
              What is this device?
              <input
                className="input mt-1"
                placeholder="Counter tablet"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void trustThis()}>
              Trust this device
            </button>
          </div>
        )}
        <p className="text-xs text-brand-400 mb-4">
          Trusting works on the device you are holding — open this page on the tablet or phone you
          want to trust, then press the button. Clearing the browser&apos;s data undoes it, and it
          has to be done again.
        </p>

        {live.length === 0 ? (
          <p className="text-sm text-brand-400">No trusted devices. Everybody has to be at the shop.</p>
        ) : (
          <table className="table w-full text-sm">
            <thead>
              <tr>
                <th>Device</th>
                <th>Browser</th>
                <th>Trusted</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {live.map((d) => (
                <tr key={d.id}>
                  <td>{d.label}</td>
                  <td className="text-brand-400">{browserWords(d.user_agent)}</td>
                  <td className="text-brand-400">
                    {d.enrolled_at.slice(0, 10)}
                    {d.enrolled_by_name ? ` by ${d.enrolled_by_name}` : ""}
                  </td>
                  <td className="text-brand-400">{d.last_seen_at?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void revoke(d.id, d.label)}
                    >
                      Stop trusting
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Kept visible rather than deleted: "which device was this and when did
            we stop trusting it" is the question asked after a phone walks out. */}
        {gone.length > 0 && (
          <details className="mt-4">
            <summary className="text-sm text-brand-400 cursor-pointer">
              {gone.length} no longer trusted
            </summary>
            <ul className="text-xs text-brand-400 mt-2 space-y-1">
              {gone.map((d) => (
                <li key={d.id}>
                  {d.label} — stopped {d.revoked_at?.slice(0, 10)}
                  {d.revoked_by_name ? ` by ${d.revoked_by_name}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ── The register at night ──────────────────────────────────────────
          On this page rather than with the money settings, because it is the
          fence's sibling: the fence says WHERE a register session may start,
          this says WHEN and for WHOM. One page for "who can open what, and
          under what condition" is one place to look when somebody is locked
          out and should not be. */}
      {fence?.curfew && (
        <section className="card p-4 mt-5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={curfewOn}
              disabled={busy}
              onChange={(e) => {
                setCurfewOn(e.target.checked);
                void saveCurfew({ enabled: e.target.checked });
              }}
            />
            <span>
              <span className="font-semibold">Close the register at night</span>
              <span className="block text-sm text-brand-400 mt-0.5">
                Between the hours below, only the owner and the people ticked here can open the
                register — from any device, trusted or not, at the shop or away. Sessions already
                open keep working until they lock themselves; this is a rule about the door, not a
                trap for a half-rung ticket.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-3 flex-wrap mt-4">
            <label className="text-sm text-brand-400">
              From
              <input
                type="time"
                className="input block mt-1"
                style={{ height: 36 }}
                value={curfewStart}
                disabled={busy}
                onChange={(e) => setCurfewStart(e.target.value)}
                onBlur={() => void saveCurfew({})}
              />
            </label>
            <label className="text-sm text-brand-400">
              to
              <input
                type="time"
                className="input block mt-1"
                style={{ height: 36 }}
                value={curfewEnd}
                disabled={busy}
                onChange={(e) => setCurfewEnd(e.target.value)}
                onBlur={() => void saveCurfew({})}
              />
            </label>
            <span className="text-xs text-brand-300 mt-4">
              8 PM to 6 AM is written 20:00 to 06:00 — the window is meant to cross midnight.
            </span>
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium text-brand-500 mb-1.5">
              Allowed through it
              <span className="text-brand-300 font-normal"> — the owner always is</span>
            </div>
            <div className="flex gap-x-5 gap-y-1.5 flex-wrap">
              {fence.curfewCandidates.map((c) => (
                <label key={c.id} className="text-sm text-brand-400 flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={curfewAllow.includes(c.id)}
                    disabled={busy}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...curfewAllow, c.id]
                        : curfewAllow.filter((x) => x !== c.id);
                      setCurfewAllow(next);
                      void saveCurfew({ allow: next });
                    }}
                  />
                  {c.name}
                  <span className="text-xs text-brand-300">{c.role}</span>
                </label>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
