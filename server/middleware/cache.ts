import type { Context } from "hono";
import type { AppEnv } from "../env";

export const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const NO_STORE = "no-store";

export function setPublicCache(c: Context<AppEnv>): void {
  c.header("Cache-Control", PUBLIC_CACHE);
}

export function setNoStore(c: Context<AppEnv>): void {
  c.header("Cache-Control", NO_STORE);
}
