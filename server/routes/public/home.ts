import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { batch } from "../../lib/db";
import { ok } from "../../lib/http";
import { getSettings, currencyConfig } from "../../lib/settings";
import { listCardRows, rowsToCards, type ProductCard } from "../../lib/catalog";
import { HERO_SQL, LOOKBOOK_SQL } from "../../lib/contentQueries";
import { getContentVersion } from "../../lib/contentVersion";
import { setContentCache } from "../../middleware/cache";
import {
  serializeHeroSlide,
  serializeLookbookItem,
  serializeProductCard,
  serializeSettings,
  type HeroSlideRow,
  type LookbookRow,
} from "../../serializers";
import { PUBLIC_SETTINGS_KEYS } from "../../../shared/settingsKeys.js";

const app = new Hono<AppEnv>();

const SHOWCASE_SQL = `
  SELECT p.id, p.short_description, p.description, p.features_json
    FROM products p WHERE p.id = ? AND p.status = 'published'`;

function parseFeatures(raw: unknown): Array<Record<string, unknown>> {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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
  const env = c.env;
  const version = await getContentVersion(env);
  if (setContentCache(c, version)) return c.body(null, 304);

  const settings = await getSettings(env, PUBLIC_SETTINGS_KEYS);
  const publicSettings = serializeSettings(settings);
  const currency = currencyConfig(env, settings);

  // Hero + lookbook in a single D1 round trip.
  const [heroResult, lookbookResult] = await batch(env.DB, [
    { sql: HERO_SQL },
    { sql: LOOKBOOK_SQL },
  ]);
  const heroRows = (heroResult.results ?? []) as unknown as HeroSlideRow[];
  const lookbookRows = (lookbookResult.results ?? []) as unknown as LookbookRow[];

  const [featuredFlagged, newArrivals, showcaseRow, showcaseDetail] = await Promise.all([
    cards(env, ["p.status = 'published'", "p.is_featured = 1"], "p.id DESC", 4),
    cards(env, ["p.status = 'published'", "p.is_new = 1"], "p.created_at DESC, p.id DESC", 5),
    publicSettings.showcase.productId
      ? listCardRows(env, {
          where: ["p.status = 'published'", "p.id = ?"],
          params: [publicSettings.showcase.productId],
          orderBy: "p.id",
          limit: 1,
        })
      : Promise.resolve([]),
    publicSettings.showcase.productId
      ? env.DB.prepare(SHOWCASE_SQL).bind(publicSettings.showcase.productId).first<{
          id: number;
          short_description: string | null;
          description: string | null;
          features_json: string;
        }>()
      : Promise.resolve(null),
  ]);

  // Pad featured to 4 with the newest published products if too few are flagged.
  let featured = featuredFlagged;
  if (featured.length < 4) {
    const newest = await cards(env, ["p.status = 'published'"], "p.created_at DESC, p.id DESC", 8);
    const have = new Set(featured.map((p) => p.id));
    for (const card of newest) {
      if (featured.length >= 4) break;
      if (!have.has(card.id)) {
        featured = [...featured, card];
        have.add(card.id);
      }
    }
  }

  // Showcase: only the product explicitly chosen in the CMS. With no selection
  // the section is null (§4.1) — falling back to a featured product here would
  // make the storefront show content the admin never picked (cause C-6).
  const showcaseCard = (await rowsToCards(env, showcaseRow))[0] ?? null;
  const showcase = showcaseCard
    ? {
        ...serializeProductCard(showcaseCard as unknown as Record<string, unknown>),
        shortDescription: showcaseDetail?.short_description ?? null,
        description: showcaseDetail?.description ?? null,
        features: parseFeatures(showcaseDetail?.features_json),
      }
    : null;

  return ok(c, {
    version,
    currency: currency.code,
    currencyLocale: currency.locale,
    promoBar: publicSettings.promoBar,
    // Arrays are always arrays; an empty store gets its first-run fallback from
    // the storefront's single `data/defaults.js`, never from the API (§5.3).
    heroSlides: heroRows.map(serializeHeroSlide),
    featured: featured.map((card) => serializeProductCard(card as unknown as Record<string, unknown>)),
    showcase,
    lookbook: lookbookRows.map(serializeLookbookItem),
    shippingBanner: publicSettings.shippingBanner,
    newArrivals: newArrivals.map((card) =>
      serializeProductCard(card as unknown as Record<string, unknown>),
    ),
    menuFeature: publicSettings.menuFeature,
    footer: publicSettings.footer,
  });
});

export default app;
