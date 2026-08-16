"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Sale } from "@/lib/sales";

/**
 * Who the ticket is for, and what they drove in.
 *
 * The shop calls this big-boy mode, and the name is the design brief: nearly
 * every ticket in this place is a $15 flat that wants none of it, and the ones
 * that do want all of it at once. A set of tires on order, a fleet account, a
 * job somebody is coming back for on Friday -- those need a name, a number and
 * enough of the car to find it in the lot, and they need it captured while the
 * customer is still standing there.
 *
 * So it is folded away by default and one tap wide. What it must never do is
 * slow down the flat.
 *
 * IT OPENS ITSELF ON THE BIG ONES. Past `customer_prompt_threshold_cents` the
 * panel is expanded already, because a $600 ticket walking out with no name on
 * it is the failure this exists to prevent, and relying on a busy cashier to
 * remember the optional step is relying on the thing that already does not
 * happen. It is only opened -- never required, never blocking -- so the answer
 * to "he would not give me his number" is still to ignore it and take the money.
 */

type Match = {
  id: number;
  name: string;
  phone: string | null;
  creditApproved: boolean;
  vehicles: {
    id: number;
    year: string | null;
    make: string | null;
    model: string | null;
    color: string | null;
    plate: string | null;
    vin: string | null;
  }[];
};

type Fields = {
  name: string;
  phone: string;
  year: string;
  make: string;
  model: string;
  color: string;
  plate: string;
  vin: string;
  po: string;
  notes: string;
};

const EMPTY: Fields = {
  name: "", phone: "", year: "", make: "", model: "", color: "", plate: "", vin: "", po: "", notes: "",
};

/** What the ticket already knows, when it is being opened on an existing one. */
export type KnownDetails = {
  customer: {
    id: number;
    name: string;
    phone: string | null;
    creditApproved: boolean;
  } | null;
  vehicle: {
    id: number;
    year: string | null;
    make: string | null;
    model: string | null;
    color: string | null;
    plate: string | null;
    vin: string | null;
  } | null;
};

export function TicketDetails({
  sale,
  thresholdCents,
  known,
  startOpen = false,
  requireCustomer = false,
  label,
  compact = true,
  tone = "grey",
  onSaved,
  onError,
}: {
  sale: Sale;
  thresholdCents: number;
  /**
   * Prefilled values, for the ticket that already has somebody on it. Omitted at
   * the register, where the ticket is seconds old and there is nothing to
   * prefill; supplied by the drawer, which is editing a ticket that may have
   * been rung last week.
   */
  known?: KnownDetails;
  startOpen?: boolean;
  /**
   * The ticket is going on the house account, so a name and a number stop
   * being optional.
   *
   * A tab is a promise to collect later, and "later" needs somebody to ring.
   * An account charge with no name on it is money the shop has given away and
   * cannot chase, so this panel opens, refuses to fold away, and says which
   * boxes have to be filled. It also carries the fleet picker, because the
   * question "whose tab is this" only exists on this tender.
   */
  requireCustomer?: boolean;
  /**
   * What the folded-up button says.
   *
   * Defaults to "Take their details", which is an instruction to a cashier with
   * a customer in front of them — right at the register, wrong everywhere else.
   * The drawer is opened on a ticket from an hour ago and nobody is standing
   * there to take anything from, so it says "Details" and leaves it at that.
   */
  label?: string;
  /**
   * Small button, or a normal one.
   *
   * Small at the register, where it sits under the ticket header among a column
   * of money and must not look like a step in taking it. Normal in the drawer,
   * where it lines up with Pay and Void and would read as broken beside them at
   * two-thirds their size.
   */
  compact?: boolean;
  /**
   * What the folded-up full-width button is coloured like.
   *
   * `grey` is the default and belongs in the ticket drawer, where this button
   * spans the panel directly above Pay: two full-width navy bars stacked on
   * each other is how somebody taking a payment hits the wrong one, and the
   * grey says "this is the other thing on this screen" from the colour alone,
   * before any of the words are read.
   *
   * `panel` paints it in the pale blue of the panel it opens, framed with the
   * same hairline, so it reads as that panel folded up rather than as a
   * separate control. Right on the register, where the thing above it is a
   * ticket rather than a payment button and there is nothing to be mistaken
   * for; wrong in the drawer, for the reason above.
   */
  tone?: "grey" | "panel";
  onSaved: (sale: Sale) => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [fields, setFields] = useState<Fields>({
    ...EMPTY,
    name: known?.customer?.name ?? "",
    phone: known?.customer?.phone ?? "",
    year: known?.vehicle?.year ?? "",
    make: known?.vehicle?.make ?? "",
    model: known?.vehicle?.model ?? "",
    color: known?.vehicle?.color ?? "",
    plate: known?.vehicle?.plate ?? "",
    vin: known?.vehicle?.vin ?? "",
    po: sale.po ?? "",
    notes: sale.notes ?? "",
  });
  /**
   * The records this ticket is already pointed at.
   *
   * Held so a second save does not create a second copy of the same person. The
   * server matches on phone and would usually find its way back to the same row
   * anyway, but "usually" is doing too much work there: a customer whose number
   * was corrected between the first save and the second would match nothing and
   * quietly fork into two records.
   */
  const [customerId, setCustomerId] = useState<number | null>(
    known?.customer?.id ?? sale.customer_id,
  );
  const [vehicleId, setVehicleId] = useState<number | null>(
    known?.vehicle?.id ?? sale.vehicle_id,
  );
  const [matches, setMatches] = useState<Match[]>([]);
  const [showMatches, setShowMatches] = useState(false);

  /**
   * Whether the shop has agreed to carry the customer now on this ticket.
   *
   * Held beside `customerId` and set from the same two places, because it is a
   * fact about that identified person — not about the name in the box. Somebody
   * typing a name by hand has not been approved for anything, and the badge must
   * not appear until a real record has been picked or loaded.
   */
  const [creditApproved, setCreditApproved] = useState(
    known?.customer?.creditApproved ?? false,
  );
  const [saved, setSaved] = useState(false);
  /** Who the ticket is billed to, and the companies it could be billed to. */
  const [billing, setBilling] = useState<{
    name: string;
    fleetId: number | null;
    fleetName: string | null;
    isFleet: boolean;
  } | null>(null);
  const [fleets, setFleets] = useState<{ id: number; name: string }[]>([]);
  const [fleetBusy, setFleetBusy] = useState(false);
  const lastSent = useRef<string>("");

  /*
    Opened for you once the ticket is big enough to regret not having a name on
    — IF the shop has asked for that. One-way: it never folds itself back up if
    a line is voided, because a panel that closes while somebody is typing in it
    is worse than one that stays.

    OFF AT THIS SHOP, and the zero is doing the work rather than this code being
    deleted. The threshold was $200, which on a counter where a set of four is
    four hundred meant the panel opened on nearly every ticket — so it read as
    "always open" and was asked to be hidden by default. It is a settings value,
    `customer_prompt_threshold_cents`, and putting a figure back in there turns
    the prompt on again at whatever size the shop decides is worth a name.

    The house-account rule below is NOT part of this and does not switch off. A
    tab is a promise to collect later and "later" needs somebody to ring.
  */
  useEffect(() => {
    if (thresholdCents > 0 && sale.subtotal_cents >= thresholdCents) setOpen(true);
  }, [sale.subtotal_cents, thresholdCents]);

  // Choosing the house account opens this and keeps it open — see
  // `requireCustomer`. One-way, like the threshold above it.
  useEffect(() => {
    if (requireCustomer) setOpen(true);
  }, [requireCustomer]);

  /** Which required boxes are still empty, for the panel to point at. */
  const missing = requireCustomer
    ? [!fields.name.trim() && "name", !fields.phone.trim() && "phone"].filter(Boolean)
    : [];

  /*
    WHOEVER IS ALREADY ON THIS TICKET, read back from the sale.

    The panel starts empty on purpose — a blank means "I did not type this",
    which is what stops the ninth visit wiping a phone number taken on the
    first. But a ticket PICKED BACK UP already points at somebody, and showing
    blank boxes while the rest of the screen bills them is how a cashier ends up
    asking why a sale with "no client" is going on a customer's tab. So the
    ticket's own customer is fetched and shown, once, and only when the boxes
    are still untouched.
  */
  useEffect(() => {
    if (!customerId) return;
    let live = true;
    void (async () => {
      const res = await fetch(`/api/pos/customers/${customerId}`);
      if (!live || !res.ok) return;
      const d = await res.json();
      // Only fills EMPTY boxes. A blank means "I did not type this", never
      // "delete what you had" — the rule the whole capture path runs on.
      setFields((f) =>
        f.name.trim()
          ? f
          : { ...f, name: d.customer.name, phone: d.customer.phone ?? f.phone },
      );
      setCreditApproved(d.customer.creditApproved === true);
      // Unconditional, unlike the prefill above. Who somebody is billed to is
      // a fact about them; whether the cashier has typed their name into this
      // box yet has nothing to do with it.
      setBilling({
        name: d.customer.name,
        fleetId: d.customer.fleetId ?? null,
        fleetName: d.fleet?.name ?? null,
        isFleet: d.customer.isFleet === true,
      });
    })();
    return () => {
      live = false;
    };
    // Runs for the TICKET, not for every keystroke — hence no `fields` here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  /** The companies, for the picker. Only fetched when the account needs it. */
  useEffect(() => {
    if (!requireCustomer || fleets.length > 0) return;
    void (async () => {
      const res = await fetch("/api/pos/fleets");
      if (res.ok) setFleets((await res.json()).fleets);
    })();
  }, [requireCustomer, fleets.length]);

  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }));

  /**
   * Look somebody up while the name or the number is being typed.
   *
   * Debounced, and only from three characters, because this fires against a
   * table of everyone the shop has ever served and the answer to "j" is not
   * worth the trip.
   */
  useEffect(() => {
    const q = fields.phone.trim().length >= 3 ? fields.phone : fields.name;
    if (q.trim().length < 3) {
      setMatches([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/pos/customers?q=${encodeURIComponent(q.trim())}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setMatches(d?.customers ?? []))
        .catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(t);
  }, [fields.name, fields.phone]);

  /**
   * Push the block to the ticket.
   *
   * On blur rather than per keystroke, same as the note it replaces: the
   * register cannot afford a round trip per character, and every path out of
   * this panel -- tapping Pay, tapping a quick button, closing the ticket --
   * blurs a field first.
   *
   * The whole block goes every time rather than a diff, because the server's
   * matching rules read all of it together: a phone number alone means one thing
   * and a phone number with a plate means another. It skips the request when
   * nothing at all has changed since the last send, which is what makes it safe
   * to call from every field's blur handler.
   */
  const save = useCallback(async () => {
    const payload = {
      customerId,
      vehicleId,
      name: fields.name.trim() || null,
      phone: fields.phone.trim() || null,
      year: fields.year.trim() || null,
      make: fields.make.trim() || null,
      model: fields.model.trim() || null,
      color: fields.color.trim() || null,
      plate: fields.plate.trim() || null,
      vin: fields.vin.trim() || null,
      po: fields.po.trim() || null,
      notes: fields.notes.trim() || null,
    };
    const body = JSON.stringify(payload);
    if (body === lastSent.current) return;

    const res = await fetch(`/api/pos/sales/${sale.id}/customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      onError(d.error || "Could not save the customer details");
      return;
    }
    lastSent.current = body;
    // The ids come back so the next save updates these rows instead of hunting
    // for them again.
    if (d.customer?.id) setCustomerId(d.customer.id);
    // Also from the save, not only from the picker: a regular is just as often
    // matched by typing their phone number as by choosing them off the list,
    // and the badge has to appear either way.
    if (d.customer) setCreditApproved(d.customer.credit_approved === 1);
    if (d.vehicle?.id) setVehicleId(d.vehicle.id);
    if (d.sale) onSaved(d.sale);
    setSaved(true);
  }, [fields, customerId, vehicleId, sale.id, onSaved, onError]);

  // The tick fades. It is an acknowledgement, not a status.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  function choose(m: Match) {
    const v = m.vehicles[0];
    setCustomerId(m.id);
    setCreditApproved(m.creditApproved);
    setVehicleId(v?.id ?? null);
    set({
      name: m.name,
      phone: m.phone ?? "",
      year: v?.year ?? "",
      make: v?.make ?? "",
      model: v?.model ?? "",
      color: v?.color ?? "",
      plate: v?.plate ?? "",
      vin: v?.vin ?? "",
    });
    setShowMatches(false);
    setMatches([]);
  }

  const field = (
    key: keyof Fields,
    placeholder: string,
    extra: { wide?: boolean; caps?: boolean; maxLength?: number } = {},
  ) => (
    <input
      className="input w-full text-sm"
      placeholder={placeholder}
      value={fields[key]}
      maxLength={extra.maxLength ?? 60}
      /* Capitalised as it is typed rather than with `text-transform`, which
         shouts at the placeholder too — the empty box read "PLATE" while every
         other one beside it read like a word. Doing it to the value instead
         also means what is on screen is exactly what gets sent. */
      onChange={(e) =>
        set({
          [key]: extra.caps ? e.target.value.toUpperCase() : e.target.value,
        } as Partial<Fields>)
      }
      onFocus={() => (key === "name" || key === "phone") && setShowMatches(true)}
      onBlur={() => {
        setShowMatches(false);
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );

  if (!open) {
    return (
      /* No top margin on either state. The gap above this panel is the
         register's to decide, and it wants almost none — see the note beside
         the ticket header. */
      <div>
        {/* A button that looks like a button, not a link.
            It used to be bare underlined text, and underlined text in this
            column means "this is a note about the thing above it" — every
            other one on the ticket does. So the one control that opens a panel
            read as a caption and got skipped, which is the whole failure this
            panel exists to prevent.

            Compact is house navy, because at the register it is one small
            control in a column of larger ones and the palette should not gain
            a colour for it.

            Full width is GREY, and that is the point of the grey. In the
            drawer this button spans the panel directly above Pay, and two
            full-width navy bars stacked on each other is how somebody taking a
            payment hits the wrong one. Grey says "this is the other thing on
            this screen" at a glance, from the colour alone, before any of the
            words are read. */}
        <button
          type="button"
          className={compact ? "btn btn-primary" : "btn w-full"}
          style={
            compact
              ? { padding: "0.3rem 0.7rem", fontSize: 12, borderRadius: 8 }
              : tone === "panel"
                ? {
                    // The panel's own fill, label colour and hairline, so the
                    // button IS the panel with the middle folded away.
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    boxShadow: "inset 0 0 0 1px rgba(37,99,235,0.18)",
                  }
                : { background: "#4b5563", color: "#fff" }
          }
          onClick={() => setOpen(true)}
        >
          {label ?? (sale.customer_id ? "Customer details" : "Take their details")}
        </button>
      </div>
    );
  }

  return (
    /* A tinted panel with its own frame, in blue.
       Every other block in this column is money — navy totals, the green
       payment button, the red one that ends a ticket owing. This one is not
       money at all, it is who the money is for, and both the colour and the
       frame are what say so. The frame matters as much as the colour: it draws
       a boundary around seven boxes that belong together, so the eye takes them
       as one thing to fill in rather than seven more fields stacked above the
       lines. */
    <div
      className="rounded-xl p-3"
      style={{ background: "#eff6ff", boxShadow: "inset 0 0 0 1px rgba(37,99,235,0.18)" }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-xs uppercase tracking-wider font-semibold"
          style={{ color: "#1d4ed8" }}
        >
          Customer &amp; vehicle
        </span>
        {saved ? (
          <span className="text-xs text-green-700">Saved</span>
        ) : requireCustomer ? (
          /* No way out while the ticket is going on a tab. Folding the panel
             away would hide the two boxes the sale is now blocked on, and the
             cashier would be left pressing a disabled button with nothing on
             screen saying why. */
          <span className="text-xs" style={{ color: "#1d4ed8" }}>
            Needed for the account
          </span>
        ) : (
          <button
            type="button"
            className="text-xs underline"
            style={{ color: "#2563eb" }}
            onClick={() => setOpen(false)}
          >
            Hide
          </button>
        )}
      </div>

      {/* What the account needs, said before the boxes rather than after a
          refusal. Two names, in the order they appear below. */}
      {requireCustomer && missing.length > 0 && (
        <div
          className="mb-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: "rgba(180,83,9,0.1)", color: "#7c3d06" }}
        >
          A tab has to be collectable later: fill in the{" "}
          <strong>{missing.join(" and the ")}</strong> before completing this sale.
        </div>
      )}

      {/*
        Said where the decision gets acted on.

        A cashier deciding whether to put a ticket on the house account has, up
        to now, had to remember whether this person is good for it — or ask, or
        guess. The flag lives on the customer, so the moment one is picked or
        loaded onto the ticket, the answer is on screen beside their name.

        Green and a star, matching the book. It is only ever shown for an
        identified customer: a name typed by hand belongs to nobody yet, and a
        badge that appeared while somebody was still typing would be approving
        whoever they happened to be halfway through spelling.
      */}
      {customerId !== null && creditApproved && (
        <div className="td-approved-row">
          <div className="td-approved">★ Store credit approved</div>
        </div>
      )}

      <div className="relative flex flex-col gap-2">
        {field("name", "Name")}
        {field("phone", "Phone")}

        {/* The lookup sits under the two fields that feed it rather than in a
            modal, because it is an offer and not a question. Somebody typing a
            new customer's details has to be able to ignore it completely and
            keep going, and a dialog would make them dismiss it first.

            mousedown, not click: the blur that saves the field fires first
            otherwise, the list unmounts under the pointer, and the tap lands on
            nothing. */}
        {showMatches && matches.length > 0 && (
          <div className="absolute left-0 right-0 top-[92px] z-20 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/10">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
              >
                <div className="font-medium text-brand-500">{m.name}</div>
                <div className="text-xs text-brand-300">
                  {[
                    m.phone,
                    m.vehicles[0] &&
                      [m.vehicles[0].year, m.vehicles[0].make, m.vehicles[0].model]
                        .filter(Boolean)
                        .join(" "),
                    m.vehicles.length > 1 ? `+${m.vehicles.length - 1} more` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-2" style={{ gridTemplateColumns: "64px 1fr 1fr" }}>
          {field("year", "Year", { maxLength: 4 })}
          {field("make", "Make")}
          {field("model", "Model")}
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {field("color", "Color")}
          {/* Caps as it is typed, because that is how it is written on the
              plate and a lookup that is case-sensitive one way and not the
              other finds nothing. */}
          {field("plate", "Plate", { caps: true, maxLength: 12 })}
        </div>
        {/* Full width: it is seventeen characters, and a box that shows nine of
            them is a box nobody can check what they typed into. Caps on the way
            in — it is read off a windscreen by somebody holding a torch. */}
        {field("vin", "VIN", { caps: true, maxLength: 24 })}
        {field("po", "P.O. number")}
        {field("notes", "Note", { maxLength: 500 })}

        {/* ── Billed to ──────────────────────────────────────────────────
            At the bottom of the details, where the rest of what is known
            about this customer lives — and only on the house account, which
            is the one tender where the question exists. A company on this
            ticket is not billed to anybody: it IS the account. */}
        {requireCustomer && !billing?.isFleet && (
          <div
            className="mt-1 rounded-lg px-3 py-2"
            style={{ background: "rgba(31,122,140,0.08)" }}
          >
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "#146070" }}>
              Billed to
            </div>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="text-brand-400">
                {billing?.name ?? fields.name.trim() ?? ""} →
              </span>
              <select
                className="input"
                style={{ height: 30, fontSize: 13, maxWidth: 200 }}
                value={billing?.fleetId ?? ""}
                // Nothing to bill to until the ticket points at a saved
                // person. The panel saves as you type, so this is a moment,
                // not a dead end — and the note underneath says so.
                disabled={fleetBusy || !customerId}
                onChange={async (e) => {
                  const fleetId = e.target.value ? Number(e.target.value) : null;
                  setFleetBusy(true);
                  const res = await fetch("/api/pos/fleets", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ customerId, fleetId }),
                  });
                  setFleetBusy(false);
                  if (!res.ok) {
                    const d = await res.json().catch(() => ({}));
                    onError(d.error || "Could not set who this is billed to");
                    return;
                  }
                  onError(null);
                  setBilling((b) =>
                    b
                      ? {
                          ...b,
                          fleetId,
                          fleetName: fleets.find((f) => f.id === fleetId)?.name ?? null,
                        }
                      : b,
                  );
                }}
              >
                <option value="">Themselves</option>
                {fleets.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            {!customerId ? (
              <div className="text-xs mt-1" style={{ color: "#146070" }}>
                Fill in the name and phone above first — then pick the company
                this driver is billed to.
              </div>
            ) : (
              billing?.fleetId != null && (
                <div className="text-xs mt-1" style={{ color: "#146070" }}>
                  This charge goes on {billing.fleetName ?? "the company"}&rsquo;s
                  account, with the driver&rsquo;s name on it.
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
