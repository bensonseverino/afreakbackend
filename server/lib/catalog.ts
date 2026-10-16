/** Reusable catalog queries shared by the public API and the admin CMS. */
import type { Env } from "../env";
import { all, first } from "./db";
import { imageShape, type ImageRef } from "./media";

export type Color = { name: string; hex: string };

export type CardRow = {
  id: number;
  slug: string;
  name: string;
  price_cents: number;
  old_price_cents: number | null;
  is_new: number;
  is_featured: number;
  status: string;
  rating_avg: number;
  review_count: number;
  category_id: number | null;
  category_slug: string | null;
  category_name: string | null;
  image_key: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
};

export type ProductCard = {
  id: number;
  slug: string;
  name: string;
  price_cents: number;
  old_price_cents: number | null;
  image: ImageRef | null;
  colors: Color[];
  isNew: boolean;
  featured: boolean;
  rating: number;
  reviewCount: number;
  category: { slug: string; name: string } | null;
};

const CARD_SELECT = `
  SELECT p.id, p.slug, p.name, p.price_cents, p.old_price_cents, p.is_new, p.is_featured,
         p.status, p.rating_avg, p.review_count, p.category_id,
         c.slug AS category_slug, c.name AS category_name,
         m.key AS image_key, m.alt AS image_alt, m.width AS image_width, m.height AS image_height
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN product_images pi
      ON pi.id = (SELECT id FROM product_images WHERE product_id = p.id ORDER BY sort, id LIMIT 1)
    LEFT JOIN media m ON m.id = pi.media_id`;

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

/** Distinct colors per product, fetched in one query for a page of cards. */
export async function loadColors(env: Env, productIds: number[]): Promise<Map<number, Color[]>> {
  const map = new Map<number, Color[]>();
  if (!productIds.length) return map;
  const placeholders = productIds.map(() => "?").join(",");
  const rows = await all<{ product_id: number; color_name: string; color_hex: string }>(
    env.DB,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    `SELECT product_id, color_name, MIN(color_hex) AS color_hex
       FROM product_variants
      WHERE product_id IN (${placeholders})
      GROUP BY product_id, color_name
      ORDER BY MIN(id)`,
    productIds,
  );
  for (const row of rows) {
    const list = map.get(row.product_id) ?? [];
    if (!list.some((c) => c.name === row.color_name)) {
      list.push({ name: row.color_name, hex: row.color_hex });
    }
    map.set(row.product_id, list);
  }
  return map;
}

export function toCard(row: CardRow, colors: Color[]): ProductCard {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    price_cents: row.price_cents,
    old_price_cents: row.old_price_cents,
    image: imageShape(
      row.image_key
        ? { key: row.image_key, alt: row.image_alt, width: row.image_width, height: row.image_height }
        : null,
    ),
    colors,
    isNew: !!row.is_new,
    featured: !!row.is_featured,
    rating: row.rating_avg,
    reviewCount: row.review_count,
    category:
      row.category_slug && row.category_name
        ? { slug: row.category_slug, name: row.category_name }
        : null,
  };
}

/** Convenience: rows → cards with colors resolved. */
export async function rowsToCards(env: Env, rows: CardRow[]): Promise<ProductCard[]> {
  const colors = await loadColors(env, rows.map((r) => r.id));
  return rows.map((r) => toCard(r, colors.get(r.id) ?? []));
}
