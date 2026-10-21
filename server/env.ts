import type { Context } from "hono";
import type { Customer } from "./lib/customers";

/**
 * Cloudflare bindings + vars available to every Pages Function.
 * Secrets are set with `wrangler pages secret put`.
 */
export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  SESSION_SECRET: string;
  TURNSTILE_SECRET?: string;
  SITE_URL: string;
  /** Dial code used when a phone number arrives without a country code. */
  DEFAULT_PHONE_COUNTRY?: string;
  CURRENCY: string;
  FREE_SHIPPING_THRESHOLD_CENTS: string;
  FLAT_SHIPPING_CENTS: string;
  EXPRESS_SHIPPING_CENTS?: string;
  /** ExchangeRate-API key; when absent the free open.er-api.com feed is used. */
  EXCHANGE_RATE_API_KEY?: string;
  /** Hours a cached rate stays fresh before a refetch. Defaults to 6. */
  RATES_TTL_HOURS?: string;
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
  /** Set by `requireCustomer` / `optionalCustomer` for a valid session cookie. */
  customer?: Customer;
};

export type AppEnv = { Bindings: Env; Variables: Variables };
export type AppContext = Context<AppEnv>;
