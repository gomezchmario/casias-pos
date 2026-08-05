export const POS_ROLES = ["technician", "cashier", "manager", "owner"] as const;
export type PosRole = (typeof POS_ROLES)[number];

const RANK: Record<PosRole, number> = {
  technician: 0,
  cashier: 1,
  manager: 2,
  owner: 3,
};

export const ROLE_LABELS: Record<PosRole, string> = {
  technician: "Technician",
  cashier: "Cashier",
  manager: "Manager",
  owner: "Owner",
};

export function isPosRole(value: unknown): value is PosRole {
  return typeof value === "string" && (POS_ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(role: PosRole, minimum: PosRole): boolean {
  return RANK[role] >= RANK[minimum];
}

/**
 * Minimum role for each capability. Read this as the permission model —
 * route handlers should reference a capability, not hardcode a role.
 */
export const CAPABILITIES = {
  viewInventory: "technician",
  searchProducts: "technician",
  ringSale: "cashier",
  takePayment: "cashier",
  editSeq: "cashier",
  editOwnOpenSale: "cashier",
  // Taking money off a ticket. Two capabilities rather than one, because the
  // question "may you discount at all" and the question "may you discount
  // *this much*" have different answers: a cashier can knock a few dollars off
  // for a regular, and only a manager can decide a ticket is half price. The
  // ceiling itself is `discount_cashier_max_cents`, not a role.
  discountSale: "cashier",
  discountAnyAmount: "manager",
  // Marking a ticket as ordered in, and walking it along the board. Cashier,
  // because whoever is at the counter when the truck pulls up is who knows the
  // tire arrived — a board only a manager can move is a board that is wrong by
  // Wednesday.
  manageSpecialOrders: "cashier",
  // Moving one BACK a stage, or cancelling it. A different question: going
  // backwards means the shop already told the customer something that turned
  // out not to be true, and cancelling usually means a deposit has to go back
  // out of the drawer.
  reverseSpecialOrder: "manager",
  editCompletedSale: "manager",
  voidSale: "manager",
  refund: "manager",
  cashPurchase: "manager",
  overrideCommission: "manager",
  overrideStock: "cashier",
  receiveInventory: "manager",
  adjustInventory: "manager",
  // The day screen is the register's home page, so a cashier has to be able to
  // open it. `viewReports` stays manager-only for the figures a cashier has no
  // business seeing — what the shop paid out for stock, above all.
  viewDay: "cashier",
  // Counting down the drawer is the job of whoever is handing it over, which is
  // usually the cashier going home rather than a manager who has already left.
  closeShift: "cashier",
  // Removing a midday register log. Owner, and deliberately far above the
  // capability to take one: the whole value of a timeline of counts is that
  // nobody on the floor can quietly drop the one that came out short.
  deleteRegisterCheck: "owner",
  // Seeing what the register EXPECTS before having typed what is actually
  // there. Everyone else counts blind — see the note in the close-out page.
  // The owner is exempt because the owner is who reviews the sheet rather than
  // the person the sheet is a control on, and making them count twice to read
  // their own figures buys nothing.
  skipBlindCount: "owner",
  // Taking cash out of the till and walking it to the safe. Deliberately higher
  // than closeShift: counting money you are handing over is supervised by the
  // person you hand it to, whereas removing it is not supervised by anyone.
  drawerCash: "manager",
  viewReports: "manager",
  // What each technician individually brought in, in dollars. Separate from
  // viewReports on purpose: a manager runs the floor and needs to know who is
  // carrying the week, which the percentage share tells them. The dollar figure
  // is closer to naming what someone is paid, and the day screen is often left
  // open on a counter anyone can walk past.
  viewTechIncomeCash: "owner",
  viewCosts: "owner",
  // Tires in stock with no price, and tires priced under what they cost.
  //
  // Manager, and deliberately not cashier: both flags are statements about
  // MARGIN. "Priced below cost" tells whoever reads it that this tire can be
  // had for less than the shop paid — the exact sentence you do not want read
  // over a shoulder at the counter — and "no price" is an invitation to name
  // one. Neither ever reaches the public rack sheet.
  //
  // Separate from viewCosts (owner) on purpose. A manager sees THAT a tire is
  // underwater and what it sells for; only an owner sees the figure it cost.
  // Knowing something is priced wrong is what you need in order to fix it.
  // Knowing the shop's margin on it is a different question.
  reviewPricing: "manager",
  // The "P140" on the end of a tire name: what the shop paid, disguised as a
  // spec code so it can sit on the counter facing the customer.
  //
  // Deliberately NOT the same permission as viewCosts, and deliberately lower.
  // The two answer different questions. viewCosts is "what is this business
  // paying for stock", which is an owner's book. The code answers "how far down
  // can I go on this tire", which is the question the person actually doing the
  // haggling has to answer, at the counter, in front of the customer, now. A
  // cashier who cannot see it either sells at list or guesses.
  //
  // The gap between them is real and worth keeping: a cashier gets a rounded
  // number attached to one tire they are looking at, an owner gets every cost,
  // per lot, exportable, and the supplier it came from.
  viewCostCode: "cashier",
  // The standing note on the main screen. Manager rather than owner: it is the
  // person running the floor who knows the tire truck is late, and a notice
  // board only the absent owner can write to is a notice board nobody reads.
  writeNotice: "manager",
  managePayroll: "owner",
  manageEmployees: "owner",
  manageSettings: "owner",
  manageProducts: "manager",
  // Owner, not manager. The register grid is the shape of the shop's whole
  // pricing — change a button and every ticket rung after it is different. It
  // is also the one screen back here that nobody needs during a shift, so
  // raising it costs no one any speed.
  //
  // Kept in step with the nav on purpose: the gear tab is the only way to reach
  // this page, so a manager holding the capability but unable to see the tab
  // would make the permissions screen tell a lie about what they can do.
  manageQuickButtons: "owner",
} as const satisfies Record<string, PosRole>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: PosRole, capability: Capability): boolean {
  return roleAtLeast(role, CAPABILITIES[capability]);
}

/**
 * Plain-English names for the permissions screen, grouped the way someone
 * thinks about the shop rather than the way the code is organised.
 *
 * This lives next to CAPABILITIES on purpose. The permissions page renders
 * itself from these two together, so a capability added above without a label
 * here is a TypeScript error rather than a row that silently goes missing from
 * the screen an owner uses to decide who can touch money.
 */
export const CAPABILITY_GROUPS = [
  "At the register",
  "Fixing mistakes",
  "Stock",
  "Money and reports",
  "Setup",
] as const;
export type CapabilityGroup = (typeof CAPABILITY_GROUPS)[number];

export const CAPABILITY_INFO: Record<
  Capability,
  { label: string; group: CapabilityGroup }
> = {
  ringSale: { label: "Ring up a sale", group: "At the register" },
  takePayment: { label: "Take payment", group: "At the register" },
  editOwnOpenSale: { label: "Edit a ticket before it is paid", group: "At the register" },
  editSeq: { label: "Edit the terminal SEQ", group: "At the register" },
  viewDay: { label: "See today's tickets", group: "At the register" },
  discountSale: { label: "Take money off a ticket", group: "At the register" },
  discountAnyAmount: {
    label: "Take off more than the counter limit",
    group: "At the register",
  },

  manageSpecialOrders: {
    label: "Order a tire in, and move it along the board",
    group: "At the register",
  },
  reverseSpecialOrder: {
    label: "Move an order back a stage, or cancel it",
    group: "Fixing mistakes",
  },

  editCompletedSale: { label: "Edit a paid ticket", group: "Fixing mistakes" },
  voidSale: { label: "Void a ticket", group: "Fixing mistakes" },
  refund: { label: "Give a refund", group: "Fixing mistakes" },
  overrideCommission: { label: "Override commission", group: "Fixing mistakes" },
  closeShift: { label: "Count the drawer and close a shift", group: "Fixing mistakes" },
  deleteRegisterCheck: {
    label: "Remove a midday register log",
    group: "Money and reports",
  },
  skipBlindCount: {
    label: "See the expected totals before counting (everyone else counts blind)",
    group: "Money and reports",
  },

  drawerCash: { label: "Take cash out of the drawer (bank run, safe)", group: "Money and reports" },

  viewInventory: { label: "Look up stock", group: "Stock" },
  searchProducts: { label: "Search prices", group: "Stock" },
  overrideStock: { label: "Sell stock the system says is gone", group: "Stock" },
  receiveInventory: { label: "Receive new stock", group: "Stock" },
  adjustInventory: { label: "Adjust stock counts", group: "Stock" },
  manageProducts: { label: "Add and edit products", group: "Stock" },

  cashPurchase: { label: "Buy stock over the counter (cash out)", group: "Money and reports" },
  viewReports: { label: "See reports", group: "Money and reports" },
  viewTechIncomeCash: {
    label: "See each technician's income in dollars (not just their share)",
    group: "Money and reports",
  },
  viewCosts: { label: "See what the shop paid for stock", group: "Money and reports" },
  reviewPricing: {
    label: "See pricing warnings: in stock with no price, or priced below cost",
    group: "Stock",
  },
  viewCostCode: {
    label: "See the coded cost on tire names (the “P140”), for haggling",
    group: "Stock",
  },
  writeNotice: {
    label: "Write the note for the counter on the main screen",
    group: "At the register",
  },
  managePayroll: { label: "Run and lock payroll", group: "Money and reports" },

  manageQuickButtons: { label: "Change the register buttons", group: "Setup" },
  manageEmployees: { label: "Manage employees", group: "Setup" },
  manageSettings: { label: "Change shop settings", group: "Setup" },
};

/** Every capability a role has, in the reading order of CAPABILITY_INFO. */
export function capabilitiesFor(role: PosRole): Capability[] {
  return (Object.keys(CAPABILITY_INFO) as Capability[]).filter((c) => can(role, c));
}
