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
  vehicles: {
    id: number;
    year: string | null;
    make: string | null;
    model: string | null;
    color: string | null;
    plate: string | null;
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
  po: string;
  notes: string;
};

const EMPTY: Fields = {
  name: "", phone: "", year: "", make: "", model: "", color: "", plate: "", po: "", notes: "",
};

/** What the ticket already knows, when it is being opened on an existing one. */
export type KnownDetails = {
  customer: { id: number; name: string; phone: string | null } | null;
  vehicle: {
    id: number;
    year: string | null;
    make: string | null;
    model: string | null;
    color: string | null;
    plate: string | null;
  } | null;
};

export function TicketDetails({
  sale,
  thresholdCents,
  known,
  startOpen = false,
  label,
  compact = true,
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
  const [saved, setSaved] = useState(false);
  const lastSent = useRef<string>("");

  // Opened for you once the ticket is big enough to regret not having a name on.
  // One-way: it never folds itself back up if a line is voided, because a panel
  // that closes while somebody is typing in it is worse than one that stays.
  useEffect(() => {
    if (thresholdCents > 0 && sale.subtotal_cents >= thresholdCents) setOpen(true);
  }, [sale.subtotal_cents, thresholdCents]);

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
    setVehicleId(v?.id ?? null);
    set({
      name: m.name,
      phone: m.phone ?? "",
      year: v?.year ?? "",
      make: v?.make ?? "",
      model: v?.model ?? "",
      color: v?.color ?? "",
      plate: v?.plate ?? "",
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
        {field("po", "P.O. number")}
        {field("notes", "Note", { maxLength: 500 })}
      </div>
    </div>
  );
}
