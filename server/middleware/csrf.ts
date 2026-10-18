import { createMiddleware } from "hono/factory";
import type { Env, AppEnv } from "../env";
import { ApiError } from "../lib/http";

/** True when `origin` is the origin serving the request itself. */
export function matchesRequestOrigin(requestUrl: string, origin: string): boolean {
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

/** Origins we accept as same-site (the configured SITE_URL plus any localhost port). */
export function isAllowedOrigin(env: Env, origin: string): boolean {
  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }

  const host = candidate.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;

  try {
    return new URL(env.SITE_URL).origin === candidate.origin;
  } catch {
    return true; // SITE_URL unparseable → don't brick local dev
  }
}

/**
 * CSRF guard for mutating requests: if the browser sent an Origin header it
 * must match the site. Requests without an Origin (curl, server-to-server) pass.
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  const origin = c.req.header("Origin");
  if (origin && !matchesRequestOrigin(c.req.url, origin) && !isAllowedOrigin(c.env, origin)) {
    throw ApiError.forbidden("Cross-origin request rejected");
  }
  await next();
});
