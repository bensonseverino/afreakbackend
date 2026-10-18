import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { count, first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson } from "../../lib/validate";
import { PASSWORD_MIN_LENGTH, hashPassword, verifyPassword } from "../../lib/password";
import {
  clearCookie,
  createSession,
  destroyAllSessions,
  destroySession,
  getSessionAdmin,
  sessionCookie,
} from "../../lib/session";
import { clientIp, ipHash, rateLimit } from "../../middleware/rateLimit";
import { requireAdmin } from "../../middleware/auth";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const MAX_FAILED = 5;
const WINDOW_MINUTES = 15;

const emailSchema = z.string().trim().toLowerCase().email().max(200);
const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200);

async function recentFailures(env: AppEnv["Bindings"], hash: string): Promise<number> {
  return count(
    env.DB,
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE ip_hash = ? AND created_at > datetime('now', ?)`,
    [hash, `-${WINDOW_MINUTES} minutes`],
  );
}

/** GET /admin/me — the signed-in admin. */
app.get("/me", async (c) => {
  setNoStore(c);
  const admin = await getSessionAdmin(c.env, c.req.raw);
  if (!admin) throw ApiError.unauthorized();
  return ok(c, {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
});

/** POST /admin/login */
app.post("/login", rateLimit({ scope: "login", limit: 20, windowMs: 15 * 60_000 }), async (c) => {
  setNoStore(c);
  const body = await parseJson(
    c,
    z.object({ email: emailSchema, password: z.string().min(1).max(200) }),
  );

  const hash = await ipHash(c.env, clientIp(c));
  if ((await recentFailures(c.env, hash)) >= MAX_FAILED) {
    throw ApiError.rateLimited("Too many attempts — try again later");
  }

  const admin = await first<{
    id: string;
    email: string;
    name: string | null;
    role: "owner" | "editor";
    password_hash: string;
    salt: string;
  }>(c.env.DB, "SELECT * FROM admins WHERE email = ?", [body.email]);

  const valid = admin ? await verifyPassword(body.password, admin.password_hash, admin.salt) : false;
  if (!admin || !valid) {
    await run(c.env.DB, "INSERT INTO login_attempts (ip_hash) VALUES (?)", [hash]);
    throw ApiError.unauthorized("Invalid credentials");
  }

  await run(c.env.DB, "DELETE FROM login_attempts WHERE ip_hash = ?", [hash]);
  const sessionId = await createSession(c.env, admin.id);
  c.header("Set-Cookie", sessionCookie(c.req.raw, sessionId));
  return ok(c, { id: admin.id, email: admin.email, name: admin.name, role: admin.role });
});

/** POST /admin/logout */
app.post("/logout", async (c) => {
  setNoStore(c);
  const admin = await getSessionAdmin(c.env, c.req.raw);
  if (admin) await destroySession(c.env, admin.sessionId);
  c.header("Set-Cookie", clearCookie(c.req.raw));
  return ok(c, { loggedOut: true });
});

/** POST /admin/password — change own password. */
app.post("/password", requireAdmin, async (c) => {
  setNoStore(c);
  const admin = c.get("admin");
  const body = await parseJson(
    c,
    z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: passwordSchema,
    }),
  );

  const row = await first<{ password_hash: string; salt: string }>(
    c.env.DB,
    "SELECT password_hash, salt FROM admins WHERE id = ?",
    [admin.id],
  );
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash, row.salt))) {
    throw ApiError.badRequest("Current password is incorrect");
  }

  const { hash, salt } = await hashPassword(body.newPassword);
  await run(c.env.DB, "UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?", [
    hash,
    salt,
    admin.id,
  ]);
  // Invalidate every session, then re-issue one for this browser.
  await destroyAllSessions(c.env, admin.id);
  const sessionId = await createSession(c.env, admin.id);
  c.header("Set-Cookie", sessionCookie(c.req.raw, sessionId));
  return ok(c, { updated: true });
});

export default app;
