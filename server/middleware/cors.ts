import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { isAllowedOrigin } from "./csrf";

/**
 * Same-origin by default. If a request arrives from an allowed origin
 * (SITE_URL or localhost) we reflect it — never a wildcard — and allow
 * credentials so the admin cookie works during local development.
 */
function applyCors(c: Context<AppEnv>, origin: string | undefined) {
  if (origin && isAllowedOrigin(c.env, origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }
}

export const cors = createMiddleware<AppEnv>(async (c, next) => {
  const origin = c.req.header("Origin");
  applyCors(c, origin);

  if (c.req.method.toUpperCase() === "OPTIONS") {
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    c.header(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-Idempotency-Key",
    );
    c.header("Access-Control-Max-Age", "86400");
    return c.body(null, 204);
  }

  await next();
  applyCors(c, origin);
});
