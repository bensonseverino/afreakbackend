import type { Context } from "hono";
import type { AppEnv } from "../env";

export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const NO_STORE = "no-store";

/**
 * Cache policy for CMS-driven content (CMS CONNECTION FIX §6.2).
 *
 * `no-cache` does not mean "do not store" — it means "always revalidate".
 * Combined with an ETag derived from the content version, a browser revalidates
 * every load (a cheap 304 when nothing changed) and can never render a stale
 * hero/lookbook/product after an admin save.
 */
export function setContentCache(c: Context<AppEnv>, version: number): boolean {
  const url = new URL(c.req.url);
  const etag = `W/"v${version}-${fnv1a(`${url.pathname}?${url.searchParams.toString()}`)}"`;
  c.header("Cache-Control", "no-cache");
  c.header("ETag", etag);
  c.header("Vary", "Origin");

  const inm = c.req.header("If-None-Match") ?? "";
  return inm
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === etag || tag === "*");
}

export function setNoStore(c: Context<AppEnv>): void {
  c.header("Cache-Control", NO_STORE);
}

/** Tiny stable hash — only needs to be collision-resistant within one version. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

