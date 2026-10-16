import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { run } from "../../lib/db";
import { ok } from "../../lib/http";
import { parseJson } from "../../lib/validate";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const schema = z.object({
  type: z.enum(["product_view", "add_to_cart", "checkout_start"]),
  productId: z.coerce.number().int().positive().optional(),
});

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|headless|phantom|puppeteer|lighthouse/i;

/** POST /track — fire-and-forget daily counters (navigator.sendBeacon). */
app.post("/", async (c) => {
  setNoStore(c);
  const ua = c.req.header("User-Agent") ?? "";
  if (BOT_RE.test(ua)) return ok(c, { tracked: false });

  const body = await parseJson(c, schema);
  const day = new Date().toISOString().slice(0, 10);
  const productId = body.productId ?? 0;

  await run(
    c.env.DB,
    `INSERT INTO metrics_daily (day, type, product_id, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(day, type, product_id) DO UPDATE SET count = count + 1`,
    [day, body.type, productId],
  );

  return ok(c, { tracked: true });
});

export default app;
