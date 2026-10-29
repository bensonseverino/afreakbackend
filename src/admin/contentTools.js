/**
 * Shared helpers for the homepage-content editors (CMS CONNECTION FIX §6.6/§7.1).
 *
 * Kept out of the component file so fast refresh stays happy and the shop-wide
 * "live check" lives in one place.
 */

/** Origin that serves the public API (empty env var = same origin as the CMS). */
export const API_ORIGIN = import.meta.env.VITE_API_BASE ?? "";

/** Storefront origin, for the “VIEW ON SITE” links. */
export const SITE_URL = import.meta.env.VITE_SITE_URL ?? "https://afreak.pages.dev";

/**
 * Re-fetch a public endpoint with a cache-busting query and report whether the
 * saved record is actually being served. A save that never reaches the
 * storefront is the exact failure this whole spec exists to catch.
 */
export async function liveCheck(path, predicate) {
  try {
    const res = await fetch(`${API_ORIGIN}/api${path}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, reason: `public API answered ${res.status}` };
    const json = await res.json();
    return predicate(json?.data)
      ? { ok: true }
      : { ok: false, reason: "not in the public response yet" };
  } catch (err) {
    return { ok: false, reason: err?.message || "network error" };
  }
}

export function isExternalLink(url) {
  return /^https?:\/\//i.test(url ?? "");
}

/** CTA/link URL validation: internal `/path` or an absolute https:// URL (§7.1). */
export function ctaUrlError(url) {
  const value = (url ?? "").trim();
  if (!value) return null;
  if (value.startsWith("/")) return null;
  if (isExternalLink(value)) return null;
  return "Use /internal-path or https://example.com";
}

/** Move an item inside a list and return the new order. */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
