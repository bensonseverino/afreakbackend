import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { customerFromClerkUser, verifyClerkSignature } from "../../lib/clerkWebhook";
import { setNoStore } from "../../middleware/cache";

/**
 * Clerk → `customers`.
 *
 * Mounted at `/api/webhooks/clerk` (see `routes/webhooks/index.ts`). Clerk is
 * the only identity source, so this is how an account created in the storefront
 * reaches the database. Deliveries are server-to-server: they carry no Origin,
 * so the CSRF guard lets them through, and trust comes from the Svix signature
 * rather than a session.
 */
const app = new Hono<AppEnv>();

/** Clerk payloads are a few KB; anything bigger is not a real delivery. */
const MAX_BODY_BYTES = 64 * 1024;

const HANDLED = new Set(["user.created", "user.updated", "user.deleted"]);

type CustomerRow = { marketing_opt_in: number | null; sms_opt_in: number | null };

async function upsertCustomer(db: D1Database, data: Record<string, unknown>): Promise<boolean> {
  const row = customerFromClerkUser(data);
  if (!row) return false;

  // The consent flags only reach us when the storefront writes them to Clerk
  // metadata, so keep whatever the row already holds when they are absent.
  const existing = await first<CustomerRow>(
    db,
    "SELECT marketing_opt_in, sms_opt_in FROM customers WHERE id = ?",
    [row.id],
  );
  const marketing = row.marketingOptIn ?? existing?.marketing_opt_in ?? 0;
  const sms = row.smsOptIn ?? existing?.sms_opt_in ?? 0;

  await run(
    db,
    `INSERT INTO customers (
       id, email, first_name, last_name, phone, image_url,
       marketing_opt_in, sms_opt_in, status, last_sign_in_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, COALESCE(?, datetime('now')), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       phone = excluded.phone,
       image_url = excluded.image_url,
       marketing_opt_in = excluded.marketing_opt_in,
       sms_opt_in = excluded.sms_opt_in,
       status = 'active',
       deleted_at = NULL,
       last_sign_in_at = COALESCE(excluded.last_sign_in_at, customers.last_sign_in_at),
       updated_at = datetime('now')`,
    [
      row.id,
      row.email,
      row.firstName,
      row.lastName,
      row.phone,
      row.imageUrl,
      marketing,
      sms,
      row.lastSignInAt,
      row.createdAt,
    ],
  );
  return true;
}

/** `user.deleted` only carries the id, so the row is kept but flagged. */
async function softDeleteCustomer(db: D1Database, data: Record<string, unknown>): Promise<boolean> {
  const id = typeof data.id === "string" ? data.id.trim() : "";
  if (!id) return false;

  await run(
    db,
    `INSERT INTO customers (id, status, deleted_at, updated_at)
     VALUES (?, 'deleted', datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       status = 'deleted',
       deleted_at = datetime('now'),
       updated_at = datetime('now')`,
    [id],
  );
  return true;
}

app.post("/", async (c) => {
  setNoStore(c);

  const secret = c.env.CLERK_WEBHOOK_SECRET;
  if (!secret) throw ApiError.unauthorized("Clerk webhook is not configured");

  // Read the raw body: re-serialising the JSON would break the signature.
  const body = await c.req.text();
  if (body.length > MAX_BODY_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
  }

  const id = c.req.header("svix-id") ?? "";
  const trusted = await verifyClerkSignature({
    secret,
    id,
    timestamp: c.req.header("svix-timestamp") ?? "",
    signature: c.req.header("svix-signature") ?? "",
    body,
  });
  if (!trusted) throw ApiError.forbidden("Invalid webhook signature");

  // Svix retries until the delivery is acknowledged — never apply one twice.
  const seen = await first<{ id: string }>(
    c.env.DB,
    "SELECT id FROM webhook_events WHERE id = ?",
    [id],
  );
  if (seen) return ok(c, { received: true, duplicate: true });

  let event: { type?: unknown; data?: unknown };
  try {
    event = JSON.parse(body);
  } catch {
    throw ApiError.badRequest("Malformed JSON");
  }

  const type = String(event.type ?? "");
  const data =
    event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};

  // Unknown event types are acknowledged and ignored: Clerk sends the whole
  // catalogue to every endpoint.
  const applied = HANDLED.has(type)
    ? type === "user.deleted"
      ? await softDeleteCustomer(c.env.DB, data)
      : await upsertCustomer(c.env.DB, data)
    : false;

  await run(
    c.env.DB,
    `INSERT OR IGNORE INTO webhook_events (id, provider, type, subject_id)
     VALUES (?, 'clerk', ?, ?)`,
    [id, type, typeof data.id === "string" ? data.id : null],
  );

  return ok(c, { received: true, type, applied });
});

export default app;
