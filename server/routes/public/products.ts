import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, count, first } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseQuery } from "../../lib/validate";
import { imageShape } from "../../lib/media";
import { listCardRows, rowsToCards } from "../../lib/catalog";
import { getContentVersion } from "../../lib/contentVersion";
import { getSettings, currencyConfig } from "../../lib/settings";
import { sizesFor, type SizeType } from "../../lib/sizes";
import { slugify } from "../../lib/slug";
import { setContentCache } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const listQuery = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(["popular", "newest", "price_asc", "price_desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
  new: z.string().optional(),
  featured: z.string().optional(),
  customizable: z.string().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  colors: z.string().max(400).optional(),
  sizes: z.string().max(400).optional(),
  sizeType: z.enum(["apparel", "print", "one_size"]).optional(),
  inStock: z.string().optional(),
});

const SORTS: Record<string, string> = {
  popular: "p.rating_avg DESC, p.review_count DESC, p.id DESC",
  newest: "p.created_at DESC, p.id DESC",
  price_asc: "COALESCE(p.price_from_cents, p.price_cents) ASC, p.id DESC",
  price_desc: "COALESCE(p.price_from_cents, p.price_cents) DESC, p.id DESC",
};

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

/** GET /products — paginated product cards with filter facets. */
app.get("/", async (c) => {
  const version = await getContentVersion(c.env);
  if (setContentCache(c, version)) return c.body(null, 304);
  const q = parseQuery(c.req.query(), listQuery);

  const where: string[] = ["p.status = 'published'"];
  const params: unknown[] = [];

  const categories = csv(q.category).filter((slug) => slug !== "all");
  if (categories.length) {
    where.push(`c.slug IN (${categories.map(() => "?").join(",")})`);
    params.push(...categories);
  }
  if (q.q) {
    where.push("(p.name LIKE ? OR p.short_description LIKE ?)");
    params.push(`%${q.q}%`, `%${q.q}%`);
  }
  if (q.new === "1") where.push("p.is_new = 1");
  if (q.featured === "1") where.push("p.is_featured = 1");
  if (q.customizable === "1") where.push("p.customizable = 1");
  if (q.minPrice != null) {
    where.push("COALESCE(p.price_from_cents, p.price_cents) >= ?");
    params.push(q.minPrice);
  }
  if (q.maxPrice != null) {
    where.push("COALESCE(p.price_from_cents, p.price_cents) <= ?");
    params.push(q.maxPrice);
  }
  if (q.sizeType) {
    where.push("p.size_type = ?");
    params.push(q.sizeType);
  }

  const colors = csv(q.colors);
  if (colors.length) {
    where.push(
      `p.id IN (SELECT product_id FROM product_variants WHERE LOWER(color_name) IN (${colors
        .map(() => "?")
        .join(",")}))`,
    );
    params.push(...colors.map((c) => c.toLowerCase()));
  }
  const sizes = csv(q.sizes);
  if (sizes.length) {
    const inStock = q.inStock === "1" || q.inStock === "true" ? " AND (track_stock = 0 OR stock > 0)" : "";
    where.push(
      `p.id IN (SELECT product_id FROM product_variants WHERE size IN (${sizes.map(() => "?").join(",")})${inStock})`,
    );
    params.push(...sizes);
  }

  const whereSql = where.join(" AND ");
  const total = await count(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${whereSql}`,
    params,
  );

  const offset = (q.page - 1) * q.limit;
  const rows = await listCardRows(c.env, {
    where,
    params,
    orderBy: SORTS[q.sort ?? "popular"],
    limit: q.limit,
    offset,
  });
  const cards = await rowsToCards(c.env, rows);

  return ok(c, cards, {
    total,
    page: q.page,
    pages: Math.max(1, Math.ceil(total / q.limit)),
    facets: await facets(c.env),
  });
});

/** Filter-sidebar facets for the shop page. */
async function facets(env: AppEnv["Bindings"]) {
  const [categories, colors, sizes, price, sizeTypes] = await Promise.all([
    all<{ slug: string; name: string; n: number }>(
      env.DB,
      `SELECT c.slug, c.name, COUNT(p.id) AS n
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.status = 'published'
        GROUP BY c.id ORDER BY c.sort, c.name`,
    ),
    all<{ name: string; hex: string }>(
      env.DB,
      `SELECT pov.value AS name, COALESCE(pov.swatch_hex, '#000000') AS hex
         FROM product_option_values pov
         JOIN product_options po ON po.id = pov.option_id
         JOIN products p ON p.id = po.product_id
        WHERE po.type = 'color' AND p.status = 'published' AND pov.value <> 'Default'
        UNION
       SELECT v.color_name AS name, MIN(v.color_hex) AS hex
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.status = 'published' AND v.color_name <> 'Default' AND v.color_name <> ''
        GROUP BY LOWER(v.color_name)
        ORDER BY name`,
    ),
    all<{ size: string }>(
      env.DB,
      `SELECT DISTINCT v.size FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.status = 'published' ORDER BY v.size`,
    ),
    first<{ min_price: number | null; max_price: number | null }>(
      env.DB,
      `SELECT MIN(COALESCE(price_from_cents, price_cents)) AS min_price,
              MAX(COALESCE(price_to_cents, price_cents)) AS max_price
         FROM products WHERE status = 'published'`,
    ),
    all<{ size_type: string }>(
      env.DB,
      `SELECT DISTINCT size_type FROM products WHERE status = 'published' ORDER BY size_type`,
    ),
  ]);

  return {
    categories: categories.map((r) => ({ slug: r.slug, name: r.name, count: Number(r.n) })),
    colors: colors.map((r) => ({ name: r.name, slug: slugify(r.name), hex: r.hex ?? "#000000" })),
    sizes: sizes.map((r) => r.size),
    sizeTypes: sizeTypes.map((r) => r.size_type),
    priceRange: { min: price?.min_price ?? 0, max: price?.max_price ?? 0 },
  };
}

type ProductDetailRow = {
  id: number;
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  price_cents: number;
  old_price_cents: number | null;
  status: string;
  is_new: number;
  is_featured: number;
  customizable: number;
  print_addon_cents: number;
  size_type: string;
  price_from_cents: number | null;
  price_to_cents: number | null;
  features_json: string;
  seo_title: string | null;
  seo_description: string | null;
  rating_avg: number;
  review_count: number;
  category_slug: string | null;
  category_name: string | null;
  size_chart_id: string | null;
};

/** GET /products/:slug — full product detail. */
app.get("/:slug", async (c) => {
  const version = await getContentVersion(c.env);
  if (setContentCache(c, version)) return c.body(null, 304);
  const env = c.env;
  const slug = c.req.param("slug");

  const product = await first<ProductDetailRow>(
    env.DB,
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.slug = ? AND p.status = 'published'`,
    [slug],
  );
  if (!product) throw ApiError.notFound("Product not found");

  const [options, images, variants, relations, distribution, sizeChartRow, settings] = await Promise.all([
    all<{
      id: number;
      name: string;
      type: string;
      position: number;
      value_id: number | null;
      value: string | null;
      swatch_hex: string | null;
      swatch_image_url: string | null;
      value_position: number | null;
    }>(
      env.DB,
      `SELECT po.id, po.name, po.type, po.position,
              pov.id AS value_id, pov.value, pov.swatch_hex, pov.swatch_image_url,
              pov.position AS value_position
         FROM product_options po
         LEFT JOIN product_option_values pov ON pov.option_id = po.id
        WHERE po.product_id = ?
        ORDER BY po.position, po.id, pov.position, pov.id`,
      [product.id],
    ),
    all<{
      color_name: string | null;
      option_value_id: number | null;
      is_primary: number;
      sort: number;
      alt: string | null;
      key: string;
      alt_m: string | null;
      width: number | null;
      height: number | null;
    }>(
      env.DB,
      `SELECT pi.color_name, pi.option_value_id, pi.is_primary, pi.sort, pi.alt,
              m.key, m.alt AS alt_m, m.width, m.height
         FROM product_images pi JOIN media m ON m.id = pi.media_id
        WHERE pi.product_id = ? ORDER BY pi.sort, pi.id`,
      [product.id],
    ),
    all<{
      id: number;
      color_name: string;
      color_hex: string;
      size: string;
      sku: string | null;
      stock: number;
      option_value_ids: string | null;
      price_cents: number | null;
      compare_at_price_cents: number | null;
      track_stock: number;
      is_active: number;
    }>(
      env.DB,
      `SELECT id, color_name, color_hex, size, sku, stock,
              option_value_ids, price_cents, compare_at_price_cents,
              track_stock, is_active
         FROM product_variants
        WHERE product_id = ? ORDER BY color_name, size`,
      [product.id],
    ),
    all<{ related_id: number; type: string }>(
      env.DB,
      `SELECT related_id, type FROM product_relations WHERE product_id = ? ORDER BY type, sort`,
      [product.id],
    ),
    all<{ rating: number; n: number }>(
      env.DB,
      `SELECT rating, COUNT(*) AS n FROM reviews
        WHERE product_id = ? AND status = 'approved' GROUP BY rating`,
      [product.id],
    ),
    product.size_chart_id
      ? first<{ id: string; title: string; unit: string; sizes: string; measurements: string }>(
          env.DB,
          "SELECT id, title, unit, sizes, measurements FROM size_charts WHERE id = ?",
          [product.size_chart_id],
        )
      : Promise.resolve(null),
    getSettings(env, ["currency", "size_presets", "size_meta", "store"]),
  ]);
  const currency = currencyConfig(env, settings);
  const sizeType = (product.size_type === "print" || product.size_type === "one_size"
    ? product.size_type
    : "apparel") as SizeType;

  // Group options + values
  const optionMap = new Map<number, { id: number; name: string; type: "color" | "size" | "other"; position: number; values: Array<{ id: number; value: string; swatchHex: string | null; swatchImageUrl: string | null; position: number }> }>();
  for (const row of options) {
    let opt = optionMap.get(row.id);
    if (!opt) {
      opt = {
        id: row.id,
        name: row.name,
        type: (row.type === "color" || row.type === "size" ? row.type : "other") as "color" | "size" | "other",
        position: row.position,
        values: [],
      };
      optionMap.set(row.id, opt);
    }
    if (row.value_id != null && row.value != null) {
      opt.values.push({
        id: row.value_id,
        value: row.value,
        swatchHex: row.swatch_hex,
        swatchImageUrl: row.swatch_image_url,
        position: row.value_position ?? opt.values.length,
      });
    }
  }
  const optionsArray = Array.from(optionMap.values()).sort((a, b) => a.position - b.position);

  const relatedIds = relations.map((r) => r.related_id);
  const relatedCards = relatedIds.length
    ? await rowsToCards(
        env,
        await listCardRows(env, {
          where: [`p.status = 'published'`, `p.id IN (${relatedIds.map(() => "?").join(",")})`],
          params: relatedIds,
          orderBy: "p.is_featured DESC, p.id",
        }),
      )
    : [];
  const byId = new Map(relatedCards.map((cardItem) => [cardItem.id, cardItem]));

  const dist: Record<string, number> = { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 };
  for (const row of distribution) dist[String(row.rating)] = Number(row.n);

  const features = safeJson<Array<Record<string, unknown>>>(product.features_json, []);

  // Effective prices are server-authoritative: a variant price wins, otherwise
  // the product's base price applies.
  const effectiveVariants = variants.map((v) => ({
    id: v.id,
    color_name: v.color_name === "Default" ? "" : v.color_name,
    color_hex: v.color_hex,
    size: v.size,
    sku: v.sku,
    stock: v.stock,
    optionValueIds: v.option_value_ids ? safeJson<number[]>(v.option_value_ids, []) : [],
    priceCents: v.price_cents ?? product.price_cents,
    oldPriceCents:
      v.compare_at_price_cents ?? (v.price_cents == null ? product.old_price_cents : null),
    hasOwnPrice: v.price_cents != null,
    trackStock: !!v.track_stock,
    isActive: !!v.is_active,
  }));

  const availableVariants = effectiveVariants.filter((v) => v.isActive);
  const priced = availableVariants.filter(
    (v) => v.priceCents > 0 && (sizeType !== "print" || v.hasOwnPrice),
  );
  const priceFrom =
    product.price_from_cents ??
    (priced.length ? Math.min(...priced.map((v) => v.priceCents)) : product.price_cents);
  const priceTo =
    product.price_to_cents ??
    (priced.length ? Math.max(...priced.map((v) => v.priceCents)) : product.price_cents);

  const colorOption = optionsArray.find((o) => o.type === "color");
  const colors = colorOption
    ? colorOption.values
        .filter((v) => v.value !== "Default")
        .map((v) => ({
          id: v.id,
          name: v.value,
          slug: slugify(v.value),
          hex: v.swatchHex ?? "#000000",
          sort: v.position,
        }))
    : dedupe(
        effectiveVariants
          .filter((v) => v.color_name)
          .map((v) => ({ name: v.color_name, hex: v.color_hex })),
        (v) => v.name,
      ).map((v, index) => ({
        id: null,
        name: v.name,
        slug: slugify(v.name),
        hex: v.hex,
        sort: index,
      }));

  const sizes = sizesFor(
    settings,
    sizeType,
    dedupe(effectiveVariants.map((v) => v.size), (s) => s),
  );

  const purchasable =
    priced.length > 0 &&
    priced.some((v) => !v.trackStock || v.stock > 0) &&
    (sizeType !== "print" || priced.length === availableVariants.length);

  return ok(c, {
    id: product.id,
    slug: product.slug,
    name: product.name,
    shortDescription: product.short_description,
    description: product.description,
    price_cents: product.price_cents,
    old_price_cents: product.old_price_cents,
    priceCents: priceFrom,
    priceFromCents: priceFrom,
    priceToCents: priceTo,
    hasPriceRange: priceTo > priceFrom,
    sizeType,
    currency: currency.code,
    category:
      product.category_slug && product.category_name
        ? { slug: product.category_slug, name: product.category_name }
        : null,
    isNew: !!product.is_new,
    featured: !!product.is_featured,
    customizable: !!product.customizable,
    printAddonCents: product.print_addon_cents,
    features,
    sizeChart: sizeChartRow
      ? {
          id: sizeChartRow.id,
          title: sizeChartRow.title,
          unit: sizeChartRow.unit,
          sizes: safeJson<string[]>(sizeChartRow.sizes, []),
          measurements: safeJson<Record<string, (string | number)[]>>(
            sizeChartRow.measurements,
            {},
          ),
        }
      : null,
    seo: { title: product.seo_title, description: product.seo_description },
    rating: { average: product.rating_avg, count: product.review_count, distribution: dist },
    options: optionsArray,
    images: images.map((img) => ({
      ...(imageShape(img) as object),
      colorId: img.option_value_id,
      colorName: img.color_name,
      optionValueId: img.option_value_id,
      isPrimary: !!img.is_primary,
      sort: img.sort,
      alt: img.alt ?? img.alt_m,
    })),
    variants: effectiveVariants.map((v) => ({
      id: v.id,
      color_name: v.color_name,
      colorName: v.color_name,
      colorId: colorOption?.values.find((value) => value.value === v.color_name)?.id ?? null,
      color_hex: v.color_hex,
      size: v.size,
      sku: v.sku,
      stock: v.stock,
      optionValueIds: v.optionValueIds,
      priceCents: v.priceCents,
      oldPriceCents: v.oldPriceCents,
      compareAtPriceCents: v.oldPriceCents,
      // Print sizes must carry their own price; the storefront disables a size
      // without one instead of showing the product's base price.
      hasOwnPrice: v.hasOwnPrice,
      trackStock: v.trackStock,
      isActive: v.isActive,
    })),
    colors,
    sizes,
    purchasable,
    pairWith: relations
      .filter((r) => r.type === "pair")
      .map((r) => byId.get(r.related_id))
      .filter(Boolean),
    accessories: relations
      .filter((r) => r.type === "accessory")
      .map((r) => byId.get(r.related_id))
      .filter(Boolean),
  });
});

/** GET /products/:slug/reviews — approved reviews only. */
app.get("/:slug/reviews", async (c) => {
  const version = await getContentVersion(c.env);
  if (setContentCache(c, version)) return c.body(null, 304);
  const env = c.env;
  const slug = c.req.param("slug");
  const product = await first<{ id: number }>(
    env.DB,
    "SELECT id FROM products WHERE slug = ? AND status = 'published'",
    [slug],
  );
  if (!product) throw ApiError.notFound("Product not found");

  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query("limit") ?? "10", 10) || 10));
  const sort = c.req.query("sort");
  const orderBy =
    sort === "highest"
      ? "rating DESC, created_at DESC"
      : sort === "lowest"
        ? "rating ASC, created_at DESC"
        : "created_at DESC";

  const total = await count(
    env.DB,
    "SELECT COUNT(*) AS n FROM reviews WHERE product_id = ? AND status = 'approved'",
    [product.id],
  );
  const rows = await all<{
    id: number;
    author_name: string;
    rating: number;
    title: string | null;
    body: string;
    verified_purchase: number;
    created_at: string;
  }>(
    env.DB,
    `SELECT id, author_name, rating, title, body, verified_purchase, created_at
       FROM reviews WHERE product_id = ? AND status = 'approved'
      ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [product.id, limit, (page - 1) * limit],
  );

  return ok(
    c,
    rows.map((r) => ({
      id: r.id,
      author: r.author_name,
      rating: r.rating,
      title: r.title,
      body: r.body,
      verified: !!r.verified_purchase,
      date: r.created_at,
    })),
    { total, page, pages: Math.max(1, Math.ceil(total / limit)) },
  );
});

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function dedupe<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export default app;
