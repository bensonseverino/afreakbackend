import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, batch, count, first, run, type BatchStatement } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { slugify, uniqueSlug } from "../../lib/slug";
import { imageShape, mediaUrl } from "../../lib/media";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const STATUSES = ["draft", "published", "archived"] as const;

type AdminProductRow = {
  id: number;
  slug: string;
  name: string;
  price_cents: number;
  old_price_cents: number | null;
  status: string;
  updated_at: string;
  created_at: string;
  category_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  image_key: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
  stock_total: number;
  variant_count: number;
};

const LIST_SELECT = `
  SELECT p.id, p.slug, p.name, p.price_cents, p.old_price_cents, p.status, p.updated_at, p.created_at,
         p.category_id, c.name AS category_name, c.slug AS category_slug,
         m.key AS image_key, m.alt AS image_alt, m.width AS image_width, m.height AS image_height,
         (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = p.id) AS stock_total,
         (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id) AS variant_count
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN product_images pi
      ON pi.id = (SELECT id FROM product_images WHERE product_id = p.id ORDER BY sort, id LIMIT 1)
    LEFT JOIN media m ON m.id = pi.media_id`;

/** GET /admin/products — all statuses with search, filters, paging. */
app.get("/", async (c) => {
  setNoStore(c);
  const q = c.req.query("q")?.trim();
  const status = c.req.query("status");
  const category = c.req.query("category");
  const stock = c.req.query("stock");
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(60, Math.max(1, Number.parseInt(c.req.query("limit") ?? "20", 10) || 20));

  const where: string[] = [];
  const params: unknown[] = [];
  if (status && (STATUSES as readonly string[]).includes(status)) {
    where.push("p.status = ?");
    params.push(status);
  }
  if (category) {
    where.push("c.slug = ?");
    params.push(category);
  }
  if (q) {
    where.push("(p.name LIKE ? OR p.slug LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (stock === "out") {
    where.push(
      "(SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = p.id) = 0",
    );
  } else if (stock === "low") {
    where.push(
      "(SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = p.id) BETWEEN 1 AND 3",
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await count(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id ${whereSql}`,
    params,
  );
  const rows = await all<AdminProductRow>(
    c.env.DB,
    `${LIST_SELECT} ${whereSql} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return ok(
    c,
    rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      price_cents: r.price_cents,
      old_price_cents: r.old_price_cents,
      status: r.status,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
      category: r.category_id ? { id: r.category_id, name: r.category_name, slug: r.category_slug } : null,
      image: imageShape(
        r.image_key
          ? { key: r.image_key, alt: r.image_alt, width: r.image_width, height: r.image_height }
          : null,
      ),
      stockTotal: Number(r.stock_total ?? 0),
      variantCount: Number(r.variant_count ?? 0),
    })),
    { total, page, pages: Math.max(1, Math.ceil(total / limit)) },
  );
});

// --- Save schemas ----------------------------------------------------------

const featureSchema = z.object({
  icon: z.string().trim().max(40).default("shield"),
  title: z.string().trim().max(80).default(""),
  sub: z.string().trim().max(120).default(""),
});

const imageSchema = z.object({
  mediaId: z.string().min(1).max(80),
  colorName: z.string().trim().max(60).nullable().optional(),
  sort: z.coerce.number().int().optional(),
});

const variantSchema = z.object({
  colorName: z.string().trim().min(1).max(60),
  colorHex: z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/, "Invalid hex color"),
  size: z.string().trim().min(1).max(30),
  sku: z.string().trim().max(80).optional(),
  stock: z.coerce.number().int().min(0).max(1_000_000),
});

const relationSchema = z.object({
  relatedId: z.coerce.number().int().positive(),
  type: z.enum(["pair", "accessory"]),
  sort: z.coerce.number().int().optional(),
});

const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().max(80).optional(),
  shortDescription: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(20000).nullable().optional(),
  price_cents: z.coerce.number().int().min(0),
  old_price_cents: z.coerce.number().int().min(0).nullable().optional(),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  status: z.enum(STATUSES).default("draft"),
  isNew: z.boolean().optional(),
  featured: z.boolean().optional(),
  customizable: z.boolean().optional(),
  printAddonCents: z.coerce.number().int().min(0).optional(),
  sizeChartId: z.string().trim().max(80).nullable().optional(),
  features: z.array(featureSchema).max(6).optional(),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(400).nullable().optional(),
  images: z.array(imageSchema).max(30).optional(),
  variants: z.array(variantSchema).max(500).optional(),
  relations: z.array(relationSchema).max(60).optional(),
});

type ProductInput = z.infer<typeof productSchema>;

function validateForPublish(input: ProductInput) {
  if (input.status !== "published") return;
  const fields: Record<string, string> = {};
  if ((input.images?.length ?? 0) < 1) fields.images = "Add at least one image to publish";
  if ((input.variants?.length ?? 0) < 1) fields.variants = "Add at least one variant to publish";
  if (!(input.price_cents > 0)) fields.price_cents = "Price must be greater than zero";
  if (Object.keys(fields).length) throw ApiError.validation(fields);
}

function autoSku(slug: string, colorName: string, size: string): string {
  return `AF-${slug}-${slugify(colorName)}-${slugify(size)}`.slice(0, 80);
}

function childStatements(
  statements: BatchStatement[],
  productRef: { sql: string; params: unknown[] },
  input: ProductInput,
  slug: string,
) {
  const { sql: pidSql, params: pidParams } = productRef;

  statements.push({ sql: `DELETE FROM product_images WHERE product_id = ${pidSql}`, params: pidParams });
  (input.images ?? []).forEach((img, index) => {
    statements.push({
      sql: `INSERT INTO product_images (product_id, media_id, color_name, sort)
            VALUES (${pidSql}, ?, ?, ?)`,
      params: [...pidParams, img.mediaId, img.colorName ?? null, img.sort ?? index],
    });
  });

  statements.push({ sql: `DELETE FROM product_variants WHERE product_id = ${pidSql}`, params: pidParams });
  for (const v of input.variants ?? []) {
    statements.push({
      sql: `INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
            VALUES (${pidSql}, ?, ?, ?, ?, ?)`,
      params: [
        ...pidParams,
        cleanText(v.colorName, 60),
        v.colorHex,
        cleanText(v.size, 30),
        v.sku ? cleanText(v.sku, 80) : autoSku(slug, v.colorName, v.size),
        v.stock,
      ],
    });
  }

  statements.push({ sql: `DELETE FROM product_relations WHERE product_id = ${pidSql}`, params: pidParams });
  (input.relations ?? [])
    .filter((r) => r.relatedId)
    .forEach((r, index) => {
      statements.push({
        sql: `INSERT OR IGNORE INTO product_relations (product_id, related_id, type, sort)
              VALUES (${pidSql}, ?, ?, ?)`,
        params: [...pidParams, r.relatedId, r.type, r.sort ?? index],
      });
    });
}

async function resolveSlug(env: AppEnv["Bindings"], desired: string, id?: number): Promise<string> {
  const base = slugify(desired) || "product";
  const clash = await first<{ id: number }>(
    env.DB,
    `SELECT id FROM products WHERE slug = ?${id ? " AND id <> ?" : ""}`,
    id ? [base, id] : [base],
  );
  return clash ? uniqueSlug(base) : base;
}

/** POST /admin/products — create. */
app.post("/", async (c) => {
  setNoStore(c);
  const input = await parseJson(c, productSchema);
  validateForPublish(input);

  const slug = await resolveSlug(c.env, input.slug || input.name);
  const statements: BatchStatement[] = [
    {
      sql: `INSERT INTO products
              (slug, name, short_description, description, price_cents, old_price_cents, category_id,
               status, is_new, is_featured, customizable, print_addon_cents, size_chart_id, features_json,
               seo_title, seo_description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        slug,
        cleanText(input.name, 160),
        input.shortDescription ? cleanText(input.shortDescription, 300) : null,
        input.description ?? null,
        input.price_cents,
        input.old_price_cents ?? null,
        input.categoryId ?? null,
        input.status,
        input.isNew ? 1 : 0,
        input.featured ? 1 : 0,
        input.customizable ? 1 : 0,
        input.printAddonCents ?? 0,
        input.sizeChartId ?? null,
        JSON.stringify(input.features ?? []),
        input.seoTitle ? cleanText(input.seoTitle, 200) : null,
        input.seoDescription ? cleanText(input.seoDescription, 400) : null,
      ],
    },
  ];

  const ref = { sql: "(SELECT id FROM products WHERE slug = ?)", params: [slug] };
  childStatements(statements, ref, input, slug);
  await batch(c.env.DB, statements);

  const created = await first<{ id: number }>(c.env.DB, "SELECT id FROM products WHERE slug = ?", [slug]);
  return ok(c, { id: created?.id ?? null, slug });
});

/** PUT /admin/products/:id — full save (product + images + variants + relations). */
app.put("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const existing = await first<{ id: number }>(c.env.DB, "SELECT id FROM products WHERE id = ?", [id]);
  if (!existing) throw ApiError.notFound("Product not found");

  const input = await parseJson(c, productSchema);
  validateForPublish(input);
  const slug = await resolveSlug(c.env, input.slug || input.name, id);

  const statements: BatchStatement[] = [
    {
      sql: `UPDATE products SET
              slug = ?, name = ?, short_description = ?, description = ?, price_cents = ?,
              old_price_cents = ?, category_id = ?, status = ?, is_new = ?, is_featured = ?,
              customizable = ?, print_addon_cents = ?, size_chart_id = ?, features_json = ?, seo_title = ?,
              seo_description = ?, updated_at = datetime('now')
            WHERE id = ?`,
      params: [
        slug,
        cleanText(input.name, 160),
        input.shortDescription ? cleanText(input.shortDescription, 300) : null,
        input.description ?? null,
        input.price_cents,
        input.old_price_cents ?? null,
        input.categoryId ?? null,
        input.status,
        input.isNew ? 1 : 0,
        input.featured ? 1 : 0,
        input.customizable ? 1 : 0,
        input.printAddonCents ?? 0,
        input.sizeChartId ?? null,
        JSON.stringify(input.features ?? []),
        input.seoTitle ? cleanText(input.seoTitle, 200) : null,
        input.seoDescription ? cleanText(input.seoDescription, 400) : null,
        id,
      ],
    },
  ];

  childStatements(statements, { sql: "?", params: [id] }, input, slug);
  await batch(c.env.DB, statements);

  return ok(c, { id, slug });
});

/** GET /admin/products/:id — full editor payload. */
app.get("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const product = await first<Record<string, unknown>>(
    c.env.DB,
    "SELECT * FROM products WHERE id = ?",
    [id],
  );
  if (!product) throw ApiError.notFound("Product not found");

  const [images, variants, relations] = await Promise.all([
    all<{
      id: number;
      media_id: string;
      color_name: string | null;
      sort: number;
      key: string;
      alt: string | null;
      width: number | null;
      height: number | null;
      mime: string;
    }>(
      c.env.DB,
      `SELECT pi.id, pi.media_id, pi.color_name, pi.sort, m.key, m.alt, m.width, m.height, m.mime
         FROM product_images pi JOIN media m ON m.id = pi.media_id
        WHERE pi.product_id = ? ORDER BY pi.sort, pi.id`,
      [id],
    ),
    all<{ id: number; color_name: string; color_hex: string; size: string; sku: string | null; stock: number }>(
      c.env.DB,
      `SELECT id, color_name, color_hex, size, sku, stock FROM product_variants
        WHERE product_id = ? ORDER BY color_name, size`,
      [id],
    ),
    all<{ related_id: number; type: string; sort: number; name: string; slug: string; key: string | null }>(
      c.env.DB,
      `SELECT r.related_id, r.type, r.sort, p.name, p.slug, m.key
         FROM product_relations r
         JOIN products p ON p.id = r.related_id
         LEFT JOIN product_images pi
           ON pi.id = (SELECT id FROM product_images WHERE product_id = p.id ORDER BY sort, id LIMIT 1)
         LEFT JOIN media m ON m.id = pi.media_id
        WHERE r.product_id = ? ORDER BY r.type, r.sort`,
      [id],
    ),
  ]);

  const relShape = (type: string) =>
    relations
      .filter((r) => r.type === type)
      .map((r) => ({
        relatedId: r.related_id,
        name: r.name,
        slug: r.slug,
        image: r.key ? { url: mediaUrl(r.key), alt: null } : null,
      }));

  return ok(c, {
    id: product.id,
    slug: product.slug,
    name: product.name,
    shortDescription: product.short_description,
    description: product.description,
    price_cents: product.price_cents,
    old_price_cents: product.old_price_cents,
    categoryId: product.category_id,
    status: product.status,
    isNew: !!product.is_new,
    featured: !!product.is_featured,
    customizable: !!product.customizable,
    printAddonCents: product.print_addon_cents,
    sizeChartId: product.size_chart_id ?? null,
    features: safeParse<unknown[]>(product.features_json as string, []),
    seoTitle: product.seo_title,
    seoDescription: product.seo_description,
    images: images.map((i) => ({
      id: i.id,
      mediaId: i.media_id,
      colorName: i.color_name,
      sort: i.sort,
      url: mediaUrl(i.key),
      alt: i.alt,
      width: i.width,
      height: i.height,
      mime: i.mime,
    })),
    variants: variants.map((v) => ({
      id: v.id,
      colorName: v.color_name,
      colorHex: v.color_hex,
      size: v.size,
      sku: v.sku,
      stock: v.stock,
    })),
    pairWith: relShape("pair"),
    accessories: relShape("accessory"),
  });
});

/** PATCH /admin/products/:id/status */
app.patch("/:id/status", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const body = await parseJson(c, z.object({ status: z.enum(STATUSES) }));
  await run(c.env.DB, "UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?", [
    body.status,
    id,
  ]);
  return ok(c, { id, status: body.status });
});

/** POST /admin/products/bulk — publish/draft/archive many. */
app.post("/bulk", async (c) => {
  setNoStore(c);
  const body = await parseJson(
    c,
    z.object({
      ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
      action: z.enum(["publish", "draft", "archive"]),
    }),
  );
  const status = body.action === "publish" ? "published" : body.action === "draft" ? "draft" : "archived";
  await batch(
    c.env.DB,
    body.ids.map((id) => ({
      sql: "UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?",
      params: [status, id],
    })),
  );
  return ok(c, { updated: body.ids.length, status });
});

/** POST /admin/products/:id/duplicate */
app.post("/:id/duplicate", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const src = await first<Record<string, unknown>>(c.env.DB, "SELECT * FROM products WHERE id = ?", [id]);
  if (!src) throw ApiError.notFound("Product not found");

  const slug = uniqueSlug(`${src.slug as string}-copy`);
  const insert = await run(
    c.env.DB,
    `INSERT INTO products
       (slug, name, short_description, description, price_cents, old_price_cents, category_id,
        status, is_new, is_featured, customizable, print_addon_cents, features_json, seo_title, seo_description)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, 0, ?, ?, ?, ?, ?)`,
    [
      slug,
      `${src.name as string} copy`,
      src.short_description,
      src.description,
      src.price_cents,
      src.old_price_cents,
      src.category_id,
      src.is_new,
      src.customizable,
      src.print_addon_cents,
      src.features_json,
      src.seo_title,
      src.seo_description,
    ],
  );
  const newId = Number(insert.meta.last_row_id);

  await batch(c.env.DB, [
    {
      sql: `INSERT INTO product_images (product_id, media_id, color_name, sort)
            SELECT ?, media_id, color_name, sort FROM product_images WHERE product_id = ? ORDER BY sort, id`,
      params: [newId, id],
    },
    {
      sql: `INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
            SELECT ?, color_name, color_hex, size, NULL, stock FROM product_variants WHERE product_id = ?`,
      params: [newId, id],
    },
  ]);

  return ok(c, { id: newId, slug });
});

/** DELETE /admin/products/:id — soft-archive if it has orders, otherwise hard delete. */
app.delete("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const orders = await count(c.env.DB, "SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?", [id]);
  if (orders > 0) {
    await run(c.env.DB, "UPDATE products SET status = 'archived', updated_at = datetime('now') WHERE id = ?", [id]);
    return ok(c, { archived: true });
  }
  await run(c.env.DB, "DELETE FROM products WHERE id = ?", [id]);
  return ok(c, { deleted: true });
});

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default app;
