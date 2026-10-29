/** Reusable catalog queries shared by the public API and the admin CMS. */
import type { Env } from "../env";
import { all, first } from "./db";
import { imageShape, type ImageRef } from "./media";
import { slugify } from "./slug";

export type CardColor = {
  id: number | null;
  name: string;
  slug: string;
  hex: string;
  image: ImageRef | null;
};

export type CardRow = {
  id: number;
  slug: string;
  name: string;
  price_cents: number;
  old_price_cents: number | null;
  price_from_cents: number;
  price_to_cents: number;
  size_type: string;
  is_new: number;
  is_featured: number;
  status: string;
  rating_avg: number;
  review_count: number;
  category_id: number | null;
  category_slug: string | null;
  category_name: string | null;
};

export type ProductCard = {
  id: number;
  slug: string;
  name: string;
  priceCents: number;
  priceToCents: number;
  hasPriceRange: boolean;
  oldPriceCents: number | null;
  sizeType: string;
  image: ImageRef | null;
  colors: CardColor[];
  isNew: boolean;
  featured: boolean;
  rating: number;
  reviewCount: number;
  category: { slug: string; name: string } | null;
  soldOut: boolean;
};

const CARD_SELECT = `
  SELECT p.id, p.slug, p.name, p.price_cents, p.old_price_cents,
         p.size_type,
         COALESCE(p.price_from_cents, p.price_cents) AS price_from_cents,
         COALESCE(p.price_to_cents, p.price_cents) AS price_to_cents,
         p.is_new, p.is_featured, p.status, p.rating_avg, p.review_count, p.category_id,
         c.slug AS category_slug, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id`;

/** Published-only card rows with a fixed, caller-controlled WHERE/ORDER. */
export function listCardRows(
  env: Env,
  opts: {
    where?: string[];
    params?: unknown[];
    orderBy?: string;
    limit?: number;
    offset?: number;
  },
): Promise<CardRow[]> {
  const clauses = opts.where?.length ? `WHERE ${opts.where.join(" AND ")}` : "";
  const order = opts.orderBy ? `ORDER BY ${opts.orderBy}` : "";
  const limit = opts.limit != null ? `LIMIT ${Number(opts.limit)}` : "";
  const offset = opts.offset != null ? `OFFSET ${Number(opts.offset)}` : "";
  return all<CardRow>(env.DB, `${CARD_SELECT} ${clauses} ${order} ${limit} ${offset}`, opts.params ?? []);
}

export function getCardRow(env: Env, where: string, params: unknown[]): Promise<CardRow | null> {
  return first<CardRow>(env.DB, `${CARD_SELECT} WHERE ${where}`, params);
}

type ImageRow = {
  id: number;
  product_id: number;
  color_name: string | null;
  option_value_id: number | null;
  is_primary: number;
  sort: number;
  key: string;
  alt: string | null;
  width: number | null;
  height: number | null;
};

/** All images for a page of products, ordered so the first row is the cover. */
async function loadImages(env: Env, productIds: number[]): Promise<Map<number, ImageRow[]>> {
  const map = new Map<number, ImageRow[]>();
  if (!productIds.length) return map;
  const placeholders = productIds.map(() => "?").join(",");
  const rows = await all<ImageRow>(
    env.DB,
    `SELECT pi.id, pi.product_id, pi.color_name, pi.option_value_id, pi.is_primary, pi.sort,
            m.key, m.alt, m.width, m.height
       FROM product_images pi
       JOIN media m ON m.id = pi.media_id
      WHERE pi.product_id IN (${placeholders})
      ORDER BY pi.product_id,
               CASE WHEN pi.option_value_id IS NULL AND pi.color_name IS NULL THEN 1 ELSE 0 END,
               pi.is_primary DESC, pi.sort, pi.id`,
    productIds,
  );
  for (const row of rows) {
    const list = map.get(row.product_id) ?? [];
    list.push(row);
    map.set(row.product_id, list);
  }
  return map;
}

type ColorRow = {
  product_id: number;
  id: number | null;
  name: string;
  hex: string | null;
  sort: number;
  option_value_id: number | null;
};

/**
 * Colours per product. The option model is authoritative; products created
 * before 0010 (or by the seed) fall back to the distinct color_name values on
 * their variants.
 */
async function loadColors(env: Env, productIds: number[]): Promise<Map<number, ColorRow[]>> {
  const map = new Map<number, ColorRow[]>();
  if (!productIds.length) return map;
  const placeholders = productIds.map(() => "?").join(",");
  const rows = await all<{
    product_id: number;
    id: number | null;
    name: string;
    swatch_hex: string | null;
    position: number | null;
  }>(
    env.DB,
    `SELECT po.product_id, pov.id, pov.value AS name, pov.swatch_hex, pov.position
       FROM product_options po
       JOIN product_option_values pov ON pov.option_id = po.id
      WHERE po.type = 'color' AND po.product_id IN (${placeholders})
      ORDER BY po.product_id, po.position, pov.position, pov.id`,
    productIds,
  );
  for (const row of rows) {
    if (!row.name || row.name === "Default") continue;
    const list = map.get(row.product_id) ?? [];
    list.push({
      product_id: row.product_id,
      id: row.id,
      name: row.name,
      hex: row.swatch_hex,
      sort: row.position ?? list.length,
      option_value_id: row.id,
    });
    map.set(row.product_id, list);
  }

  // Legacy fallback: no Color option rows, but variants still carry a colour.
  const missing = productIds.filter((id) => !map.has(id));
  if (missing.length) {
    const variantRows = await all<{ product_id: number; color_name: string; color_hex: string }>(
      env.DB,
      `SELECT product_id, color_name, MIN(color_hex) AS color_hex
         FROM product_variants
        WHERE product_id IN (${missing.map(() => "?").join(",")})
        GROUP BY product_id, color_name
        ORDER BY product_id, MIN(id)`,
      missing,
    );
    for (const row of variantRows) {
      if (!row.color_name || row.color_name === "Default") continue;
      const list = map.get(row.product_id) ?? [];
      list.push({
        product_id: row.product_id,
        id: null,
        name: row.color_name,
        hex: row.color_hex,
        sort: list.length,
        option_value_id: null,
      });
      map.set(row.product_id, list);
    }
  }

  return map;
}

function imageRef(row: ImageRow) {
  return imageShape({
    key: row.key,
    alt: row.alt,
    width: row.width,
    height: row.height,
  });
}

/** First image that belongs to a colour; falls back to a shared image. */
function imageForColor(images: ImageRow[], color: ColorRow): ImageRef | null {
  const own =
    images.find(
      (img) =>
        (color.option_value_id != null && img.option_value_id === color.option_value_id) ||
        (img.color_name != null && img.color_name.toLowerCase() === color.name.toLowerCase()),
    ) ?? null;
  if (own) return imageRef(own);
  const shared = images.find((img) => img.option_value_id == null && img.color_name == null) ?? null;
  return shared ? imageRef(shared) : null;
}

/** Sold-out when every active variant is out of stock (tracked variants only). */
export async function loadSoldOut(env: Env, productIds: number[]): Promise<Map<number, boolean>> {
  const map = new Map<number, boolean>();
  if (!productIds.length) return map;
  const placeholders = productIds.map(() => "?").join(",");
  const rows = await all<{ product_id: number; has_stock: number }>(
    env.DB,
    `SELECT v.product_id, MAX(CASE WHEN v.is_active = 1 AND (v.track_stock = 0 OR v.stock > 0) THEN 1 ELSE 0 END) AS has_stock
       FROM product_variants v
      WHERE v.product_id IN (${placeholders})
      GROUP BY v.product_id`,
    productIds,
  );
  for (const row of rows) map.set(row.product_id, row.has_stock === 0);
  return map;
}

export function toCard(
  row: CardRow,
  colors: ColorRow[],
  images: ImageRow[],
  soldOut: boolean,
): ProductCard {
  const colorCards: CardColor[] = colors.map((color) => ({
    id: color.id,
    name: color.name,
    slug: slugify(color.name),
    hex: color.hex ?? "#000000",
    image: imageForColor(images, color),
  }));

  // Cover: the first colour's first image, else shared, else any image.
  const cover =
    colorCards.find((color) => color.image)?.image ??
    (() => {
      const shared = images.find((img) => img.option_value_id == null && img.color_name == null);
      return shared ? imageRef(shared) : images[0] ? imageRef(images[0]) : null;
    })();

  const priceFrom = Number(row.price_from_cents ?? row.price_cents ?? 0);
  const priceTo = Number(row.price_to_cents ?? row.price_cents ?? 0);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    priceCents: priceFrom,
    priceToCents: priceTo,
    hasPriceRange: priceTo > priceFrom,
    oldPriceCents: row.old_price_cents,
    sizeType: row.size_type ?? "apparel",
    image: cover,
    colors: colorCards,
    isNew: !!row.is_new,
    featured: !!row.is_featured,
    rating: row.rating_avg,
    reviewCount: row.review_count,
    category:
      row.category_slug && row.category_name
        ? { slug: row.category_slug, name: row.category_name }
        : null,
    soldOut,
  };
}

/** Convenience: rows → cards with colours, images and stock resolved. */
export async function rowsToCards(env: Env, rows: CardRow[]): Promise<ProductCard[]> {
  const productIds = rows.map((r) => r.id);
  const [colors, images, soldOutMap] = await Promise.all([
    loadColors(env, productIds),
    loadImages(env, productIds),
    loadSoldOut(env, productIds),
  ]);
  return rows.map((r) =>
    toCard(r, colors.get(r.id) ?? [], images.get(r.id) ?? [], soldOutMap.get(r.id) ?? false),
  );
}
