"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/money";
import type { DirectoryRow } from "@/lib/directory";

/**
 * The shop's index of company pages: who has one, what their address is, and
 * the button that hands them a code.
 *
 * Deliberately outside the POS shell — no nav bar, no back button, no link from
 * anywhere except one line of small text at the foot of the customer book. This
 * screen mints the credential that opens a company's balance from outside the
 * building, and it should be somewhere you go on purpose rather than somewhere
 * you arrive while looking for something else.
 *
 * Its only gate is `/api/pos/directory`, which requires `manageDirectory` —
 * owner and accountant, not manager. There is no client-side check here on
 * purpose: a page that hid itself would still be a page, and the answer to
 * "who may read this" belongs in one place, on the server.
 */
export default function DirectoryPage() {
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [pins, setPins] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/directory");
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not open the directory");
      setRows([]);
      return;
    }
    const d = await res.json();
    setRows(d.rows);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const linkFor = (slug: string) =>
    typeof window === "undefined" ? `/dir/${slug}` : `${window.location.origin}/dir/${slug}`;

  async function copyLink(row: DirectoryRow) {
    const url = linkFor(row.slug);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /*
        The clipboard is refused outside a secure context and on some phone
        browsers, and a copy button that silently does nothing is worse than no
        button. Falling back to selecting the text means the keyboard shortcut
        still works, which is what somebody will reach for next.
      */
      const box = document.getElementById(`dir-url-${row.id}`) as HTMLInputElement | null;
      box?.select();
      setNote("Press Ctrl+C — this browser would not let the button copy");
    }
    setCopied(row.id);
    setTimeout(() => setCopied((c) => (c === row.id ? null : c)), 1600);
  }

  async function savePin(row: DirectoryRow) {
    const pin = (pins[row.id] ?? "").trim();
    if (!/^[A-Za-z]{4}$/.test(pin)) {
      setError("The code is four letters — no numbers, no spaces");
      return;
    }
    setBusy(row.id);
    const res = await fetch(`/api/pos/directory/${row.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not set the code");
      return;
    }
    setPins((p) => ({ ...p, [row.id]: "" }));
    setNote(
      `${row.name} can now open their page with that code. Anybody who was signed in has been signed out.`,
    );
    setError(null);
    void load();
  }

  async function closePage(row: DirectoryRow) {
    if (!confirm(`Close ${row.name}'s page? Their link will stop opening.`)) return;
    setBusy(row.id);
    await fetch(`/api/pos/directory/${row.id}`, { method: "DELETE" });
    setBusy(null);
    setNote(`${row.name}'s page is closed.`);
    void load();
  }

  async function signOut(row: DirectoryRow) {
    setBusy(row.id);
    const res = await fetch(`/api/pos/directory/${row.id}`, { method: "PATCH" });
    setBusy(null);
    const d = await res.json().catch(() => ({}));
    setNote(
      d.ended
        ? `Signed ${row.name} out of ${d.ended} ${d.ended === 1 ? "device" : "devices"}. The code still works.`
        : `${row.name} was not signed in anywhere.`,
    );
    void load();
  }

  return (
    <main className="dir-admin">
      <header className="dir-admin-head">
        <h1>Directory</h1>
        <p>
          Each company can have its own page showing what it owes, its drivers and its
          trucks. Send the link, read the code down the phone. They can correct their
          drivers and vehicles there; they cannot touch a figure.
        </p>
        <Link href="/pos/customers" className="dir-admin-back">
          ← Back to customers
        </Link>
      </header>

      {error && <div className="dir-admin-error">{error}</div>}
      {note && (
        <div className="dir-admin-note" onClick={() => setNote(null)}>
          {note}
        </div>
      )}

      {/*
        The refusal and the empty list are different answers and must not share
        a sentence. Before this, an unsigned-in visitor was told "no companies
        in the book yet" — an outright false statement about the shop's data,
        produced by a permission problem. An empty list only means empty when
        the request actually succeeded.
      */}
      {rows === null ? (
        <p className="dir-admin-quiet">Reading the book…</p>
      ) : error ? null : rows.length === 0 ? (
        <p className="dir-admin-quiet">No companies in the book yet.</p>
      ) : (
        <div className="dir-admin-list">
          {rows.map((r) => (
            <section key={r.id} className="dir-card">
              <div className="dir-card-top">
                <div>
                  <h2>{r.name}</h2>
                  <div className="dir-card-sub">
                    {r.customerNo} · {r.drivers} {r.drivers === 1 ? "driver" : "drivers"}
                    {r.hasPin && r.liveSessions > 0 && (
                      <>
                        {" · "}
                        <span className="dir-live">
                          signed in on {r.liveSessions}{" "}
                          {r.liveSessions === 1 ? "device" : "devices"}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="dir-card-owed">
                  <span>{formatCents(r.balanceCents)}</span>
                  <small>owed</small>
                </div>
              </div>

              <label className="dir-url-row">
                <span className="dir-label">Their link</span>
                <input
                  id={`dir-url-${r.id}`}
                  readOnly
                  value={linkFor(r.slug)}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" onClick={() => void copyLink(r)}>
                  {copied === r.id ? "Copied" : "Copy"}
                </button>
              </label>

              <div className="dir-pin-row">
                <label className="dir-label" htmlFor={`dir-pin-${r.id}`}>
                  {r.hasPin ? "New code" : "Code"}
                </label>
                <input
                  id={`dir-pin-${r.id}`}
                  className="dir-pin"
                  maxLength={4}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABCD"
                  value={pins[r.id] ?? ""}
                  onChange={(e) =>
                    setPins((p) => ({
                      ...p,
                      [r.id]: e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase(),
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void savePin(r);
                  }}
                />
                <button
                  type="button"
                  className="dir-primary"
                  disabled={busy === r.id}
                  onClick={() => void savePin(r)}
                >
                  {r.hasPin ? "Replace" : "Set"}
                </button>

                {r.hasPin && (
                  <>
                    <button type="button" onClick={() => void signOut(r)} disabled={busy === r.id}>
                      Sign out
                    </button>
                    <button
                      type="button"
                      className="dir-danger"
                      onClick={() => void closePage(r)}
                      disabled={busy === r.id}
                    >
                      Close page
                    </button>
                  </>
                )}
              </div>

              <div className="dir-card-foot">
                {r.hasPin ? (
                  <>
                    {/*
                      The code itself is never shown, here or anywhere. It is
                      stored the same way an employee PIN is — hashed — so a
                      forgotten code cannot be looked up and the only repair is
                      to set a new one. Saying so on the card is what stops
                      somebody hunting for a screen that shows it.
                    */}
                    Code set {r.pinSetAt?.slice(0, 10)}
                    {r.pinSetBy && ` by ${r.pinSetBy}`}. It is not stored anywhere it can be
                    read back — if they forget it, set a new one.
                    {r.lastVisit && ` Last opened ${r.lastVisit.slice(0, 16)}.`}
                  </>
                ) : (
                  <>No code yet — this link opens nothing until you set one.</>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
