import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, count, first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { sendShippingEmail } from "../../lib/mail";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const ORDER_STATUSES = [
  "pending",
  "paid",
  "in_production",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: unknown[][], header: string[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** GET /admin/orders/export.csv */
app.get("/export.csv", async (c) => {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT number, created_at, email, status, payment_status, delivery_method,
            subtotal_cents, discount_cents, shipping_cents, total_cents, currency, tracking_number
       FROM orders ORDER BY created_at DESC LIMIT 5000`,
  );
  const csv = toCsv(
    rows.map((r) => [
      r.number,
      r.created_at,
      r.email,
      r.status,
      r.payment_status,
      r.delivery_method,
      r.subtotal_cents,
      r.discount_cents,
      r.shipping_cents,
      r.total_cents,
      r.currency,
      r.tracking_number,
    ]),
    [
      "number", "created_at", "email", "status", "payment_status", "delivery_method",
      "subtotal_cents", "discount_cents", "shipping_cents", "total_cents", "currency", "tracking_number",
    ],
  );
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="orders.csv"');
  setNoStore(c);
  return c.body(csv);
});

/** GET /admin/orders */
app.get("/", async (c) => {
  setNoStore(c);
  const status = c.req.query("status");
  const q = c.req.query("q")?.trim();
  const from = c.req.query("from");
  const to = c.req.query("to");
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query("limit") ?? "20", 10) || 20));

  const where: string[] = [];
  const params: unknown[] = [];
  if (status && (ORDER_STATUSES as readonly string[]).includes(status)) {
    where.push("status = ?");
    params.push(status);
  }
  if (q) {
    where.push("(number LIKE ? OR email LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (from) {
    where.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    where.push("created_at <= ?");
    params.push(to);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await count(c.env.DB, `SELECT COUNT(*) AS n FROM orders ${whereSql}`, params);
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, number, email, phone, status, payment_status, delivery_method, promo_code,
            subtotal_cents, discount_cents, shipping_cents, total_cents, currency,
            tracking_number, created_at, updated_at,
            (SELECT COUNT(*) FROM order_items WHERE order_id = orders.id) AS item_count
       FROM orders ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return ok(
    c,
    rows.map((r) => ({
      id: r.id,
      number: r.number,
      email: r.email,
      status: r.status,
      paymentStatus: r.payment_status,
      deliveryMethod: r.delivery_method,
      totalCents: r.total_cents,
      currency: r.currency,
      itemCount: Number(r.item_count ?? 0),
      trackingNumber: r.tracking_number,
      createdAt: r.created_at,
    })),
    { total, page, pages: Math.max(1, Math.ceil(total / limit)) },
  );
});

/** GET /admin/orders/:id */
app.get("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const order = await first<Record<string, unknown>>(c.env.DB, "SELECT * FROM orders WHERE id = ?", [id]);
  if (!order) throw ApiError.notFound("Order not found");

  const items = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, product_id, variant_id, name, color_name, size, qty, unit_price_cents, print_json
       FROM order_items WHERE order_id = ? ORDER BY id`,
    [id],
  );

  return ok(c, {
    id: order.id,
    number: order.number,
    email: order.email,
    phone: order.phone,
    status: order.status,
    paymentStatus: order.payment_status,
    deliveryMethod: order.delivery_method,
    promoCode: order.promo_code,
    subtotalCents: order.subtotal_cents,
    discountCents: order.discount_cents,
    shippingCents: order.shipping_cents,
    totalCents: order.total_cents,
    currency: order.currency,
    address: safeParse(order.shipping_address_json as string, {}),
    notes: order.notes,
    trackingNumber: order.tracking_number,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      variantId: i.variant_id,
      name: i.name,
      colorName: i.color_name,
      size: i.size,
      qty: i.qty,
      unitPriceCents: i.unit_price_cents,
      print: safeParse<Record<string, unknown> | null>(i.print_json as string, null),
    })),
  });
});

/** PATCH /admin/orders/:id — status, tracking number, notes. */
app.patch("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const order = await first<Record<string, unknown>>(
    c.env.DB,
    "SELECT id, number, email, status FROM orders WHERE id = ?",
    [id],
  );
  if (!order) throw ApiError.notFound("Order not found");

  const body = await parseJson(
    c,
    z.object({
      status: z.enum(ORDER_STATUSES).optional(),
      trackingNumber: z.string().trim().max(120).nullable().optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
      paymentStatus: z.enum(["unpaid", "paid", "refunded"]).optional(),
    }),
  );

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.status) {
    sets.push("status = ?");
    params.push(body.status);
  }
  if (body.paymentStatus) {
    sets.push("payment_status = ?");
    params.push(body.paymentStatus);
  }
  if (body.trackingNumber !== undefined) {
    sets.push("tracking_number = ?");
    params.push(body.trackingNumber ? cleanText(body.trackingNumber, 120) : null);
  }
  if (body.notes !== undefined) {
    sets.push("notes = ?");
    params.push(body.notes ? cleanText(body.notes, 2000) : null);
  }
  if (!sets.length) return ok(c, { updated: false });

  sets.push("updated_at = datetime('now')");
  await run(c.env.DB, `UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);

  if (body.status === "shipped") {
    c.executionCtx.waitUntil(
      sendShippingEmail(c.env, {
        number: String(order.number),
        email: String(order.email),
        trackingNumber: body.trackingNumber ?? null,
      }).catch(() => {}),
    );
  }

  return ok(c, { updated: true });
});

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default app;
