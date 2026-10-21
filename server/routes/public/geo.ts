import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { ok } from "../../lib/http";

const app = new Hono<AppEnv>();

/**
 * GET /api/geo — ISO country of the visitor, used only to pick a sensible
 * starting currency (spec §3). Country comes from Cloudflare's edge; the raw IP
 * is never read or stored.
 */
app.get("/", (c) => {
  const request = c.req.raw as Request & { cf?: { country?: string } };
  const country = request.cf?.country ?? null;
  // Per-visitor data: never let a shared cache hand one country to everyone.
  c.header("Cache-Control", "private, max-age=3600");
  return ok(c, { country });
});

export default app;
