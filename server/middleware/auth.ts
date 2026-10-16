import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { getSessionAdmin } from "../lib/session";
import { ApiError } from "../lib/http";

/** Rejects the request unless a valid admin session cookie is present. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const admin = await getSessionAdmin(c.env, c.req.raw);
  if (!admin) throw ApiError.unauthorized();
  c.set("admin", admin);
  await next();
});

/** Further restricts a route to `owner` admins. Must run after `requireAdmin`. */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  const admin = c.get("admin");
  if (!admin || admin.role !== "owner") throw ApiError.forbidden("Owner role required");
  await next();
});
