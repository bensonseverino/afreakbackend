import type { Env, AdminUser } from "../env";
import { randomHex } from "./ids";
import { first, run } from "./db";

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const REFRESH_BELOW_SECONDS = 60 * 60 * 24; // slide when < 1 day left

/**
 * `__Host-` prefixed cookies require HTTPS. We decide from the actual request
 * scheme, so local `http://localhost` dev uses a plain cookie name.
 */
export function isSecureRequest(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function cookieName(request: Request): string {
  return isSecureRequest(request) ? "__Host-afreak_session" : "afreak_session";
}

export function sessionCookie(request: Request, id: string, maxAge = TTL_SECONDS): string {
  const parts = [
    `${cookieName(request)}=${id}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(request: Request): string {
  return sessionCookie(request, "", 0);
}

export async function createSession(env: Env, adminId: string): Promise<string> {
  const id = randomHex(32);
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  await run(env.DB, "INSERT INTO sessions (id, admin_id, expires_at) VALUES (?, ?, ?)", [
    id,
    adminId,
    expiresAt,
  ]);
  return id;
}

export async function destroySession(env: Env, id: string): Promise<void> {
  await run(env.DB, "DELETE FROM sessions WHERE id = ?", [id]);
}

export async function destroyAllSessions(env: Env, adminId: string): Promise<void> {
  await run(env.DB, "DELETE FROM sessions WHERE admin_id = ?", [adminId]);
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  const name = cookieName(request);
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1);
  }
  return null;
}

type SessionRow = {
  id: string;
  admin_id: string;
  expires_at: string;
  email: string;
  name: string | null;
  role: "owner" | "editor";
};

/** Resolve the current admin from the session cookie, sliding expiry as needed. */
export async function getSessionAdmin(env: Env, request: Request): Promise<AdminUser | null> {
  const id = readSessionCookie(request);
  if (!id) return null;

  const row = await first<SessionRow>(
    env.DB,
    `SELECT s.id, s.admin_id, s.expires_at, a.email, a.name, a.role
       FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.id = ?`,
    [id],
  );
  if (!row) return null;

  const expiresMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    await destroySession(env, id);
    return null;
  }

  if (expiresMs - Date.now() < REFRESH_BELOW_SECONDS * 1000) {
    const next = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
    await run(env.DB, "UPDATE sessions SET expires_at = ? WHERE id = ?", [next, id]);
  }

  return {
    id: row.admin_id,
    email: row.email,
    name: row.name,
    role: row.role,
    sessionId: row.id,
  };
}
