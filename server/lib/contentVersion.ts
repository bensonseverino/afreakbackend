/**
 * Storefront content versioning (CMS CONNECTION FIX §6).
 *
 * A single integer in `settings` (`content_version`) is bumped by every admin
 * write that can change what the storefront renders. Public content endpoints
 * derive their ETag from it, so browsers always revalidate (cheap 304s) and can
 * never be served stale CMS content.
 */
import type { Env } from "../env";
import { first, run, type BatchStatement } from "./db";
import { SETTINGS_KEYS } from "../../shared/settingsKeys.js";

const BUMP_SQL = `INSERT INTO settings (key, value_json, updated_at)
   VALUES (?, '1', datetime('now'))
   ON CONFLICT(key) DO UPDATE SET
     value_json = CAST(CAST(value_json AS INTEGER) + 1 AS TEXT),
     updated_at = datetime('now')`;

/**
 * The bump as a batch statement, so a write and its version bump land in the
 * same `db.batch` (atomically — the storefront can never see a write that
 * hasn't been announced).
 */
export function touchContentStatement(): BatchStatement {
  return { sql: BUMP_SQL, params: [SETTINGS_KEYS.CONTENT_VERSION] };
}

/** Bump the content version (use after single-statement admin writes). */
export async function touchContent(env: Env): Promise<number> {
  await run(env.DB, BUMP_SQL, [SETTINGS_KEYS.CONTENT_VERSION]);
  return getContentVersion(env);
}

/** Current content version; 0 when no admin write has happened yet. */
export async function getContentVersion(env: Env): Promise<number> {
  const row = await first<{ value_json: string }>(
    env.DB,
    `SELECT value_json FROM settings WHERE key = ?`,
    [SETTINGS_KEYS.CONTENT_VERSION],
  );
  const parsed = Number.parseInt(String(row?.value_json ?? "0"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Reset helper for tests and local replay — not exposed to the public API.
 */
export async function resetContentVersion(env: Env): Promise<void> {
  await run(
    env.DB,
    `DELETE FROM settings WHERE key = ?`,
    [SETTINGS_KEYS.CONTENT_VERSION],
  );
}
