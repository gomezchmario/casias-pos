export const POS_ROLES = [
  "technician",
  "writer",
  "cashier",
  "accountant",
  "manager",
  "owner",
] as const;
export type PosRole = (typeof POS_ROLES)[number];

/**
 * The ladder. Three roles share rung 1, which is the point of it.
 *
 * A service writer is not a lesser cashier and not a greater technician — he is
 * a cashier who works outside. He rings the same tickets, takes the same money
 * when he has to, and simply has no business in the day's books. Ranking him
 * below a cashier would have meant dragging every capability he needs down a
 * rung, which hands them to technicians as well; ranking him above would be a
 * lie about seniority. So he sits level and gives things up by name — see
 * `WITHHELD`.
 *
 * The accountant is the same shape pointing the other way. She keeps the
 * customer book and the house accounts, which is manager and owner work
 * everywhere else, and has no more business at the register than a cashier
 * does. Promoting her to manager to reach the customer book would hand her
 * voids, refunds and the close-out on the way past. So she sits at rung 1 and
 * takes what she needs by name — see `GRANTED`.
 */
const RANK: Record<PosRole, number> = {
  technician: 0,
  writer: 1,
  cashier: 1,
  accountant: 1,
  manager: 2,
  owner: 3,
};

export const ROLE_LABELS: Record<PosRole, string> = {
  technician: "Technician",
  writer: "Service Writer",
  cashier: "Cashier",
  accountant: "Accountant",
  manager: "Manager",
  owner: "Owner",
};

/**
 * Capabilities a role does NOT get, whatever its rank says.
 *
 * The permission model was a pure ladder until this, and a ladder can only say
 * "at least a cashier". That is the right shape for nearly everything and the
 * wrong shape for a job that is sideways rather than lower: the service writer
 * needs the register and does not need the books, and there is no rung that
 * describes that.
 *
 * Deliberately a short list of exceptions rather than a full per-role matrix.
 * A matrix would be five columns of forty rows that nobody could hold in their
 * head, and the first thing to go wrong with one is a capability quietly
 * granted to somebody because a cell defaulted the wrong way. This way the
 * ladder still says what everyone can do, and the exceptions are few enough to
 * read in one go and each carry the reason they exist.
 */
const WITHHELD: Partial<Record<PosRole, readonly Capability[]>> = {
  writer: [
    // The day's ledger and the close-out. He is outside at the vehicles; the
    // takings are not his job and putting them on his screen is putting the
    // shop's numbers on a device that spends the day in the forecourt.
    "viewLog",
    "closeShift",
    "viewReports",
  ],
};

/**
 * Capabilities a role gets that its rank does not reach.
 *
 * The mirror of `WITHHELD`, and it exists for the accountant. She works at
 * cashier rank and needs four things that live at manager and owner: the
 * customer book, the cars in it, the right to remove either, and the house
 * accounts. Promoting her far enough up the ladder to reach those would hand
 * her voids, refunds, the close-out and the day's reports on the way past — a
 * much larger grant than anybody asked for, made accidentally by a rank.
 *
 * Kept as short as `WITHHELD` and for the same reason: two small lists of named
 * exceptions can be read in one go and each carries why it is there, where a
 * full per-role matrix is five columns of forty rows whose first failure is a
 * capability quietly granted because a cell defaulted the wrong way.
 *
 * WITHHELD still wins over this — see `can`. A capability in both lists is a
 * contradiction, and the safe reading of a contradiction is no.
 */
const GRANTED: Partial<Record<PosRole, readonly Capability[]>> = {
  accountant: [
    // The customer book is hers: names, phone numbers, the cars, and removing
    // any of them. She is the person who finds out a number is wrong, because
    // she is the one ringing it.
    "manageCustomers",
    "deleteCustomer",
    // House accounts. Owner and accountant, nobody else — not even a manager,
    // who runs the floor and has no part in what a customer owes over a month.
    "manageCreditAccounts",
  ],
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
  // Fixing what a payment says: the tender it was taken on, the amount, or
  // both. Its own permission rather than borrowing the void one, because it is
  // a much smaller act -- the ticket and what was sold are untouched, only the
  // record of how the money arrived -- and a shop may well want a senior
  // cashier able to fix a mis-key without being able to void anything.
  correctPayment: "manager",
  refund: "manager",
  cashPurchase: "manager",
  overrideCommission: "manager",
  overrideStock: "cashier",
  receiveInventory: "manager",
  adjustInventory: "manager",
  // Removing a product outright, and deliberately a step above adding or
  // editing one. A wrong price is visible the next time somebody quotes from
  // it; a removed product is not visible at all, and everything it ever sold
  // goes with it off every rack view and every search. Editing is how you fix a
  // mistake, which is why manager is enough for that — this is for the row that
  // should never have existed, and it should take the person who owns the
  // consequences of getting that judgement wrong.
  deleteProduct: "owner",
  // Correcting the customer book: a name, a phone number, a car. Manager,
  // because it is a correction rather than a decision — a misheard phone number
  // is found by whoever rings it, and making them ask an owner to fix it is how
  // it stays wrong. Removing a CAR sits here too: a car sold on is genuinely
  // gone and the person who is told about it is on the counter.
  manageCustomers: "manager",
  // Removing a person, which is not the same thing at all. Their tickets keep
  // their name and their history stays readable, but they stop existing to
  // everyone looking them up — and the usual reason to want that is a duplicate
  // record, where picking the wrong one of the two to delete quietly strands
  // half of somebody's history. Owner, like removing a product.
  deleteCustomer: "owner",
  // The house accounts: what a customer owes on their tab and the money that
  // comes in against it. Owner-level, and reached by the accountant through
  // GRANTED rather than by rank — a manager runs the floor and has no part in
  // what somebody owes over a month.
  manageCreditAccounts: "owner",
  // Striking a dead row off the Logs list. It moves no money and is refused on
  // anything that still carries some — see `entry-deletions.ts` — so what it
  // costs if misused is a record of a mistake, not the money the mistake was
  // about. Owner anyway, and for the same reason `deleteProduct` is: the row
  // stops existing for everyone else in the building, and the person who takes
  // it away should be the one who answers for it not being there.
  deleteEntry: "owner",
  // The day screen is the register's home page, so a cashier has to be able to
  // open it. `viewReports` stays manager-only for the figures a cashier has no
  // business seeing — what the shop paid out for stock, above all.
  viewDay: "cashier",
  // The consecutive ledger — the Logs tab. Its own capability rather than
  // sharing `viewDay`, which is what it used to do, because the two turn out to
  // be different questions: Main is the register's home page and everybody at
  // the counter needs it, while Logs is every line and every payment of the day
  // laid out to be read. Sharing one capability meant they could only ever be
  // granted or withheld together, and a service writer needs the first and not
  // the second.
  viewLog: "cashier",
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
  // Taking money out and keeping it off the sheet. Owner, and it cannot
  // sensibly be anything else: the point of a hidden withdrawal is that the
  // drawer comes up short by an amount only one person can account for, and a
  // second person who could do it would be a second unexplained shortfall.
  //
  // It is a loss-prevention control, not a bookkeeping one. The money is fully
  // recorded — row, reason, audit entry, and the owner's own close-out — and
  // what is withheld is only the floor's expectation of it.
  hideDrawerMovement: "owner",
  viewReports: "manager",
  // What each technician individually brought in, in dollars. Separate from
  // viewReports on purpose: a manager runs the floor and needs to know who is
  // carrying the week, which the percentage share tells them. The dollar figure
  // is closer to naming what someone is paid, and the day screen is often left
  // open on a counter anyone can walk past.
  viewTechIncomeCash: "owner",
  viewCosts: "owner",
  // Working out what to charge for a tire the shop does not stock, from what a
  // supplier is quoting today.
  //
  // Cashier, and that is the point of it. Most of these quotes happen on the
  // phone with somebody asking about a size that is not on the rack, and the
  // person holding the phone is whoever is at the counter. A quoting tool only
  // a manager can open is one that gets replaced by a cashier guessing, or by
  // the customer being told to call back.
  //
  // It does not read a single stored cost — the cost is typed in from the
  // supplier's price, so this reveals nothing about what the shop paid for
  // anything already on the rack. What it does show is the shop's MARKUP, which
  // is why it stops at cashier and is not on the public sheet.
  quoteTire: "cashier",
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
  // Withheld beats rank, always. A denial that a high enough rank could override
  // would not be a denial. See `WITHHELD`.
  if (WITHHELD[role]?.includes(capability)) return false;
  // Granted beats rank in the other direction, and is checked second so that a
  // capability appearing in both lists is denied. See `GRANTED`.
  if (GRANTED[role]?.includes(capability)) return true;
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
  viewLog: { label: "See the day's full log", group: "Money and reports" },
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
  correctPayment: {
    label: "Correct a payment — tender or amount",
    group: "Fixing mistakes",
  },
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

  hideDrawerMovement: {
    label: "Take cash out without it showing on the sheet",
    group: "Money and reports",
  },
  drawerCash: { label: "Take cash out of the drawer (bank run, safe)", group: "Money and reports" },

  viewInventory: { label: "Look up stock", group: "Stock" },
  searchProducts: { label: "Search prices", group: "Stock" },
  overrideStock: { label: "Sell stock the system says is gone", group: "Stock" },
  receiveInventory: { label: "Receive new stock", group: "Stock" },
  adjustInventory: { label: "Adjust stock counts", group: "Stock" },
  manageProducts: { label: "Add and edit products", group: "Stock" },
  deleteProduct: { label: "Remove a product from the list", group: "Stock" },
  manageCustomers: {
    label: "Correct a customer's details and their cars",
    group: "At the register",
  },
  deleteCustomer: { label: "Remove a customer from the book", group: "At the register" },
  manageCreditAccounts: {
    label: "See and settle what customers owe on account",
    group: "Money and reports",
  },
  deleteEntry: {
    label: "Take a dead row off the day's log",
    group: "Fixing mistakes",
  },

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
  quoteTire: {
    label: "Price a tire the shop doesn’t stock, from the supplier’s cost",
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
