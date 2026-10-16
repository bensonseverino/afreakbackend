import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { ApiError, ok } from "../../lib/http";
import { parseJson } from "../../lib/validate";
import { getSetting, putSetting } from "../../lib/settings";
import { requireOwner } from "../../middleware/auth";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

/** Keys the CMS may read/write through this endpoint. */
const ALLOWED_KEYS = [
  "store",
  "promo_bar",
  "shipping",
  "shipping_banner",
  "showcase",
  "footer",
  "demo_payment",
] as const;

function assertKey(key: string) {
  if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
    throw ApiError.notFound("Unknown settings key");
  }
}

app.get("/:key", async (c) => {
  setNoStore(c);
  const key = c.req.param("key");
  assertKey(key);
  return ok(c, await getSetting(c.env, key));
});

app.put("/:key", requireOwner, async (c) => {
  setNoStore(c);
  const key = c.req.param("key");
  assertKey(key);
  const body = await parseJson(c, z.object({ value: z.unknown() }));
  await putSetting(c.env, key, body.value);
  return ok(c, await getSetting(c.env, key));
});

export default app;
