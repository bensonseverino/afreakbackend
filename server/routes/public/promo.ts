import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { ok } from "../../lib/http";
import { parseJson } from "../../lib/validate";
import { findPromo, promoInCurrency, promoUsable } from "../../lib/promo";
import { CATALOG_CURRENCY, promoDiscount } from "../../lib/money";
import { getCurrency } from "../../lib/settings";
import { getRates } from "../../lib/rates";
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
  const found = await findPromo(c.env, body.code);

  if (!found) {
    return ok(c, { valid: false, reason: "Invalid code" });
  }

  // Promo thresholds and fixed values are stored in the store currency, while
  // the storefront sends its subtotal in the catalog currency.
  const storeCurrency = (await getCurrency(c.env)).code;
  const promo =
    storeCurrency === CATALOG_CURRENCY
      ? found
      : promoInCurrency(found, (await getRates(c.env)).rates, storeCurrency);
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
