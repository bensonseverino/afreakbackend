import type { Context } from "hono";

/**
 * Cloudflare bindings + vars available to every Pages Function.
 * Secrets are set with `wrangler pages secret put`.
 */
export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  SESSION_SECRET: string;
  SETUP_TOKEN: string;
  TURNSTILE_SECRET?: string;
  SITE_URL: string;
  CURRENCY: string;
  FREE_SHIPPING_THRESHOLD_CENTS: string;
  FLAT_SHIPPING_CENTS: string;
  EXPRESS_SHIPPING_CENTS?: string;
};

export type AdminRole = "owner" | "editor";

/** The authenticated admin attached to a request by `requireAdmin`. */
export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  sessionId: string;
};

export type Variables = {
  admin: AdminUser;
};

export type AppEnv = { Bindings: Env; Variables: Variables };
export type AppContext = Context<AppEnv>;
