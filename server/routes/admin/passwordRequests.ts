import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { all, first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { setNoStore } from "../../middleware/cache";

/**
 * The "Forgot password" queue.
 *
 * Until an email/SMS provider exists, a reset is a human task: the customer asks,
 * a request lands here, an admin resets from the customer page (which resolves
 * the request) or dismisses it.
 */
const app = new Hono<AppEnv>();

/** GET /admin/password-requests?status=open|all */
app.get("/", async (c) => {
  setNoStore(c);
  const status = (c.req.query("status") ?? "open").toLowerCase();
  const where = status === "all" ? "" : "WHERE r.status = 'open'";

  const requests = await all<{
    id: number;
    status: string;
    created_at: string;
    customer_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_e164: string | null;
    customer_status: string;
  }>(
    c.env.DB,
    `SELECT r.id, r.status, r.created_at, r.customer_id,
            cu.first_name, cu.last_name, cu.email, cu.phone_e164, cu.status AS customer_status
       FROM password_reset_requests r JOIN customers cu ON cu.id = r.customer_id
       ${where}
      ORDER BY r.created_at DESC LIMIT 200`,
  );

  return ok(
    c,
    requests.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      customer: {
        id: row.customer_id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone_e164,
        status: row.customer_status,
      },
    })),
  );
});

/** POST /admin/password-requests/:id/dismiss */
app.post("/:id/dismiss", async (c) => {
  setNoStore(c);
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isInteger(id)) throw ApiError.notFound("Request not found");

  const row = await first<{ id: number }>(c.env.DB, "SELECT id FROM password_reset_requests WHERE id = ?", [id]);
  if (!row) throw ApiError.notFound("Request not found");

  await run(
    c.env.DB,
    `UPDATE password_reset_requests SET status = 'dismissed', resolved_at = datetime('now'), resolved_by = ?
      WHERE id = ?`,
    [c.get("admin").id, id],
  );

  return ok(c, { ok: true });
});

export default app;
