import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { ok } from "../../lib/http";
import { parseJson } from "../../lib/validate";
import { buildQuote } from "../../lib/checkout";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const schema = z.object({
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
    .max(50),
  deliveryMethod: z.string().max(20).optional(),
  promoCode: z.string().max(40).nullable().optional(),
});

/** POST /checkout/quote — authoritative totals + per-line validation. */
app.post("/quote", async (c) => {
  setNoStore(c);
  const body = await parseJson(c, schema);
  const quote = await buildQuote(c.env, body);
  return ok(c, quote);
});

export default app;
