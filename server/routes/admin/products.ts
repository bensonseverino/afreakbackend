import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, batch, count, first, run, type BatchStatement } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { slugify, uniqueSlug } from "../../lib/slug";
import { imageShape, mediaUrl } from "../../lib/media";
import { setNoStore } from "../../middleware/cache";
import { buildOptions, normalizeImages, type OptionDraft, type VariantDraft, type ImageDraft } from "../../lib/variations";

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
  size_type: string;
  price_from_cents: number | null;
  price_to_cents: number | null;
  colors_json: string | null;
  image_count: number;
  missing_color_images: number;
};

const LIST_SELECT = `
  SELECT p.id, p.slug, p.name, p.price_cents, p.old_price_cents, p.status, p.updated_at, p.created_at,
         p.category_id, c.name AS category_name, c.slug AS category_slug,
         m.key AS image_key, m.alt AS image_alt, m.width AS image_width, m.height AS image_height,
         (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = p.id) AS stock_total,
         (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id) AS variant_count,
         p.size_type, p.price_from_cents, p.price_to_cents,
         CASE WHEN EXISTS (SELECT 1 FROM product_options po WHERE po.product_id = p.id AND po.type = 'color')
           THEN (SELECT json_group_array(json_object('name', pov.value, 'hex', COALESCE(pov.swatch_hex, '#000000')))
                   FROM product_options po
                   JOIN product_option_values pov ON pov.option_id = po.id
                  WHERE po.product_id = p.id AND po.type = 'color' AND pov.value <> 'Default')
           ELSE (SELECT json_group_array(json_object('name', cn, 'hex', ch))
                   FROM (SELECT v.color_name AS cn, MIN(v.color_hex) AS ch
                           FROM product_variants v
                          WHERE v.product_id = p.id AND v.color_name NOT IN ('', 'Default')
                          GROUP BY v.color_name))
         END AS colors_json,
         (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) AS image_count,
         (SELECT COUNT(*)
            FROM product_option_values pov
            JOIN product_options po ON po.id = pov.option_id
           WHERE po.product_id = p.id AND po.type = 'color'
             AND NOT EXISTS (
               SELECT 1 FROM product_images pi
                WHERE pi.product_id = p.id
                  AND (pi.option_value_id = pov.id OR LOWER(pi.color_name) = LOWER(pov.value))
             )) AS missing_color_images
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
      sizeType: r.size_type ?? "apparel",
      priceCents: Number(r.price_from_cents ?? r.price_cents ?? 0),
      priceToCents: Number(r.price_to_cents ?? r.price_from_cents ?? r.price_cents ?? 0),
      hasPriceRange:
        Number(r.price_to_cents ?? 0) > Number(r.price_from_cents ?? 0),
      colors: r.colors_json ? safeParse<Array<{ name: string; hex: string }>>(r.colors_json, []) : [],
      readiness: {
        noImage: Number(r.image_count ?? 0) === 0,
        noVariants: Number(r.variant_count ?? 0) === 0,
        priceMissing:
          r.size_type === "print" &&
          (Number(r.variant_count ?? 0) === 0 || Number(r.price_from_cents ?? 0) === 0),
        colorWithoutImages: Number(r.missing_color_images ?? 0) > 0,
      },
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

const optionValueSchema = z.object({
  value: z.string().trim().min(1).max(60),
  swatchHex: z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/, "Invalid hex color").nullable().optional(),
  swatchImageUrl: z.string().trim().max(500).nullable().optional(),
  position: z.coerce.number().int().optional(),
});

const optionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  type: z.enum(["color", "size", "other"]).default("other"),
  position: z.coerce.number().int().optional(),
  values: z.array(optionValueSchema).min(1).max(100),
});

const imageSchema = z.object({
  mediaId: z.string().min(1).max(80),
  colorName: z.string().trim().max(60).nullable().optional(),
  alt: z.string().trim().max(300).nullable().optional(),
  isPrimary: z.boolean().optional(),
  sort: z.coerce.number().int().optional(),
});

const variantSchema = z.object({
  // Present when the editor saved an existing row; keeps its id stable.
  id: z.coerce.number().int().positive().optional(),
  // Empty for products without colours (prints/posters).
  colorName: z.string().trim().max(60).default(""),
  colorHex: z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/, "Invalid hex color"),
  size: z.string().trim().min(1).max(30),
  sku: z.string().trim().max(80).optional(),
  stock: z.coerce.number().int().min(0).max(1_000_000),
  priceCents: z.coerce.number().int().min(0).nullable().optional(),
  compareAtPriceCents: z.coerce.number().int().min(0).nullable().optional(),
  trackStock: z.boolean().optional(),
  isActive: z.boolean().optional(),
  optionValues: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
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
  price_cents: z.coerce.number().int().min(0).default(0),
  old_price_cents: z.coerce.number().int().min(0).nullable().optional(),
  sizeType: z.enum(["apparel", "print", "one_size"]).default("apparel"),
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
  options: z.array(optionSchema).max(3).optional(),
  images: z.array(imageSchema).max(30).optional(),
  variants: z.array(variantSchema).max(500).optional(),
  relations: z.array(relationSchema).max(60).optional(),
});

type ProductInput = z.infer<typeof productSchema>;

function validateForPublish(input: ProductInput) {
  const fields: Record<string, string> = {};
  const variants = input.variants ?? [];
  const sizeType = input.sizeType ?? "apparel";

  // Price rules apply to every save, not just publishing.
  for (const v of variants) {
    if (v.priceCents != null && v.priceCents < 0) {
      fields.variants = "Variant prices cannot be negative";
    }
    if (
      v.compareAtPriceCents != null &&
      (v.priceCents == null || v.compareAtPriceCents <= v.priceCents)
    ) {
      fields.variants = "Compare-at price must be greater than the variant price";
    }
  }
  if (sizeType === "print" && variants.some((v) => !v.priceCents || v.priceCents <= 0)) {
    fields.variants = "Every print size needs its own price";
  }
  const allVariantsPriced = variants.length > 0 && variants.every((v) => (v.priceCents ?? 0) > 0);
  if (sizeType !== "print" && !(input.price_cents > 0) && !allVariantsPriced) {
    fields.price_cents = "Set a base price, or a price on every variant";
  }

  if (input.status !== "published") {
    if (Object.keys(fields).length) throw ApiError.validation(fields);
    return;
  }

  if ((input.images?.length ?? 0) < 1) fields.images = "Add at least one image to publish";
  if (variants.length < 1) fields.variants = "Add at least one variant to publish";
  if (!input.slug && !input.name) fields.slug = "A slug is required";

  // Every colour must sell at least one size.
  const colors = new Set(variants.map((v) => v.colorName.trim().toLowerCase()).filter(Boolean));
  for (const color of colors) {
    if (!variants.some((v) => v.colorName.trim().toLowerCase() === color)) {
      fields.variants = `Colour ${color} has no variants`;
    }
  }

  if (Object.keys(fields).length) throw ApiError.validation(fields);
}

function autoSku(slug: string, colorName: string, size: string): string {
  return `AF-${slug}-${slugify(colorName)}-${slugify(size)}`.slice(0, 80);
}

type ExistingVariant = { id: number; color_name: string; size: string };

function childStatements(
  statements: BatchStatement[],
  productRef: { sql: string; params: unknown[] },
  input: ProductInput,
  slug: string,
  existingVariants: ExistingVariant[] = [],
) {
  const { sql: pidSql, params: pidParams } = productRef;

  // 1. Options + values
  const { options, variants } = buildOptions(input.variants ?? [], input.options);
  statements.push({ sql: `DELETE FROM product_options WHERE product_id = ${pidSql}`, params: pidParams });
  for (const option of options) {
    statements.push({
      sql: `INSERT INTO product_options (product_id, name, type, position)
            VALUES (${pidSql}, ?, ?, ?)`,
      params: [...pidParams, option.name, option.type, option.position ?? 0],
    });
    for (const value of option.values) {
      statements.push({
        sql: `INSERT INTO product_option_values (option_id, value, swatch_hex, swatch_image_url, position)
              VALUES (
                (SELECT id FROM product_options WHERE product_id = ${pidSql} AND name = ?),
                ?, ?, ?, ?
              )`,
        params: [...pidParams, option.name, value.value, value.swatchHex ?? null, value.swatchImageUrl ?? null, value.position ?? 0],
      });
    }
  }

  // 2. Images (with option_value_id + is_primary + alt)
  const normalizedImages = normalizeImages(input.images ?? [], options);
  statements.push({ sql: `DELETE FROM product_images WHERE product_id = ${pidSql}`, params: pidParams });
  for (const img of normalizedImages) {
    const colorName = img.colorName;
    const pidClause = `${pidSql}`;
    // Resolve option_value_id via color value name (only for Color option)
    let optionValueIdSql = "NULL";
    let optionValueIdParams: unknown[] = [];
    if (colorName) {
      const colorOption = options.find((o) => o.type === "color");
      if (colorOption) {
        optionValueIdSql = `(SELECT pov.id
           FROM product_options po
           JOIN product_option_values pov ON pov.option_id = po.id
          WHERE po.product_id = ${pidSql}
            AND po.name = 'Color' AND pov.value = ?)`;
        optionValueIdParams = [...pidParams, colorName];
      }
    }
    const combinedParams = optionValueIdParams.length
      ? [...pidParams, img.mediaId, colorName, img.sort, ...optionValueIdParams, img.isPrimary ? 1 : 0, img.alt]
      : [...pidParams, img.mediaId, colorName || null, img.sort, img.isPrimary ? 1 : 0, img.alt];
    const combinedSql = optionValueIdParams.length
      ? `INSERT INTO product_images (product_id, media_id, color_name, sort, option_value_id, is_primary, alt)
         VALUES (${pidSql}, ?, ?, ?, ${optionValueIdSql}, ?, ?)`
      : `INSERT INTO product_images (product_id, media_id, color_name, sort, option_value_id, is_primary, alt)
         VALUES (${pidSql}, ?, ?, ?, NULL, ?, ?)`;
    statements.push({ sql: combinedSql, params: combinedParams });
  }

  // 3. Variants. Existing rows are updated in place so their ids survive a save:
  // storefront carts, order references and anything else holding a variantId
  // keep pointing at the same row. Rows dropped from the form are deleted.
  const variantKey = (colorName: string, size: string) =>
    `${(colorName ?? "").trim().toLowerCase()}|${(size ?? "").trim().toLowerCase()}`;
  const existingById = new Map(existingVariants.map((row) => [row.id, row]));
  const existingByKey = new Map(
    existingVariants.map((row) => [variantKey(row.color_name, row.size), row]),
  );
  const keptIds = new Set<number>();

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    // Build option_value_ids JSON array via subqueries in the order of options
    const optionNames = options.map((o) => o.name);
    const subqueryParts: string[] = [];
    const subqueryParams: unknown[] = [];
    for (const optName of optionNames) {
      const pair = v.optionPairs.find((p) => p.name.toLowerCase() === optName.toLowerCase());
      if (!pair) continue;
      subqueryParts.push(`(
        SELECT pov.id
          FROM product_options po
          JOIN product_option_values pov ON pov.option_id = po.id
         WHERE po.product_id = ${pidSql}
           AND po.name = ? AND pov.value = ?
      )`);
      subqueryParams.push(...pidParams, pair.name, pair.value);
    }
    const optionValueIdsSql = subqueryParts.length ? `json_array(${subqueryParts.join(",")})` : "'[]'";

    const values = [
      cleanText(v.colorName, 60),
      v.colorHex,
      cleanText(v.size, 30),
      v.sku ? cleanText(v.sku, 80) : autoSku(slug, v.colorName, v.size),
      v.stock,
      ...subqueryParams,
      v.priceCents ?? null,
      v.compareAtPriceCents ?? null,
      v.trackStock === false ? 0 : 1,
      v.isActive === false ? 0 : 1,
      i,
    ];

    const match =
      (v.id != null ? existingById.get(v.id) : undefined) ??
      existingByKey.get(variantKey(v.colorName, v.size)) ??
      null;

    if (match) {
      keptIds.add(match.id);
      statements.push({
        sql: `UPDATE product_variants SET
                color_name = ?, color_hex = ?, size = ?, sku = ?, stock = ?,
                option_value_ids = ${optionValueIdsSql},
                price_cents = ?, compare_at_price_cents = ?, track_stock = ?, is_active = ?,
                position = ?
              WHERE id = ?`,
        params: [...values, match.id],
      });
      continue;
    }

    statements.push({
      sql: `INSERT INTO product_variants
            (product_id, color_name, color_hex, size, sku, stock,
             option_value_ids, price_cents, compare_at_price_cents, track_stock, is_active, position)
            VALUES (${pidSql}, ?, ?, ?, ?, ?, ${optionValueIdsSql}, ?, ?, ?, ?, ?)`,
      params: [...pidParams, ...values],
    });
  }

  for (const old of existingVariants) {
    if (keptIds.has(old.id)) continue;
    statements.push({ sql: "DELETE FROM product_variants WHERE id = ?", params: [old.id] });
  }

  // 4. Denormalised price range (same batch, so it sees the new variants).
  const basePrice = input.price_cents ?? 0;
  statements.push({
    sql: `UPDATE products SET
            price_from_cents = (SELECT MIN(COALESCE(v.price_cents, ?)) FROM product_variants v
                                  WHERE v.product_id = ${pidSql} AND v.is_active = 1),
            price_to_cents = (SELECT MAX(COALESCE(v.price_cents, ?)) FROM product_variants v
                                WHERE v.product_id = ${pidSql} AND v.is_active = 1)
          WHERE id = ${pidSql}`,
    params: [basePrice, ...pidParams, basePrice, ...pidParams, ...pidParams],
  });

  // 5. Relations
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
               seo_title, seo_description, size_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        slug,
        cleanText(input.name, 160),
        input.shortDescription ? cleanText(input.shortDescription, 300) : null,
        input.description ?? null,
        input.price_cents ?? 0,
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
        input.sizeType ?? "apparel",
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
              seo_description = ?, size_type = ?, updated_at = datetime('now')
            WHERE id = ?`,
      params: [
        slug,
        cleanText(input.name, 160),
        input.shortDescription ? cleanText(input.shortDescription, 300) : null,
        input.description ?? null,
        input.price_cents ?? 0,
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
        input.sizeType ?? "apparel",
        id,
      ],
    },
  ];

  const existingVariants = await all<ExistingVariant>(
    c.env.DB,
    "SELECT id, color_name, size FROM product_variants WHERE product_id = ?",
    [id],
  );
  childStatements(statements, { sql: "?", params: [id] }, input, slug, existingVariants);
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

  const [options, images, variants, relations] = await Promise.all([
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
      c.env.DB,
      `SELECT po.id, po.name, po.type, po.position,
              pov.id AS value_id, pov.value, pov.swatch_hex, pov.swatch_image_url,
              pov.position AS value_position
         FROM product_options po
         LEFT JOIN product_option_values pov ON pov.option_id = po.id
        WHERE po.product_id = ?
        ORDER BY po.position, po.id, pov.position, pov.id`,
      [id],
    ),
    all<{
      id: number;
      media_id: string;
      color_name: string | null;
      sort: number;
      option_value_id: number | null;
      is_primary: number;
      alt: string | null;
      key: string;
      alt_m: string | null;
      width: number | null;
      height: number | null;
      mime: string;
    }>(
      c.env.DB,
      `SELECT pi.id, pi.media_id, pi.color_name, pi.sort, pi.option_value_id, pi.is_primary, pi.alt,
              m.key, m.alt AS alt_m, m.width, m.height, m.mime
         FROM product_images pi JOIN media m ON m.id = pi.media_id
        WHERE pi.product_id = ? ORDER BY pi.sort, pi.id`,
      [id],
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
      position: number;
    }>(
      c.env.DB,
      `SELECT id, color_name, color_hex, size, sku, stock,
              option_value_ids, price_cents, compare_at_price_cents,
              track_stock, is_active, position
         FROM product_variants
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
    sizeType: product.size_type ?? "apparel",
    priceFromCents: product.price_from_cents ?? product.price_cents,
    priceToCents: product.price_to_cents ?? product.price_cents,
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
    options: optionsArray,
    images: images.map((i) => ({
      id: i.id,
      mediaId: i.media_id,
      colorName: i.color_name,
      optionValueId: i.option_value_id,
      isPrimary: !!i.is_primary,
      alt: i.alt ?? i.alt_m,
      sort: i.sort,
      url: mediaUrl(i.key),
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
      optionValueIds: v.option_value_ids ? JSON.parse(v.option_value_ids) : [],
      priceCents: v.price_cents,
      compareAtPriceCents: v.compare_at_price_cents,
      trackStock: !!v.track_stock,
      isActive: !!v.is_active,
      position: v.position,
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
        status, is_new, is_featured, customizable, print_addon_cents, features_json, seo_title, seo_description, size_chart_id, size_type, price_from_cents, price_to_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      src.size_chart_id ?? null,
      src.size_type ?? "apparel",
      src.price_from_cents ?? null,
      src.price_to_cents ?? null,
    ],
  );
  const newId = Number(insert.meta.last_row_id);

  await batch(c.env.DB, [
    {
      sql: `INSERT INTO product_options (product_id, name, type, position)
            SELECT ?, name, type, position FROM product_options WHERE product_id = ? ORDER BY position, id`,
      params: [newId, id],
    },
    {
      sql: `INSERT INTO product_option_values (option_id, value, swatch_hex, swatch_image_url, position)
            SELECT
              (SELECT o2.id FROM product_options o2 WHERE o2.product_id = ? AND o2.name = o.name),
              pov.value, pov.swatch_hex, pov.swatch_image_url, pov.position
            FROM product_option_values pov
            JOIN product_options o ON o.id = pov.option_id
            WHERE o.product_id = ?
            ORDER BY pov.option_id, pov.position`,
      params: [newId, id],
    },
    {
      sql: `INSERT INTO product_images (product_id, media_id, color_name, sort, option_value_id, is_primary, alt)
            SELECT ?, media_id, color_name, sort, option_value_id, is_primary, alt
            FROM product_images WHERE product_id = ? ORDER BY sort, id`,
      params: [newId, id],
    },
    {
      sql: `INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock,
              option_value_ids, price_cents, compare_at_price_cents, track_stock, is_active, position)
            SELECT ?, color_name, color_hex, size, NULL, stock,
              option_value_ids, price_cents, compare_at_price_cents, track_stock, is_active, position
            FROM product_variants WHERE product_id = ? ORDER BY color_name, size`,
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
