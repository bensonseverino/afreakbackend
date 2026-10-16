import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, first, run, batch } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { slugify } from "../../lib/slug";
import { imageShape } from "../../lib/media";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

type CategoryRow = {
  id: number;
  slug: string;
  name: string;
  image_media_id: string | null;
  sort: number;
  image_key: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
  product_count: number;
};

const SELECT = `
  SELECT c.id, c.slug, c.name, c.image_media_id, c.sort,
         m.key AS image_key, m.alt AS image_alt, m.width AS image_width, m.height AS image_height,
         (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
    FROM categories c LEFT JOIN media m ON m.id = c.image_media_id`;

function shape(r: CategoryRow) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    imageMediaId: r.image_media_id,
    image: imageShape(
      r.image_key
        ? { key: r.image_key, alt: r.image_alt, width: r.image_width, height: r.image_height }
        : null,
    ),
    sort: r.sort,
    productCount: Number(r.product_count ?? 0),
  };
}

app.get("/", async (c) => {
  setNoStore(c);
  const rows = await all<CategoryRow>(c.env.DB, `${SELECT} ORDER BY c.sort, c.name`);
  return ok(c, rows.map(shape));
});

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().max(80).optional(),
  imageMediaId: z.string().max(80).nullable().optional(),
  sort: z.coerce.number().int().optional(),
});

app.post("/", async (c) => {
  setNoStore(c);
  const body = await parseJson(c, upsertSchema);
  const slug = slugify(body.slug || body.name);
  if (!slug) throw ApiError.validation({ name: "Name must contain letters or numbers" });

  const clash = await first(c.env.DB, "SELECT id FROM categories WHERE slug = ?", [slug]);
  if (clash) throw ApiError.validation({ slug: "Slug already in use" });

  const res = await run(
    c.env.DB,
    "INSERT INTO categories (slug, name, image_media_id, sort) VALUES (?, ?, ?, ?)",
    [slug, cleanText(body.name, 80), body.imageMediaId ?? null, body.sort ?? 0],
  );
  const row = await first<CategoryRow>(c.env.DB, `${SELECT} WHERE c.id = ?`, [
    res.meta.last_row_id,
  ]);
  return ok(c, row ? shape(row) : null);
});

app.put("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const body = await parseJson(c, upsertSchema);
  const existing = await first<{ id: number }>(c.env.DB, "SELECT id FROM categories WHERE id = ?", [id]);
  if (!existing) throw ApiError.notFound("Category not found");

  const slug = slugify(body.slug || body.name);
  const clash = await first<{ id: number }>(
    c.env.DB,
    "SELECT id FROM categories WHERE slug = ? AND id <> ?",
    [slug, id],
  );
  if (clash) throw ApiError.validation({ slug: "Slug already in use" });

  await run(
    c.env.DB,
    "UPDATE categories SET slug = ?, name = ?, image_media_id = ?, sort = ? WHERE id = ?",
    [slug, cleanText(body.name, 80), body.imageMediaId ?? null, body.sort ?? 0, id],
  );
  const row = await first<CategoryRow>(c.env.DB, `${SELECT} WHERE c.id = ?`, [id]);
  return ok(c, row ? shape(row) : null);
});

/** POST /admin/categories/reorder — persists drag order. */
app.post("/reorder", async (c) => {
  setNoStore(c);
  const body = await parseJson(c, z.object({ ids: z.array(z.coerce.number().int().positive()).max(200) }));
  await batch(
    c.env.DB,
    body.ids.map((id, index) => ({ sql: "UPDATE categories SET sort = ? WHERE id = ?", params: [index, id] })),
  );
  return ok(c, { reordered: true });
});

app.delete("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const used = await first<{ n: number }>(
    c.env.DB,
    "SELECT COUNT(*) AS n FROM products WHERE category_id = ?",
    [id],
  );
  if (Number(used?.n ?? 0) > 0) {
    throw ApiError.conflict("Category still has products — reassign them first");
  }
  await run(c.env.DB, "DELETE FROM categories WHERE id = ?", [id]);
  return ok(c, { deleted: true });
});

export default app;
