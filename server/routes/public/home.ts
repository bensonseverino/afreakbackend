import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { all } from "../../lib/db";
import { ok } from "../../lib/http";
import { imageShape } from "../../lib/media";
import { getSettings } from "../../lib/settings";
import { listCardRows, rowsToCards, type ProductCard } from "../../lib/catalog";
import { setPublicCache } from "../../middleware/cache";

const app = new Hono<AppEnv>();

async function cards(
  env: AppEnv["Bindings"],
  where: string[],
  orderBy: string,
  limit: number,
): Promise<ProductCard[]> {
  const rows = await listCardRows(env, { where, params: [], orderBy, limit });
  return rowsToCards(env, rows);
}

/** GET /home — everything the homepage needs in one request. */
app.get("/", async (c) => {
  setPublicCache(c);
  const env = c.env;
  const settings = await getSettings(env, [
    "promo_bar",
    "shipping_banner",
    "footer",
    "showcase",
  ]);

  const [heroRows, lookbookRows, featured, newArrivals] = await Promise.all([
    all<{
      id: number;
      eyebrow: string | null;
      title: string;
      subtitle: string | null;
      cta_label: string | null;
      cta_url: string | null;
      key: string | null;
      alt: string | null;
      width: number | null;
      height: number | null;
    }>(
      env.DB,
      `SELECT h.id, h.eyebrow, h.title, h.subtitle, h.cta_label, h.cta_url,
              m.key, m.alt, m.width, m.height
         FROM hero_slides h LEFT JOIN media m ON m.id = h.media_id
        WHERE h.active = 1 ORDER BY h.sort, h.id`,
    ),
    all<{
      id: number;
      caption: string | null;
      link_url: string | null;
      key: string;
      alt: string | null;
      width: number | null;
      height: number | null;
    }>(
      env.DB,
      `SELECT li.id, li.caption, li.link_url, m.key, m.alt, m.width, m.height
         FROM lookbook_items li JOIN media m ON m.id = li.media_id
        WHERE li.active = 1 ORDER BY li.sort, li.id LIMIT 8`,
    ),
    cards(env, ["p.status = 'published'", "p.is_featured = 1"], "p.id DESC", 4),
    cards(env, ["p.status = 'published'", "p.is_new = 1"], "p.created_at DESC, p.id DESC", 5),
  ]);

  // Pad featured to 4 with the newest products if not enough are flagged.
  let featuredList = featured;
  if (featuredList.length < 4) {
    const newest = await cards(env, ["p.status = 'published'"], "p.created_at DESC, p.id DESC", 8);
    const have = new Set(featuredList.map((p) => p.id));
    for (const card of newest) {
      if (featuredList.length >= 4) break;
      if (!have.has(card.id)) {
        featuredList = [...featuredList, card];
        have.add(card.id);
      }
    }
  }

  // Showcase product (settings.showcase.product_id) with fallback to first featured.
  const showcaseId = (settings.showcase as { product_id?: number | null })?.product_id;
  let showcase: ProductCard | null = null;
  if (showcaseId) {
    const rows = await listCardRows(env, {
      where: ["p.status = 'published'", "p.id = ?"],
      params: [showcaseId],
      orderBy: "p.id",
      limit: 1,
    });
    showcase = (await rowsToCards(env, rows))[0] ?? null;
  }
  if (!showcase) showcase = featuredList[0] ?? null;

  return ok(c, {
    promoBar: settings.promo_bar,
    heroSlides: heroRows.map((h) => ({
      id: h.id,
      eyebrow: h.eyebrow,
      title: h.title,
      subtitle: h.subtitle,
      ctaLabel: h.cta_label,
      ctaUrl: h.cta_url,
      image: imageShape(h.key ? { key: h.key, alt: h.alt, width: h.width, height: h.height } : null),
    })),
    featured: featuredList,
    showcase,
    newArrivals,
    lookbook: lookbookRows.map((l) => ({
      id: l.id,
      caption: l.caption,
      linkUrl: l.link_url,
      image: imageShape({ key: l.key, alt: l.alt, width: l.width, height: l.height }),
    })),
    shippingBanner: settings.shipping_banner,
    footer: settings.footer,
  });
});

export default app;
