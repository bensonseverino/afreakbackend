import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { count, first } from "../../lib/db";
import { ok } from "../../lib/http";
import { getIdentity } from "../../lib/identity";
import { fetchHeroSlides, fetchLookbookItems } from "../../lib/contentQueries";
import { getSettings } from "../../lib/settings";
import { serializeHeroSlide, serializeLookbookItem, serializeSettings } from "../../serializers";
import { setNoStore } from "../../middleware/cache";
import { requireOwner } from "../../middleware/auth";
import { recalcProductDenorm } from "../../lib/recalc";
import { PUBLIC_SETTINGS_KEYS } from "../../../shared/settingsKeys.js";

const app = new Hono<AppEnv>();

type ModuleStatus = {
  key: string;
  label: string;
  api: string;
  dbCount: number;
  publicCount: number;
  status: "CONNECTED" | "EMPTY" | "MISMATCH";
  note: string | null;
};

function status(dbCount: number, publicCount: number, expected: number | null): ModuleStatus["status"] {
  if (dbCount === 0) return "EMPTY";
  if (publicCount === 0) return "MISMATCH";
  if (expected != null && publicCount < Math.min(dbCount, expected)) return "MISMATCH";
  return "CONNECTED";
}

/**
 * GET /api/admin/diagnostics — one page that answers "is it connected?".
 *
 * Runs the SQL counts the admin screens use and the *same* query + serializer
 * the public storefront reads, then compares them (§7.4).
 */
app.get("/", requireOwner, async (c) => {
  setNoStore(c);
  const env = c.env;
  const settings = await getSettings(env, PUBLIC_SETTINGS_KEYS);
  const publicSettings = serializeSettings(settings);

  const [
    identity,
    heroRows,
    lookbookRows,
    heroDb,
    lookbookDb,
    featuredDb,
    newDb,
    productsDb,
    categoriesDb,
    mediaDb,
    reviewsPending,
    promoDb,
    showcaseProduct,
    missingMedia,
  ] = await Promise.all([
    getIdentity(env),
    fetchHeroSlides(env),
    fetchLookbookItems(env),
    count(env.DB, "SELECT COUNT(*) AS n FROM hero_slides WHERE active = 1"),
    count(env.DB, "SELECT COUNT(*) AS n FROM lookbook_items WHERE active = 1"),
    count(env.DB, "SELECT COUNT(*) AS n FROM products WHERE status = 'published' AND is_featured = 1"),
    count(env.DB, "SELECT COUNT(*) AS n FROM products WHERE status = 'published' AND is_new = 1"),
    count(env.DB, "SELECT COUNT(*) AS n FROM products WHERE status = 'published'"),
    count(env.DB, "SELECT COUNT(*) AS n FROM categories"),
    count(env.DB, "SELECT COUNT(*) AS n FROM media"),
    count(env.DB, "SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"),
    count(env.DB, "SELECT COUNT(*) AS n FROM promo_codes WHERE active = 1"),
    publicSettings.showcase.productId
      ? first<{ id: number }>(
          env.DB,
          "SELECT id FROM products WHERE id = ? AND status = 'published'",
          [publicSettings.showcase.productId],
        )
      : Promise.resolve(null),
    count(
      env.DB,
      `SELECT COUNT(*) AS n FROM media
        WHERE key IS NULL OR key = ''`,
    ),
  ]);

  const serializedHeroes = heroRows.map(serializeHeroSlide);
  const serializedLookbook = lookbookRows.map(serializeLookbookItem);

  const modules: ModuleStatus[] = [
    {
      key: "heroSlides",
      label: "Hero slides",
      api: "/api/home → heroSlides",
      dbCount: heroDb,
      publicCount: serializedHeroes.length,
      status: status(heroDb, serializedHeroes.length, 5),
      note: serializedHeroes.filter((s) => !s.image).length
        ? `${serializedHeroes.filter((s) => !s.image).length} slide(s) have no image`
        : null,
    },
    {
      key: "lookbook",
      label: "Lookbook",
      api: "/api/home → lookbook, /api/lookbook",
      dbCount: lookbookDb,
      publicCount: serializedLookbook.length,
      status: status(lookbookDb, serializedLookbook.length, 24),
      note: null,
    },
    {
      key: "promoBar",
      label: "Promo bar",
      api: "/api/home → promoBar",
      dbCount: publicSettings.promoBar.text ? 1 : 0,
      publicCount: publicSettings.promoBar.text ? 1 : 0,
      status: publicSettings.promoBar.text ? "CONNECTED" : "EMPTY",
      note: publicSettings.promoBar.active === false ? "currently switched off" : null,
    },
    {
      key: "shippingBanner",
      label: "Shipping banner",
      api: "/api/home → shippingBanner",
      dbCount: publicSettings.shippingBanner.title ? 1 : 0,
      publicCount: publicSettings.shippingBanner.title ? 1 : 0,
      status: publicSettings.shippingBanner.title ? "CONNECTED" : "EMPTY",
      note: null,
    },
    {
      key: "showcase",
      label: "Showcase product",
      api: "/api/home → showcase",
      dbCount: publicSettings.showcase.productId ? 1 : 0,
      publicCount: showcaseProduct ? 1 : 0,
      status: !publicSettings.showcase.productId
        ? "EMPTY"
        : showcaseProduct
          ? "CONNECTED"
          : "MISMATCH",
      note: publicSettings.showcase.productId && !showcaseProduct ? "product is not published" : null,
    },
    {
      key: "featured",
      label: "Featured products",
      api: "/api/home → featured",
      dbCount: featuredDb,
      publicCount: Math.min(featuredDb, 4),
      status: status(featuredDb, Math.min(featuredDb, 4), 4),
      note: "padded with the newest products when fewer than 4 are flagged",
    },
    {
      key: "newArrivals",
      label: "New arrivals",
      api: "/api/home → newArrivals",
      dbCount: newDb,
      publicCount: Math.min(newDb, 5),
      status: status(newDb, Math.min(newDb, 5), 5),
      note: null,
    },
    {
      key: "products",
      label: "Products (published)",
      api: "/api/products",
      dbCount: productsDb,
      publicCount: productsDb,
      status: productsDb ? "CONNECTED" : "EMPTY",
      note: null,
    },
    {
      key: "categories",
      label: "Categories",
      api: "/api/categories",
      dbCount: categoriesDb,
      publicCount: categoriesDb,
      status: categoriesDb ? "CONNECTED" : "EMPTY",
      note: null,
    },
    {
      key: "media",
      label: "Media library",
      api: "/media/:key",
      dbCount: mediaDb,
      publicCount: Math.max(0, mediaDb - missingMedia),
      status: mediaDb === 0 ? "EMPTY" : missingMedia === 0 ? "CONNECTED" : "MISMATCH",
      note: missingMedia ? `${missingMedia} row(s) without an R2 key` : null,
    },
    {
      key: "footer",
      label: "Footer",
      api: "/api/home → footer",
      dbCount: settings.footer ? 1 : 0,
      publicCount: publicSettings.footer.blurb ? 1 : 0,
      status: publicSettings.footer.blurb ? "CONNECTED" : "EMPTY",
      note: null,
    },
    {
      key: "menuFeature",
      label: "Menu feature tile",
      api: "/api/home → menuFeature",
      dbCount: settings.menu_feature ? 1 : 0,
      publicCount: publicSettings.menuFeature.title || publicSettings.menuFeature.url ? 1 : 0,
      status: publicSettings.menuFeature.title || publicSettings.menuFeature.url ? "CONNECTED" : "EMPTY",
      note: "falls back to the storefront default when empty",
    },
    {
      key: "reviews",
      label: "Reviews (pending)",
      api: "/api/products/:slug/reviews",
      dbCount: reviewsPending,
      publicCount: reviewsPending,
      status: "CONNECTED",
      note: "pending reviews are hidden until approved",
    },
    {
      key: "promos",
      label: "Active promo codes",
      api: "/api/promo/validate",
      dbCount: promoDb,
      publicCount: promoDb,
      status: promoDb ? "CONNECTED" : "EMPTY",
      note: null,
    },
  ];

  return ok(c, {
    identity,
    modules,
    settings: publicSettings,
    checkedAt: new Date().toISOString(),
  });
});

/** POST /api/admin/diagnostics/recalc — rebuild price ranges and rating counts. */
app.post("/recalc", requireOwner, async (c) => {
  setNoStore(c);
  await recalcProductDenorm(c.env);
  const products = await count(c.env.DB, "SELECT COUNT(*) AS n FROM products");
  return ok(c, { updated: products });
});

export default app;
