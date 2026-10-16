import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { ok } from "../../lib/http";
import { parseJson } from "../../lib/validate";
import { findPromo, promoUsable } from "../../lib/promo";
import { promoDiscount } from "../../lib/money";
import { setNoStore } from "../../middleware/cache";
import { rateLimit } from "../../middleware/rateLimit";

const app = new Hono<AppEnv>();

const schema = z.object({
  code: z.string().trim().min(1).max(40),
  subtotalCents: z.coerce.number().int().min(0),
});

app.post("/validate", rateLimit({ scope: "promo", limit: 20, windowMs: 10 * 60_000 }), async (c) => {
  setNoStore(c);
  const body = await parseJson(c, schema);
  const promo = await findPromo(c.env, body.code);

  if (!promo) {
    return ok(c, { valid: false, reason: "Invalid code" });
  }
  const check = promoUsable(promo, body.subtotalCents);
  if (!check.usable) {
    return ok(c, { valid: false, reason: check.reason });
  }

  return ok(c, {
    valid: true,
    code: promo.code,
    type: promo.type,
    value: promo.value,
    discountCents: promoDiscount(promo, body.subtotalCents),
  });
});

export default app;
