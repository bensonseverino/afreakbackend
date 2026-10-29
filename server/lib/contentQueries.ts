/**
 * The authoritative hero/lookbook queries (CMS CONNECTION FIX §4.2).
 *
 * Shared by the public routes and `/api/admin/diagnostics` so the diagnostics
 * page compares the admin's view with the exact query the storefront reads.
 */
import type { Env } from "../env";
import { all } from "./db";
import type { HeroSlideRow, LookbookRow } from "../serializers";

export const HERO_SQL = `
  SELECT h.id, h.eyebrow, h.title, h.subtitle, h.cta_label, h.cta_url, h.sort,
         m.key AS media_key, m.alt AS media_alt, m.width AS media_w, m.height AS media_h
    FROM hero_slides h LEFT JOIN media m ON m.id = h.media_id
   WHERE h.active = 1 ORDER BY h.sort ASC, h.id ASC LIMIT 5`;

export const LOOKBOOK_SQL = `
  SELECT l.id, l.caption, l.link_url, l.sort,
         m.key AS media_key, m.alt AS media_alt, m.width AS media_w, m.height AS media_h
    FROM lookbook_items l JOIN media m ON m.id = l.media_id
   WHERE l.active = 1 ORDER BY l.sort ASC, l.id ASC LIMIT 24`;

export function fetchHeroSlides(env: Env): Promise<HeroSlideRow[]> {
  return all<HeroSlideRow>(env.DB, HERO_SQL);
}

export function fetchLookbookItems(env: Env): Promise<LookbookRow[]> {
  return all<LookbookRow>(env.DB, LOOKBOOK_SQL);
}
