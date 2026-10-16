import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, batch, count, first } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson } from "../../lib/validate";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

/** GET /admin/reviews?status=&page= */
app.get("/", async (c) => {
  setNoStore(c);
  const status = c.req.query("status");
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query("limit") ?? "20", 10) || 20));

  const where: string[] = [];
  const params: unknown[] = [];
  if (status && ["pending", "approved", "rejected"].includes(status)) {
    where.push("r.status = ?");
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [total, rows, countsRow] = await Promise.all([
    count(c.env.DB, `SELECT COUNT(*) AS n FROM reviews r ${whereSql}`, params),
    all<Record<string, unknown>>(
      c.env.DB,
      `SELECT r.id, r.product_id, r.author_name, r.email, r.rating, r.title, r.body, r.status,
              r.verified_purchase, r.created_at, p.name AS product_name, p.slug AS product_slug
         FROM reviews r JOIN products p ON p.id = r.product_id
         ${whereSql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    ),
    all<{ status: string; n: number }>(
      c.env.DB,
      "SELECT status, COUNT(*) AS n FROM reviews GROUP BY status",
    ),
  ]);

  const counts: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const row of countsRow) counts[row.status] = Number(row.n);

  return ok(
    c,
    rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      productSlug: r.product_slug,
      author: r.author_name,
      email: r.email,
      rating: r.rating,
      title: r.title,
      body: r.body,
      status: r.status,
      verified: !!r.verified_purchase,
      createdAt: r.created_at,
    })),
    { total, page, pages: Math.max(1, Math.ceil(total / limit)), counts },
  );
});

/** PATCH /admin/reviews/:id — approve or reject, then recompute the product rating. */
app.patch("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const body = await parseJson(c, z.object({ status: z.enum(["pending", "approved", "rejected"]) }));

  const review = await first<{ product_id: number }>(
    c.env.DB,
    "SELECT product_id FROM reviews WHERE id = ?",
    [id],
  );
  if (!review) throw ApiError.notFound("Review not found");

  await batch(c.env.DB, [
    { sql: "UPDATE reviews SET status = ? WHERE id = ?", params: [body.status, id] },
    {
      sql: `UPDATE products SET
              rating_avg = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE product_id = ? AND status = 'approved'),
              review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved'),
              updated_at = datetime('now')
            WHERE id = ?`,
      params: [review.product_id, review.product_id, review.product_id],
    },
  ]);

  return ok(c, { id, status: body.status });
});

/** DELETE /admin/reviews/:id */
app.delete("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const review = await first<{ product_id: number }>(
    c.env.DB,
    "SELECT product_id FROM reviews WHERE id = ?",
    [id],
  );
  if (!review) throw ApiError.notFound("Review not found");

  await batch(c.env.DB, [
    { sql: "DELETE FROM reviews WHERE id = ?", params: [id] },
    {
      sql: `UPDATE products SET
              rating_avg = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE product_id = ? AND status = 'approved'),
              review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved'),
              updated_at = datetime('now')
            WHERE id = ?`,
      params: [review.product_id, review.product_id, review.product_id],
    },
  ]);

  return ok(c, { deleted: true });
});

export default app;
