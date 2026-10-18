import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../../env";
import { first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { cleanText, parseJson } from "../../lib/validate";
import { newId } from "../../lib/ids";
import { sha256Hex } from "../../lib/hash";
import { derive, hashPassword, verifyPassword } from "../../lib/password";
import { assertPassword } from "../../lib/passwordPolicy";
import { toE164 } from "../../lib/phone";
import { verifyTurnstile } from "../../lib/turnstile";
import { clientIp, ipHash } from "../../middleware/rateLimit";
import { enforceRateLimitDb, peekRateLimit } from "../../lib/rateLimitDb";
import { setNoStore } from "../../middleware/cache";
import {
  audit,
  customerFromRow,
  findCustomerByIdentifier,
  identifierTaken,
  type AuthChannel,
} from "../../lib/customers";
import {
  clearCustCookie,
  createCustomerSession,
  custCookie,
  destroyCustomerSession,
} from "../../lib/customerSession";

/**
 * Sign-up, sign-in, sign-out and "forgot password".
 *
 * Every account created here is `pending` until an admin approves it in the CMS:
 * approval *is* the verification step. That shapes the error handling below —
 * the status of an account is only ever revealed to someone who supplied the
 * correct password, so the endpoint cannot be used to enumerate accounts.
 */
const app = new Hono<AppEnv>();

const channelSchema = z.enum(["email", "phone"]);

const signupSchema = z.object({
  channel: channelSchema,
  identifier: z.string().trim().min(1).max(200),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().max(120).optional(),
  password: z.string().min(1).max(200),
  marketingOptIn: z.boolean().optional(),
  /** Honeypot: a real person never sees this field, a bot happily fills it. */
  website: z.string().max(200).optional(),
  turnstileToken: z.string().max(4000).optional(),
});

const loginSchema = z.object({
  channel: channelSchema,
  identifier: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

const forgotSchema = z.object({
  channel: channelSchema,
  identifier: z.string().trim().min(1).max(200),
  website: z.string().max(200).optional(),
});

/** Normalise the identifier a request supplies, or raise a field error. */
function normalizeIdentifier(channel: AuthChannel, raw: string, env: Env): string {
  const value = raw.trim();
  if (!value) {
    throw ApiError.validation({
      identifier: channel === "phone" ? "Enter your phone number" : "Enter your email address",
    });
  }

  if (channel === "phone") {
    const e164 = toE164(value, env.DEFAULT_PHONE_COUNTRY);
    if (!e164) throw ApiError.validation({ identifier: "Enter a valid phone number" });
    return e164;
  }

  const email = value.toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw ApiError.validation({ identifier: "Enter a valid email address" });
  }
  return email;
}

/** A fixed salt used only to burn the same CPU when an account does not exist. */
const TIMING_SALT = "00000000000000000000000000000000";

/** POST /auth/signup — request an account. No session is created. */
app.post("/signup", async (c) => {
  setNoStore(c);
  const body = await parseJson(c, signupSchema);

  // A filled honeypot gets exactly the response a human would see.
  if ((body.website ?? "").trim() !== "") {
    return c.json({ data: { status: "pending" } }, 201);
  }

  const ip = clientIp(c);
  if (!(await verifyTurnstile(c.env, body.turnstileToken, ip))) {
    throw new ApiError(400, "CAPTCHA_FAILED", "Verification failed — please try again");
  }

  const identifier = normalizeIdentifier(body.channel, body.identifier, c.env);
  await enforceRateLimitDb(c.env.DB, `signup:${await ipHash(c.env, ip)}`, 5, 3600);

  assertPassword(body.password, { identifiers: [identifier] });

  if (await identifierTaken(c.env.DB, body.channel, identifier)) {
    throw ApiError.conflict(
      body.channel === "phone"
        ? "This phone number is already registered. Try signing in or resetting your password."
        : "This email is already registered. Try signing in or resetting your password.",
      { code: "IDENTIFIER_TAKEN" },
    );
  }

  const id = newId("cus");
  const { hash, salt } = await hashPassword(body.password);

  await run(
    c.env.DB,
    `INSERT INTO customers
       (id, email, phone_e164, first_name, last_name, password_hash, password_salt,
        status, signup_source, marketing_opt_in)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'self', ?)`,
    [
      id,
      body.channel === "email" ? identifier : null,
      body.channel === "phone" ? identifier : null,
      cleanText(body.firstName, 120),
      cleanText(body.lastName ?? "", 120) || null,
      hash,
      salt,
      body.marketingOptIn ? 1 : 0,
    ],
  );

  await audit(c.env.DB, { customerId: id, action: "signup", detail: { channel: body.channel } });

  return c.json({ data: { status: "pending" } }, 201);
});

/** Human-readable notice for an account that exists but cannot sign in. */
function statusNotice(status: string): { code: "ACCOUNT_PENDING" | "ACCOUNT_REJECTED" | "ACCOUNT_SUSPENDED"; message: string } | null {
  if (status === "pending") {
    return {
      code: "ACCOUNT_PENDING",
      message: "Your account is awaiting approval. You'll be able to sign in as soon as it's approved.",
    };
  }
  if (status === "rejected") {
    return {
      code: "ACCOUNT_REJECTED",
      message: "Your account request wasn't approved. Contact us if you think this is a mistake.",
    };
  }
  if (status === "suspended") {
    return { code: "ACCOUNT_SUSPENDED", message: "This account is currently suspended. Contact support." };
  }
  return null;
}

function presentCustomer(row: Parameters<typeof customerFromRow>[0]) {
  const customer = customerFromRow(row);
  return { customer, mustChangePassword: customer.mustChangePassword };
}

/** POST /auth/login — exchange credentials for a session cookie. */
app.post("/login", async (c) => {
  setNoStore(c);
  const body = await parseJson(c, loginSchema);
  const ip = clientIp(c);
  const identifier = normalizeIdentifier(body.channel, body.identifier, c.env);

  // Failures, not attempts: a customer who signs in successfully is never
  // locked out by their own successful logins.
  const idKey = `login-id:${await sha256Hex(identifier)}`;
  const ipKey = `login-ip:${await ipHash(c.env, ip)}`;
  const [idPeek, ipPeek] = await Promise.all([
    peekRateLimit(c.env.DB, idKey, 5, 900),
    peekRateLimit(c.env.DB, ipKey, 20, 900),
  ]);
  if (!idPeek.ok || !ipPeek.ok) {
    const retryAfter = Math.max(
      idPeek.ok ? 0 : idPeek.retryAfter,
      ipPeek.ok ? 0 : ipPeek.retryAfter,
    );
    throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Too many attempts — try again shortly", {
      details: { retryAfter },
    });
  }

  const row = await findCustomerByIdentifier(c.env.DB, body.channel, identifier);
  const passwordMatches =
    row?.password_hash && row.password_salt
      ? await verifyPassword(body.password, row.password_hash, row.password_salt)
      : ((await derive(body.password, TIMING_SALT)), false);

  if (!row || !passwordMatches) {
    await Promise.all([
      enforceRateLimitDb(c.env.DB, idKey, 5, 900),
      enforceRateLimitDb(c.env.DB, ipKey, 20, 900),
    ]);
    throw new ApiError(401, "INVALID_CREDENTIALS", "That email/phone or password is incorrect");
  }

  // Only now is the account's state allowed to be visible.
  if (row.status !== "active") {
    const notice = statusNotice(row.status);
    if (!notice) throw new ApiError(401, "INVALID_CREDENTIALS", "That email/phone or password is incorrect");
    throw new ApiError(403, notice.code, notice.message);
  }

  const raw = await createCustomerSession(c.env, row.id, c.req.raw, await ipHash(c.env, ip));
  c.header("Set-Cookie", custCookie(c.req.raw, raw));

  // Remember when they were last here, at most once an hour.
  await run(
    c.env.DB,
    `UPDATE customers SET last_login_at = datetime('now')
      WHERE id = ? AND (last_login_at IS NULL OR last_login_at < datetime('now', '-1 hour'))`,
    [row.id],
  );

  return ok(c, presentCustomer({ ...row, last_login_at: new Date().toISOString() }));
});

/** POST /auth/logout — revoke this session and clear the cookie. */
app.post("/logout", async (c) => {
  setNoStore(c);
  await destroyCustomerSession(c.env, c.req.raw);
  c.header("Set-Cookie", clearCustCookie(c.req.raw));
  return ok(c, { ok: true });
});

/**
 * POST /auth/forgot-password — raise a reset request for the admins.
 *
 * There is no mail provider yet, so a real reset is done by hand from the CMS
 * queue. The response is identical whether or not an account matched.
 */
app.post("/forgot-password", async (c) => {
  setNoStore(c);
  const body = await parseJson(c, forgotSchema);
  const generic = { received: true };

  if ((body.website ?? "").trim() !== "") return ok(c, generic);

  let identifier: string;
  try {
    identifier = normalizeIdentifier(body.channel, body.identifier, c.env);
  } catch {
    return ok(c, generic);
  }

  const ip = clientIp(c);
  await enforceRateLimitDb(c.env.DB, `forgot:${await sha256Hex(identifier)}`, 3, 3600);
  await enforceRateLimitDb(c.env.DB, `forgot-ip:${await ipHash(c.env, ip)}`, 10, 3600);

  const row = await findCustomerByIdentifier(c.env.DB, body.channel, identifier);
  if (row && row.status === "active") {
    const open = await first<{ id: number }>(
      c.env.DB,
      `SELECT id FROM password_reset_requests
        WHERE customer_id = ? AND status = 'open' AND created_at > datetime('now', '-24 hours')`,
      [row.id],
    );
    if (!open) {
      await run(c.env.DB, "INSERT INTO password_reset_requests (customer_id) VALUES (?)", [row.id]);
    }
  }

  return ok(c, generic);
});

export default app;
