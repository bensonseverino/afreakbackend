import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { batch, first, type BatchStatement } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { buildQuote } from "../../lib/checkout";
import { getSettings } from "../../lib/settings";
import { normalizePhoneE164 } from "../../lib/customers";
import { orderNumber } from "../../lib/ids";
import { sendOrderEmail } from "../../lib/mail";
import { setNoStore } from "../../middleware/cache";
import { optionalCustomer } from "../../middleware/customerAuth";
import { rateLimit } from "../../middleware/rateLimit";

const app = new Hono<AppEnv>();

const addressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().min(1).max(30),
  country: z.string().trim().min(1).max(80),
});

const orderSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).optional(),
  address: addressSchema,
  deliveryMethod: z.string().max(20).optional(),
  promoCode: z.string().trim().max(40).nullable().optional(),
  items: z
    .array(
      z.object({
        variantId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().min(1).max(50),
        print: z
          .object({
            placement: z.string().max(60).nullable().optional(),
            artworkKey: z.string().max(300).nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(50),
  marketingOptIn: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});

/** Guests order too, so both paths share one limiter. */
const orderLimiter = rateLimit({ scope: "order", limit: 10, windowMs: 10 * 60_000 });

/** POST /orders — create an order with server-authoritative pricing. */
app.post("/", optionalCustomer, orderLimiter, async (c) => {
  setNoStore(c);
  const env = c.env;
  const body = await parseJson(c, orderSchema);

  // A signed-in visitor's order names their account immediately. A guest order is
  // matched back later by email (see `linkGuestOrders`), so the email is the one
  // identifier that has to survive the round trip.
  const customer = c.get("customer");
  const phoneE164 = normalizePhoneE164(customer?.phone ?? body.phone);

  // Idempotency: replay returns the original order.
  const idempotencyKey = c.req.header("X-Idempotency-Key") ?? null;
  if (idempotencyKey) {
    const existing = await first<{ number: string; total_cents: number; email: string }>(
      env.DB,
      "SELECT number, total_cents, email FROM orders WHERE idempotency_key = ?",
      [idempotencyKey],
    );
    if (existing) {
      return ok(c, { number: existing.number, totalCents: existing.total_cents, email: existing.email });
    }
  }

  const quote = await buildQuote(env, {
    items: body.items,
    deliveryMethod: body.deliveryMethod,
    promoCode: body.promoCode,
  });

  const hardIssue = quote.issues.find(
    (i) => i.code === "OUT_OF_STOCK" || i.code === "UNAVAILABLE",
  );
  if (hardIssue) {
    throw ApiError.conflict(hardIssue.message, {
      code: "OUT_OF_STOCK",
      details: { lineId: hardIssue.lineId, variantId: hardIssue.variantId, available: hardIssue.available },
    });
  }
  const notCustomizable = quote.issues.find((i) => i.code === "NOT_CUSTOMIZABLE");
  if (notCustomizable) throw ApiError.badRequest(notCustomizable.message);

  const settings = await getSettings(env, ["demo_payment"]);
  const demo = !!(settings.demo_payment as { enabled?: boolean })?.enabled;
  const paymentStatus = demo ? "paid" : "unpaid";
  const status = demo ? "paid" : "pending";

  const number = orderNumber();
  const currency = quote.currency;

  const statements: BatchStatement[] = [];
  const decrementIndexes: number[] = [];

  statements.push({
    sql: `INSERT INTO orders
            (number, email, phone, status, payment_status, delivery_method, promo_code,
             subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, currency,
             shipping_address_json, idempotency_key, notes, customer_id, phone_e164)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      number,
      body.email,
      body.phone ? cleanText(body.phone, 40) : null,
      status,
      paymentStatus,
      quote.deliveryMethod,
      quote.promo?.valid ? quote.promo.code : null,
      quote.subtotalCents,
      quote.discountCents,
      quote.shippingCents,
      quote.totalCents,
      currency,
      JSON.stringify({
        line1: body.address.line1,
        line2: body.address.line2 ?? null,
        city: body.address.city,
        postalCode: body.address.postalCode,
        country: body.address.country,
      }),
      idempotencyKey,
      body.notes ? cleanText(body.notes, 2000) : null,
      customer?.id ?? null,
      phoneE164,
    ],
  });

  for (const line of quote.lines) {
    statements.push({
      sql: `INSERT INTO order_items
              (order_id, product_id, variant_id, name, color_name, size, qty, unit_price_cents, print_json)
            VALUES ((SELECT id FROM orders WHERE number = ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        number,
        line.productId,
        line.variantId,
        line.name,
        line.colorName,
        line.size,
        line.qty,
        line.unitPriceCents,
        line.print ? JSON.stringify(line.print) : null,
      ],
    });
  }

  for (const line of quote.lines) {
    decrementIndexes.push(statements.length);
    statements.push({
      sql: "UPDATE product_variants SET stock = stock - ? WHERE id = ? AND stock >= ?",
      params: [line.qty, line.variantId, line.qty],
    });
  }

  if (quote.promo?.valid) {
    statements.push({
      sql: "UPDATE promo_codes SET uses = uses + 1 WHERE code = ?",
      params: [quote.promo.code],
    });
  }

  const day = new Date().toISOString().slice(0, 10);
  statements.push({
    sql: `INSERT INTO metrics_daily (day, type, product_id, count) VALUES (?, 'order', 0, 1)
          ON CONFLICT(day, type, product_id) DO UPDATE SET count = count + 1`,
    params: [day],
  });

  if (body.marketingOptIn) {
    statements.push({
      sql: `INSERT INTO subscribers (email, source, status) VALUES (?, 'checkout', 'active')
            ON CONFLICT(email) DO UPDATE SET status = 'active'`,
      params: [body.email],
    });
  }

  const results = await batch(env.DB, statements);

  // A guarded decrement that didn't match means stock changed under us.
  const failedIndex = decrementIndexes.find((idx) => (results[idx]?.meta?.changes ?? 0) === 0);
  if (failedIndex != null) {
    const line = quote.lines[decrementIndexes.indexOf(failedIndex)];
    await batch(env.DB, [
      { sql: "DELETE FROM orders WHERE number = ?", params: [number] },
      ...(quote.promo?.valid
        ? [{ sql: "UPDATE promo_codes SET uses = MAX(uses - 1, 0) WHERE code = ?", params: [quote.promo.code] }]
        : []),
    ]);
    throw ApiError.conflict("Item sold out during checkout", {
      code: "OUT_OF_STOCK",
      details: { lineId: line?.lineId ?? 0, variantId: line?.variantId ?? 0, available: line?.stock ?? 0 },
    });
  }

  // Non-blocking confirmation email.
  c.executionCtx.waitUntil(
    sendOrderEmail(env, { number, email: body.email, totalCents: quote.totalCents, currency }).catch(() => {}),
  );

  return ok(c, { number, totalCents: quote.totalCents, email: body.email });
});

export default app;
