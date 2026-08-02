import { getDb } from "./db";

/**
 * Run `fn` in a transaction so a change and its audit row commit together or
 * not at all. better-sqlite3 nests these as savepoints, so it is safe to call
 * `inTx` inside another `inTx`.
 */
export function inTx<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}
