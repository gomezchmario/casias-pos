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
