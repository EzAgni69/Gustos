/**
 * Gusto POS Local Server — Transactions & after-commit side effects
 *
 * Every order mutation touches several tables (orders, items, KOTs, tables,
 * event log, sync outbox). `atomic()` runs such a mutation in one SQLite
 * transaction, so a failure half-way leaves nothing behind.
 *
 * Side effects that leave the database — Socket.IO broadcasts, printer jobs,
 * cloud pushes — must not happen for work that is later rolled back. Register
 * them with `afterCommit()`: inside a transaction they are held until the
 * outermost commit and dropped on rollback; outside one they run immediately.
 *
 * better-sqlite3 is synchronous and single-connection, so any query issued
 * through `db` while `atomic()` is on the stack is part of the transaction.
 */

import type { Database as SqliteDatabase } from "better-sqlite3";
import * as dbModule from "./index.js";

let depth = 0;
let pendingEffects: Array<() => void> = [];

function runEffect(effect: () => void): void {
  try {
    effect();
  } catch (err) {
    console.error("[DB] After-commit effect failed:", err instanceof Error ? err.message : err);
  }
}

/** Run `effect` once the current transaction commits (immediately if none is open). */
export function afterCommit(effect: () => void): void {
  if (depth === 0) {
    runEffect(effect);
    return;
  }
  pendingEffects.push(effect);
}

/** True while an `atomic()` block is executing. */
export function inTransaction(): boolean {
  return depth > 0;
}

/**
 * Run `fn` inside a single SQLite transaction. Nested calls join the outer
 * transaction. `fn` must be synchronous.
 */
export function atomic<T>(fn: () => T): T {
  if (depth > 0) return fn();

  // Resolved at call time so tests can swap the db instance.
  const client = (dbModule.db as unknown as { $client: SqliteDatabase }).$client;

  depth++;
  let result: T;
  try {
    result = client.transaction(fn).immediate();
  } catch (err) {
    pendingEffects = [];
    throw err;
  } finally {
    depth--;
  }

  const effects = pendingEffects;
  pendingEffects = [];
  for (const effect of effects) runEffect(effect);
  return result;
}

/** Wrap a synchronous service function so every call runs atomically. */
export function atomicFn<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A) => atomic(() => fn(...args));
}
