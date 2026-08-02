import bcrypt from "bcryptjs";
import { getDb } from "./db";

const ROUNDS = 10;

export function hashPin(pin: string): string {
  return bcrypt.hashSync(pin, ROUNDS);
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export type EmployeeRow = {
  id: number;
  name: string;
  pin_hash: string;
  role: string | null;
  active: number;
  created_at: string;
  updated_at: string;
};

/**
 * Look up an active employee by PIN. PINs are hashed individually so we must
 * compare against every active employee's hash. Fine for small workforces.
 */
export function findEmployeeByPin(pin: string): EmployeeRow | null {
  if (!isValidPinFormat(pin)) return null;
  const db = getDb();
  const employees = db
    .prepare("SELECT * FROM employees WHERE active = 1")
    .all() as EmployeeRow[];
  for (const emp of employees) {
    if (bcrypt.compareSync(pin, emp.pin_hash)) return emp;
  }
  return null;
}

export function pinIsTakenByOther(pin: string, exceptId?: number): boolean {
  if (!isValidPinFormat(pin)) return false;
  const db = getDb();
  const employees = db
    .prepare("SELECT id, pin_hash FROM employees WHERE active = 1")
    .all() as { id: number; pin_hash: string }[];
  for (const emp of employees) {
    if (exceptId && emp.id === exceptId) continue;
    if (bcrypt.compareSync(pin, emp.pin_hash)) return true;
  }
  return false;
}
