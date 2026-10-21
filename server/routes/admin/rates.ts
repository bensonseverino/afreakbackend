import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { ok } from "../../lib/http";
import { getRates } from "../../lib/rates";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

/** GET /api/admin/rates — current cache + attribution for the CMS rates card. */
app.get("/", async (c) => {
  setNoStore(c);
  return ok(c, await getRates(c.env));
});

/** POST /api/admin/rates/refresh — ignore the TTL and pull from the provider. */
app.post("/refresh", async (c) => {
  setNoStore(c);
  return ok(c, await getRates(c.env, { force: true }));
});

export default app;
