import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { cleanText, parseJson } from "../../lib/validate";
import { hashPassword, verifyPassword } from "../../lib/password";
import { assertPassword } from "../../lib/passwordPolicy";
import { requireCustomer } from "../../middleware/customerAuth";
import { setNoStore } from "../../middleware/cache";
import {
  anonymizeCustomer,
  customerFromRow,
  findCustomerById,
  revokeCustomerSessions,
  type CustomerRow,
} from "../../lib/customers";
import { clearCustCookie, getSessionCustomer } from "../../lib/customerSession";

/**
 * What a signed-in customer can do with their own account: read and edit the
 * profile, change their password, see and revoke devices, and delete the account.
 *
 * Contact details are deliberately read-only here — the identifier is the sign-in
 * credential, so changing it is an admin action (section 5.4 of the spec).
 */
const app = new Hono<AppEnv>();

async function loadRow(db: D1Database, id: string): Promise<CustomerRow> {
  const row = await findCustomerById(db, id);
  if (!row) throw ApiError.notFound("Account not found");
  return row;
}

function present(row: CustomerRow) {
  const customer = customerFromRow(row);
  return {
    customer: {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      mustChangePassword: customer.mustChangePassword,
      marketingOptIn: customer.marketingOptIn,
      createdAt: customer.createdAt,
    },
  };
}

/** Counts the account overview shows. Orders are the only ones we can source. */
async function orderCounts(db: D1Database, customerId: string) {
  const row = await first<{
    orders: number;
    active_orders: number;
    spent_cents: number;
    last_order_at: string | null;
  }>(
    db,
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status NOT IN ('delivered','cancelled','refunded') THEN 1 ELSE 0 END), 0) AS active_orders,
            COALESCE(SUM(total_cents), 0) AS spent_cents,
            MAX(created_at) AS last_order_at
       FROM orders WHERE customer_id = ?`,
    [customerId],
  );
  return {
    orders: Number(row?.orders ?? 0),
    activeOrders: Number(row?.active_orders ?? 0),
    spentCents: Number(row?.spent_cents ?? 0),
    lastOrderAt: row?.last_order_at ?? null,
  };
}

/** GET /me — the profile the storefront renders and caches. */
app.get("/me", requireCustomer, async (c) => {
  setNoStore(c);
  const id = c.get("customer")!.id;
  const row = await loadRow(c.env.DB, id);
  return ok(c, { ...present(row), counts: await orderCounts(c.env.DB, id) });
});

const patchSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120).optional(),
    lastName: z.string().trim().max(120).optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .refine((v) => v.firstName !== undefined || v.lastName !== undefined || v.marketingOptIn !== undefined, {
    message: "Nothing to update",
  });

/** PATCH /me — name and marketing preference only. */
app.patch("/me", requireCustomer, async (c) => {
  setNoStore(c);
  const id = c.get("customer")!.id;
  const body = await parseJson(c, patchSchema);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.firstName !== undefined) {
    sets.push("first_name = ?");
    params.push(cleanText(body.firstName, 120));
  }
  if (body.lastName !== undefined) {
    sets.push("last_name = ?");
    params.push(cleanText(body.lastName, 120) || null);
  }
  if (body.marketingOptIn !== undefined) {
    sets.push("marketing_opt_in = ?");
    params.push(body.marketingOptIn ? 1 : 0);
  }

  await run(
    c.env.DB,
    `UPDATE customers SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    [...params, id],
  );

  return ok(c, present(await loadRow(c.env.DB, id)));
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

/** POST /change-password — also the exit from a forced password change. */
app.post("/change-password", requireCustomer, async (c) => {
  setNoStore(c);
  const session = await getSessionCustomer(c.env, c.req.raw);
  const id = c.get("customer")!.id;
  const body = await parseJson(c, changePasswordSchema);

  const row = await loadRow(c.env.DB, id);
  const currentMatches =
    row.password_hash && row.password_salt
      ? await verifyPassword(body.currentPassword, row.password_hash, row.password_salt)
      : false;
  if (!currentMatches) {
    throw ApiError.validation({ currentPassword: "That password is not correct" });
  }

  assertPassword(body.newPassword, { identifiers: [row.email, row.phone_e164] });
  const { hash, salt } = await hashPassword(body.newPassword);

  await run(
    c.env.DB,
    `UPDATE customers
        SET password_hash = ?, password_salt = ?, must_change_password = 0,
            password_changed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`,
    [hash, salt, id],
  );

  // Everything except the device making the change is signed out.
  await revokeCustomerSessions(c.env.DB, id, session?.sessionIdHash);

  return ok(c, { ok: true });
});

/** A stable, non-secret handle for a session row: the first 16 hex chars. */
const SESSION_HANDLE_LENGTH = 16;

/** GET /sessions — the devices holding a session. */
app.get("/sessions", requireCustomer, async (c) => {
  setNoStore(c);
  const id = c.get("customer")!.id;
  const current = await getSessionCustomer(c.env, c.req.raw);

  const rows = await first<never>(c.env.DB, "SELECT 1", []).then(() =>
    c.env.DB.prepare(
      `SELECT substr(id_hash, 1, ?) AS id, user_agent, ip_hash, created_at, last_used_at, expires_at
         FROM customer_sessions WHERE customer_id = ? ORDER BY last_used_at DESC LIMIT 50`,
    )
      .bind(SESSION_HANDLE_LENGTH, id)
      .all<{
        id: string;
        user_agent: string | null;
        ip_hash: string | null;
        created_at: string;
        last_used_at: string;
        expires_at: string;
      }>(),
  );

  const sessions = (rows.results ?? []).map((row) => ({
    id: row.id,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    current: current?.sessionIdHash.slice(0, SESSION_HANDLE_LENGTH) === row.id,
  }));

  return ok(c, { sessions });
});

/** DELETE /sessions/:id — sign one other device out. */
app.delete("/sessions/:handle", requireCustomer, async (c) => {
  setNoStore(c);
  const id = c.get("customer")!.id;
  const handle = c.req.param("handle");
  if (!/^[a-f0-9]{16}$/.test(handle)) throw ApiError.notFound("Session not found");

  const result = await run(
    c.env.DB,
    "DELETE FROM customer_sessions WHERE customer_id = ? AND substr(id_hash, 1, ?) = ?",
    [id, SESSION_HANDLE_LENGTH, handle],
  );
  if ((result.meta?.changes ?? 0) === 0) throw ApiError.notFound("Session not found");

  return ok(c, { ok: true });
});

/** DELETE /sessions — sign out every other device. */
app.delete("/sessions", requireCustomer, async (c) => {
  setNoStore(c);
  const id = c.get("customer")!.id;
  const current = await getSessionCustomer(c.env, c.req.raw);
  await revokeCustomerSessions(c.env.DB, id, current?.sessionIdHash);
  return ok(c, { ok: true });
});

const deleteSchema = z.object({ password: z.string().min(1).max(200) });

/** DELETE / — close the account and erase the personal data. */
app.delete("/", requireCustomer, async (c) => {
  setNoStore(c);
  const id = c.get("customer")!.id;
  const body = await parseJson(c, deleteSchema);

  const row = await loadRow(c.env.DB, id);
  const matches =
    row.password_hash && row.password_salt
      ? await verifyPassword(body.password, row.password_hash, row.password_salt)
      : false;
  if (!matches) throw ApiError.validation({ password: "That password is not correct" });

  await anonymizeCustomer(c.env.DB, id);
  c.header("Set-Cookie", clearCustCookie(c.req.raw));

  return ok(c, { ok: true, deleted: true });
});

export default app;
