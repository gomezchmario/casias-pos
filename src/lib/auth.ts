import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { nowLocalIso } from "./time";

const ROUNDS = 10;

export type AdminRow = {
  id: number;
  username: string;
  password_hash: string;
  must_change_password: number;
  created_at: string;
};

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function findAdminByUsername(username: string): AdminRow | null {
  const db = getDb();
  return (
    (db
      .prepare("SELECT * FROM admin_users WHERE username = ?")
      .get(username) as AdminRow | undefined) ?? null
  );
}

export function findAdminById(id: number): AdminRow | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM admin_users WHERE id = ?").get(id) as
      | AdminRow
      | undefined) ?? null
  );
}

export function setAdminPassword(id: number, newPassword: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE admin_users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
  ).run(hashPassword(newPassword), id);
}

export function createAdmin(
  username: string,
  password: string,
  mustChange = false,
): number {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO admin_users (username, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(username, hashPassword(password), mustChange ? 1 : 0, nowLocalIso());
  return Number(result.lastInsertRowid);
}
