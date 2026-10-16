import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, count, first } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseQuery } from "../../lib/validate";
import { imageShape } from "../../lib/media";
import { listCardRows, rowsToCards } from "../../lib/catalog";
import { setPublicCache } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const listQuery = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(["popular", "newest", "price_asc", "price_desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
  new: z.string().optional(),
  featured: z.string().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  colors: z.string().max(400).optional(),
  sizes: z.string().max(400).optional(),
});

const SORTS: Record<string, string> = {
  popular: "p.rating_avg DESC, p.review_count DESC, p.id DESC",
  newest: "p.created_at DESC, p.id DESC",
  price_asc: "p.price_cents ASC, p.id DESC",
  price_desc: "p.price_cents DESC, p.id DESC",
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
  setPublicCache(c);
  const q = parseQuery(c.req.query(), listQuery);

  const where: string[] = ["p.status = 'published'"];
  const params: unknown[] = [];

  if (q.category && q.category !== "all") {
    where.push("c.slug = ?");
    params.push(q.category);
  }
  if (q.q) {
    where.push("(p.name LIKE ? OR p.short_description LIKE ?)");
    params.push(`%${q.q}%`, `%${q.q}%`);
  }
  if (q.new === "1") where.push("p.is_new = 1");
  if (q.featured === "1") where.push("p.is_featured = 1");
  if (q.minPrice != null) {
    where.push("p.price_cents >= ?");
    params.push(q.minPrice);
  }
  if (q.maxPrice != null) {
    where.push("p.price_cents <= ?");
    params.push(q.maxPrice);
  }

  const colors = csv(q.colors);
  if (colors.length) {
    where.push(
      `p.id IN (SELECT product_id FROM product_variants WHERE color_name IN (${colors.map(() => "?").join(",")}))`,
    );
    params.push(...colors);
  }
  const sizes = csv(q.sizes);
  if (sizes.length) {
    where.push(
      `p.id IN (SELECT product_id FROM product_variants WHERE size IN (${sizes.map(() => "?").join(",")}))`,
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
  const [categories, colors, sizes, price] = await Promise.all([
    all<{ slug: string; name: string; n: number }>(
      env.DB,
      `SELECT c.slug, c.name, COUNT(p.id) AS n
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.status = 'published'
        GROUP BY c.id ORDER BY c.sort, c.name`,
    ),
    all<{ color_name: string; hex: string }>(
      env.DB,
      `SELECT v.color_name, MIN(v.color_hex) AS hex
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.status = 'published'
        GROUP BY v.color_name ORDER BY v.color_name`,
    ),
    all<{ size: string }>(
      env.DB,
      `SELECT DISTINCT v.size FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.status = 'published' ORDER BY v.size`,
    ),
    first<{ min_price: number | null; max_price: number | null }>(
      env.DB,
      `SELECT MIN(price_cents) AS min_price, MAX(price_cents) AS max_price
         FROM products WHERE status = 'published'`,
    ),
  ]);

  return {
    categories: categories.map((r) => ({ slug: r.slug, name: r.name, count: Number(r.n) })),
    colors: colors.map((r) => ({ name: r.color_name, hex: r.hex })),
    sizes: sizes.map((r) => r.size),
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
  features_json: string;
  seo_title: string | null;
  seo_description: string | null;
  rating_avg: number;
  review_count: number;
  category_slug: string | null;
  category_name: string | null;
};

/** GET /products/:slug — full product detail. */
app.get("/:slug", async (c) => {
  setPublicCache(c);
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

  const [images, variants, relations, distribution] = await Promise.all([
    all<{
      color_name: string | null;
      key: string;
      alt: string | null;
      width: number | null;
      height: number | null;
    }>(
      env.DB,
      `SELECT pi.color_name, m.key, m.alt, m.width, m.height
         FROM product_images pi JOIN media m ON m.id = pi.media_id
        WHERE pi.product_id = ? ORDER BY pi.sort, pi.id`,
      [product.id],
    ),
    all<{ id: number; color_name: string; color_hex: string; size: string; sku: string | null; stock: number }>(
      env.DB,
      `SELECT id, color_name, color_hex, size, sku, stock FROM product_variants
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
  ]);

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

  return ok(c, {
    id: product.id,
    slug: product.slug,
    name: product.name,
    shortDescription: product.short_description,
    description: product.description,
    price_cents: product.price_cents,
    old_price_cents: product.old_price_cents,
    category:
      product.category_slug && product.category_name
        ? { slug: product.category_slug, name: product.category_name }
        : null,
    isNew: !!product.is_new,
    featured: !!product.is_featured,
    customizable: !!product.customizable,
    printAddonCents: product.print_addon_cents,
    features,
    seo: { title: product.seo_title, description: product.seo_description },
    rating: { average: product.rating_avg, count: product.review_count, distribution: dist },
    images: images.map((img) => ({
      ...(imageShape(img) as object),
      colorName: img.color_name,
    })),
    variants,
    colors: dedupe(
      variants.map((v) => ({ name: v.color_name, hex: v.color_hex })),
      (v) => v.name,
    ),
    sizes: dedupe(
      variants.map((v) => v.size),
      (s) => s,
    ),
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
  setPublicCache(c);
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
