import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { all, count, first } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { setNoStore } from "../../middleware/cache";

/**
 * Read-only view of the `customers` rows that the Clerk webhook maintains.
 * Nothing here mutates identity — Clerk stays the source of truth.
 */
const app = new Hono<AppEnv>();

const STATUS_FILTERS = new Set(["all", "active", "deleted"]);

type CustomerRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  image_url: string | null;
  marketing_opt_in: number | null;
  sms_opt_in: number | null;
  status: string;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function present(r: CustomerRow) {
  return {
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    imageUrl: r.image_url,
    // NULL means "Clerk has never told us" — surface that as false.
    marketingOptIn: r.marketing_opt_in === 1,
    smsOptIn: r.sms_opt_in === 1,
    status: r.status,
    lastSignInAt: r.last_sign_in_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

/** GET /admin/customers?q=&status=all|active|deleted&page=&limit= */
app.get("/", async (c) => {
  setNoStore(c);
  const q = c.req.query("q")?.trim() ?? "";
  const status = (c.req.query("status") ?? "all").toLowerCase();
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50));

  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    where.push("(email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR id = ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (status !== "all" && STATUS_FILTERS.has(status)) {
    where.push("status = ?");
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [total, rows] = await Promise.all([
    count(c.env.DB, `SELECT COUNT(*) AS n FROM customers ${clause}`, params),
    all<CustomerRow>(
      c.env.DB,
      `SELECT * FROM customers ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    ),
  ]);

  return ok(c, rows.map(present), {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

/** GET /admin/customers/:id — the row plus what it bought here. */
app.get("/:id", async (c) => {
  setNoStore(c);
  const customer = await first<CustomerRow>(c.env.DB, "SELECT * FROM customers WHERE id = ?", [
    c.req.param("id"),
  ]);
  if (!customer) throw ApiError.notFound("Customer not found");

  const email = customer.email;
  const [stats, orders, subscription] = await Promise.all([
    email
      ? first<{ orders: number; spent_cents: number; last_order_at: string | null }>(
          c.env.DB,
          `SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS spent_cents,
                  MAX(created_at) AS last_order_at
             FROM orders WHERE email = ?`,
          [email],
        )
      : Promise.resolve(null),
    email
      ? all<{
          id: number;
          number: string;
          status: string;
          total_cents: number;
          currency: string;
          created_at: string;
        }>(
          c.env.DB,
          `SELECT id, number, status, total_cents, currency, created_at FROM orders
            WHERE email = ? ORDER BY created_at DESC LIMIT 5`,
          [email],
        )
      : Promise.resolve([]),
    email
      ? first<{ status: string; created_at: string }>(
          c.env.DB,
          "SELECT status, created_at FROM subscribers WHERE email = ?",
          [email],
        )
      : Promise.resolve(null),
  ]);

  return ok(c, {
    ...present(customer),
    stats: {
      orders: Number(stats?.orders ?? 0),
      spentCents: Number(stats?.spent_cents ?? 0),
      lastOrderAt: stats?.last_order_at ?? null,
    },
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      totalCents: o.total_cents,
      currency: o.currency,
      createdAt: o.created_at,
    })),
    subscription: subscription
      ? { status: subscription.status, createdAt: subscription.created_at }
      : null,
  });
});

export default app;
