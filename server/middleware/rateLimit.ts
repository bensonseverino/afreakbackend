import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { Env, AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { sha256Hex } from "../lib/hash";

/** Best-effort client IP behind Cloudflare. */
export function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    (c.req.header("X-Forwarded-For") || "").split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

/** Salted hash so raw IPs are never stored (GDPR-friendly). */
export function ipHash(env: Env, ip: string): Promise<string> {
  return sha256Hex(`${env.SESSION_SECRET || "dev"}:${ip}`);
}

type Bucket = { count: number; resetAt: number };

/**
 * Lightweight in-memory sliding-window limiter. It lives for the lifetime of a
 * Worker isolate (Workers reuse isolates), so it is cheap and needs no KV/D1.
 * For hard guarantees also enable a Cloudflare WAF rate-limit rule (Part 2).
 */
const buckets = new Map<string, Bucket>();

export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistically drop expired buckets so the map can't grow unbounded.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    const retry = Math.ceil((bucket.resetAt - now) / 1000);
    throw ApiError.rateLimited(`Too many requests — try again in ${retry}s`);
  }
}

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  /** Namespace so different routes don't share a bucket. */
  scope: string;
  /** Include the request path in the key (per-endpoint limits). */
  perPath?: boolean;
};

/** Middleware form: key on IP (+ optional path). */
export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = `${opts.scope}:${clientIp(c)}${opts.perPath ? `:${new URL(c.req.url).pathname}` : ""}`;
    enforceRateLimit(key, opts.limit, opts.windowMs);
    await next();
  });
}
