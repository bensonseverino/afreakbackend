import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { ok } from "../../lib/http";
import { getSettings } from "../../lib/settings";
import { setPublicCache } from "../../middleware/cache";

const app = new Hono<AppEnv>();

/** Public-safe settings for the storefront (no secrets). */
app.get("/", async (c) => {
  setPublicCache(c);
  const settings = await getSettings(c.env, [
    "store",
    "promo_bar",
    "shipping",
    "shipping_banner",
    "footer",
  ]);
  return ok(c, {
    currency: c.env.CURRENCY,
    store: settings.store,
    promoBar: settings.promo_bar,
    shipping: settings.shipping,
    shippingBanner: settings.shipping_banner,
    footer: settings.footer,
  });
});

export default app;
