import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { getSessionCustomer } from "../lib/customerSession";

/**
 * Customer sessions.
 *
 * Accounts are Afreak's own now, so this is the customer counterpart of
 * `auth.ts` — and the same shape: a signed HttpOnly cookie, a hashed session row
 * in D1, and a sliding expiry. The difference is that a customer has to be
 * `active`: a pending, rejected, suspended or deleted account cannot reach any
 * customer route, even if it somehow holds a cookie.
 */

/**
 * The only requests a customer may make while a password change is due: read
 * their own profile, change the password, or sign out.
 */
function allowedWhileMustChange(method: string, pathname: string): boolean {
  if (pathname.endsWith("/account/change-password")) return true;
  if (pathname.endsWith("/account/auth/logout")) return true;
  return method.toUpperCase() === "GET" && pathname.endsWith("/account/me");
}

/** Rejects the request unless it carries a session for an active customer. */
export const requireCustomer = createMiddleware<AppEnv>(async (c, next) => {
  const resolved = await getSessionCustomer(c.env, c.req.raw);
  if (!resolved) throw ApiError.unauthorized("Sign in to continue");

  const { customer } = resolved;
  if (customer.status !== "active") {
    throw ApiError.forbidden("This account is not active");
  }
  if (
    customer.mustChangePassword &&
    !allowedWhileMustChange(c.req.method, new URL(c.req.url).pathname)
  ) {
    throw new ApiError(
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "Choose a new password before continuing",
    );
  }

  c.set("customer", customer);
  await next();
});

/**
 * Attaches the customer when a valid session is present, and otherwise says
 * nothing. Used on routes guests may also use (checkout, order creation, quote),
 * so every failure is swallowed.
 */
export const optionalCustomer = createMiddleware<AppEnv>(async (c, next) => {
  try {
    const resolved = await getSessionCustomer(c.env, c.req.raw);
    if (resolved?.customer.status === "active") c.set("customer", resolved.customer);
  } catch {
    /* anonymous is always an acceptable answer here */
  }
  await next();
});
