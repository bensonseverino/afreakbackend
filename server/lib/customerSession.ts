/**
 * Customer sessions.
 *
 * The mirror image of `lib/session.ts` (admin sessions), with one difference that
 * matters: the cookie we hand out is never stored. The DB keeps only the
 * SHA-256 of it, so a leaked `customer_sessions` table cannot be replayed.
 */
import type { Env } from "../env";
import { first, run } from "./db";
import { randomHex } from "./ids";
import { sha256Hex } from "./hash";
import {
  customerColumns,
  customerFromRow,
  type Customer,
  type CustomerRow,
} from "./customers";

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const REFRESH_BELOW_SECONDS = 60 * 60 * 24 * 7; // slide when < 7 days left

/**
 * `__Host-` prefixed cookies require HTTPS, so local `http://localhost` dev uses
 * a plain name — same rule as the admin cookie.
 */
function isSecure(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function custCookieName(request: Request): string {
  return isSecure(request) ? "__Host-afreak_cust" : "afreak_cust";
}

export function custCookie(request: Request, id: string, maxAge = TTL_SECONDS): string {
  const parts = [
    `${custCookieName(request)}=${id}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecure(request)) parts.push("Secure");
  return parts.join("; ");
}

export function clearCustCookie(request: Request): string {
  return custCookie(request, "", 0);
}

export function readCustCookie(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  const name = custCookieName(request);
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1);
  }
  return null;
}

/** Create a session and return the raw cookie value (only the hash is stored). */
export async function createCustomerSession(
  env: Env,
  customerId: string,
  request: Request,
  ipHash: string,
): Promise<string> {
  const raw = randomHex(32);
  const idHash = await sha256Hex(raw);
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  await run(
    env.DB,
    `INSERT INTO customer_sessions (id_hash, customer_id, user_agent, ip_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [idHash, customerId, (request.headers.get("User-Agent") ?? "").slice(0, 300), ipHash, expiresAt],
  );
  return raw;
}

export async function destroyCustomerSession(env: Env, request: Request): Promise<void> {
  const raw = readCustCookie(request);
  if (!raw) return;
  await run(env.DB, "DELETE FROM customer_sessions WHERE id_hash = ?", [await sha256Hex(raw)]);
}

type JoinedRow = CustomerRow & { expires_at: string; last_used_at: string; id_hash: string };

export type ResolvedSession = { customer: Customer; sessionIdHash: string };

/**
 * The customer behind this request, or null. Slides the expiry as it goes so an
 * active shopper is never signed out mid-session.
 */
export async function getSessionCustomer(
  env: Env,
  request: Request,
): Promise<ResolvedSession | null> {
  const raw = readCustCookie(request);
  if (!raw) return null;

  const idHash = await sha256Hex(raw);
  const row = await first<JoinedRow>(
    env.DB,
    `SELECT ${customerColumns("c")}, s.id_hash, s.expires_at, s.last_used_at
       FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
      WHERE s.id_hash = ?`,
    [idHash],
  );
  if (!row) return null;

  const expiresMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    await run(env.DB, "DELETE FROM customer_sessions WHERE id_hash = ?", [idHash]);
    return null;
  }

  const slideExpiry =
    expiresMs - Date.now() < REFRESH_BELOW_SECONDS * 1000
      ? new Date(Date.now() + TTL_SECONDS * 1000).toISOString()
      : row.expires_at;

  await run(env.DB, "UPDATE customer_sessions SET last_used_at = datetime('now'), expires_at = ? WHERE id_hash = ?", [
    slideExpiry,
    idHash,
  ]);

  return { customer: customerFromRow(row), sessionIdHash: idHash };
}
