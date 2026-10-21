import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { ok } from "../../lib/http";
import { getRates } from "../../lib/rates";

const app = new Hono<AppEnv>();

/**
 * GET /api/rates — display rates for the currency switcher (spec §4).
 * Cached for 15 minutes at the edge; the D1 cache honours RATES_TTL_HOURS.
 */
app.get("/", async (c) => {
  const rates = await getRates(c.env);
  c.header("Cache-Control", "public, max-age=900");
  return ok(c, rates);
});

export default app;
