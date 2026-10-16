import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { all } from "../../lib/db";
import { ok } from "../../lib/http";
import { imageShape } from "../../lib/media";
import { setPublicCache } from "../../middleware/cache";

const app = new Hono<AppEnv>();

/** All categories with a published product count and optional image. */
app.get("/", async (c) => {
  setPublicCache(c);
  const rows = await all<{
    slug: string;
    name: string;
    sort: number;
    image_key: string | null;
    image_alt: string | null;
    image_width: number | null;
    image_height: number | null;
    product_count: number;
  }>(
    c.env.DB,
    `SELECT c.slug, c.name, c.sort,
            m.key AS image_key, m.alt AS image_alt, m.width AS image_width, m.height AS image_height,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'published') AS product_count
       FROM categories c
       LEFT JOIN media m ON m.id = c.image_media_id
      ORDER BY c.sort, c.name`,
  );

  return ok(
    c,
    rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      image: imageShape(
        r.image_key
          ? { key: r.image_key, alt: r.image_alt, width: r.image_width, height: r.image_height }
          : null,
      ),
      productCount: Number(r.product_count ?? 0),
    })),
  );
});

export default app;
