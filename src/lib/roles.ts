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
  viewReports: "manager",
  viewCosts: "owner",
  managePayroll: "owner",
  manageEmployees: "owner",
  manageSettings: "owner",
  manageProducts: "manager",
  manageQuickButtons: "manager",
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

  editCompletedSale: { label: "Edit a paid ticket", group: "Fixing mistakes" },
  voidSale: { label: "Void a ticket", group: "Fixing mistakes" },
  refund: { label: "Give a refund", group: "Fixing mistakes" },
  overrideCommission: { label: "Override commission", group: "Fixing mistakes" },
  closeShift: { label: "Count the drawer and close a shift", group: "Fixing mistakes" },

  viewInventory: { label: "Look up stock", group: "Stock" },
  searchProducts: { label: "Search prices", group: "Stock" },
  overrideStock: { label: "Sell stock the system says is gone", group: "Stock" },
  receiveInventory: { label: "Receive new stock", group: "Stock" },
  adjustInventory: { label: "Adjust stock counts", group: "Stock" },
  manageProducts: { label: "Add and edit products", group: "Stock" },

  cashPurchase: { label: "Buy stock over the counter (cash out)", group: "Money and reports" },
  viewReports: { label: "See reports", group: "Money and reports" },
  viewCosts: { label: "See what the shop paid for stock", group: "Money and reports" },
  managePayroll: { label: "Run and lock payroll", group: "Money and reports" },

  manageQuickButtons: { label: "Change the register buttons", group: "Setup" },
  manageEmployees: { label: "Manage employees", group: "Setup" },
  manageSettings: { label: "Change shop settings", group: "Setup" },
};

/** Every capability a role has, in the reading order of CAPABILITY_INFO. */
export function capabilitiesFor(role: PosRole): Capability[] {
  return (Object.keys(CAPABILITY_INFO) as Capability[]).filter((c) => can(role, c));
}
