import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { verifyTurnstile } from "../../lib/turnstile";
import { clientIp, rateLimit } from "../../middleware/rateLimit";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const reviewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(4000),
  website: z.string().max(200).optional(), // honeypot
  turnstileToken: z.string().max(2000).optional(),
});

/** POST /products/:slug/reviews — submit a review (saved as pending). */
app.post(
  "/:slug/reviews",
  rateLimit({ scope: "review", limit: 5, windowMs: 10 * 60_000 }),
  async (c) => {
    setNoStore(c);
    const slug = c.req.param("slug");
    const product = await first<{ id: number }>(
      c.env.DB,
      "SELECT id FROM products WHERE slug = ? AND status = 'published'",
      [slug],
    );
    if (!product) throw ApiError.notFound("Product not found");

    const body = await parseJson(c, reviewSchema);
    if (body.website) return ok(c, { received: true }); // honeypot tripped

    const captchaOk = await verifyTurnstile(c.env, body.turnstileToken, clientIp(c));
    if (!captchaOk) throw new ApiError(400, "CAPTCHA_FAILED", "Captcha verification failed");

    // Flag as verified when this email has a paid order containing the product.
    const paid = await first<{ n: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS n
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.email = ? AND oi.product_id = ? AND o.payment_status = 'paid'`,
      [body.email, product.id],
    );

    await run(
      c.env.DB,
      `INSERT INTO reviews (product_id, author_name, email, rating, title, body, status, verified_purchase)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        product.id,
        cleanText(body.name, 80),
        body.email,
        body.rating,
        body.title ? cleanText(body.title, 120) : null,
        cleanText(body.body, 4000),
        Number(paid?.n ?? 0) > 0 ? 1 : 0,
      ],
    );

    return ok(c, { received: true });
  },
);

export default app;
