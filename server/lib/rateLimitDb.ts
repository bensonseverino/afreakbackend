/**
 * D1-backed fixed-window rate limiter.
 *
 * The in-memory limiter in `middleware/rateLimit.ts` is cheap but per-isolate,
 * which is not good enough for credential endpoints: a Worker scales out, and
 * each isolate would hand an attacker a fresh allowance. These counters live in
 * `rate_limits` (see `0005_customer_accounts.sql`) and are shared by every PoP.
 *
 * Keys are hashed before they reach the table so raw emails, phone numbers and
 * IPs are never stored (same privacy stance as `login_attempts`).
 */
import { first, run } from "./db";
import { ApiError, type ErrorCode } from "./http";

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

/** Consume one slot from `key`'s current window. */
export async function consumeRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();

  const row = await first<{ count: number }>(
    db,
    "SELECT count FROM rate_limits WHERE key = ? AND window_start = ?",
    [key, windowStart],
  );
  const count = Number(row?.count ?? 0) + 1;

  if (count > limit) {
    const resetAt = Date.parse(windowStart) + windowMs;
    return { ok: false, retryAfter: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) };
  }

  await run(
    db,
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`,
    [key, windowStart],
  );

  // Opportunistic cleanup: windows are anonymous once they expire.
  if (Math.random() < 0.02) {
    await run(db, "DELETE FROM rate_limits WHERE window_start < datetime('now', '-1 day')");
  }

  return { ok: true };
}

/**
 * Read a key's current count without consuming a slot.
 *
 * Login limits count *failures*, so the check has to happen before the password
 * is verified and the slot is only taken when the attempt fails.
 */
export async function peekRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  const row = await first<{ count: number }>(
    db,
    "SELECT count FROM rate_limits WHERE key = ? AND window_start = ?",
    [key, windowStart],
  );
  const count = Number(row?.count ?? 0);
  if (count < limit) return { ok: true };
  const resetAt = Date.parse(windowStart) + windowMs;
  return { ok: false, retryAfter: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) };
}

/**
 * Consume a slot or raise. `retryAfter` is surfaced in the error body so the
 * storefront can render a countdown.
 */
export async function enforceRateLimitDb(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
  options: { code?: ErrorCode; message?: string } = {},
): Promise<void> {
  const result = await consumeRateLimit(db, key, limit, windowSeconds);
  if (result.ok) return;

  throw new ApiError(429, options.code ?? "RATE_LIMITED", options.message ?? "Too many requests", {
    details: { retryAfter: result.retryAfter },
  });
}
