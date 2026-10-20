import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, count, first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { cleanText, parseJson, readJsonWithLimit, zodFields } from "../../lib/validate";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

type SizeChartRow = {
  id: string;
  title: string;
  unit: string;
  applies_to: string;
  sizes: string;
  measurements: string;
  created_at: string;
  updated_at: string;
};

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function present(r: SizeChartRow) {
  return {
    id: r.id,
    title: r.title,
    unit: r.unit,
    appliesTo: safeParse<string[]>(r.applies_to, []),
    sizes: safeParse<string[]>(r.sizes, []),
    measurements: safeParse<Record<string, (string | number)[]>>(r.measurements, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** GET /admin/size-charts?q=&page=&limit= */
app.get("/", async (c) => {
  setNoStore(c);
  const q = c.req.query("q")?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50));

  const where = q ? "WHERE title LIKE ? OR id LIKE ?" : "";
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  const [total, rows] = await Promise.all([
    count(c.env.DB, `SELECT COUNT(*) AS n FROM size_charts ${where}`, params),
    all<SizeChartRow>(
      c.env.DB,
      `SELECT * FROM size_charts ${where} ORDER BY title ASC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    ),
  ]);

  return ok(c, rows.map(present), { total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

/** GET /admin/size-charts/:id */
app.get("/:id", async (c) => {
  setNoStore(c);
  const row = await first<SizeChartRow>(
    c.env.DB,
    "SELECT * FROM size_charts WHERE id = ?",
    [c.req.param("id")],
  );
  if (!row) throw ApiError.notFound("Size chart not found");
  return ok(c, present(row));
});

const chartSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/, "Use a slug-like id (letters, numbers, -, _)"),
  title: z.string().trim().min(1).max(160),
  unit: z.string().trim().max(20).default("inches"),
  appliesTo: z.array(z.string().trim().max(40)).optional(),
  sizes: z.array(z.string().trim().min(1).max(30)).min(1, "Add at least one size"),
  measurements: z.record(z.string(), z.array(z.union([z.string(), z.number()]))).default({}),
});

/** POST /admin/size-charts */
app.post("/", async (c) => {
  setNoStore(c);
  const input = (await parseJson(c, chartSchema)) as z.infer<typeof chartSchema> & {
    appliesTo?: string[];
    measurements: Record<string, (string | number)[]>;
  };

  const existing = await first<{ id: string }>(
    c.env.DB,
    "SELECT id FROM size_charts WHERE id = ?",
    [input.id],
  );
  if (existing) throw ApiError.conflict("A size chart with this id already exists");

  await run(
    c.env.DB,
    `INSERT INTO size_charts
       (id, title, unit, applies_to, sizes, measurements, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.id,
      cleanText(input.title, 160),
      input.unit || "inches",
      JSON.stringify(input.appliesTo ?? []),
      JSON.stringify(input.sizes),
      JSON.stringify(input.measurements),
    ],
  );

  const row = await first<SizeChartRow>(
    c.env.DB,
    "SELECT * FROM size_charts WHERE id = ?",
    [input.id],
  );
  return ok(c, present(row!));
});

/** PUT /admin/size-charts/:id */
app.put("/:id", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  const existing = await first<{ id: string }>(
    c.env.DB,
    "SELECT id FROM size_charts WHERE id = ?",
    [id],
  );
  if (!existing) throw ApiError.notFound("Size chart not found");

  const input = (await parseJson(c, chartSchema)) as z.infer<typeof chartSchema> & {
    appliesTo?: string[];
    measurements: Record<string, (string | number)[]>;
  };

  await run(
    c.env.DB,
    `UPDATE size_charts SET
       title = ?, unit = ?, applies_to = ?, sizes = ?, measurements = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [
      cleanText(input.title, 160),
      input.unit || "inches",
      JSON.stringify(input.appliesTo ?? []),
      JSON.stringify(input.sizes),
      JSON.stringify(input.measurements),
      id,
    ],
  );

  const row = await first<SizeChartRow>(
    c.env.DB,
    "SELECT * FROM size_charts WHERE id = ?",
    [id],
  );
  return ok(c, present(row!));
});

/** DELETE /admin/size-charts/:id — refused while products still reference it. */
app.delete("/:id", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  const used = await count(
    c.env.DB,
    "SELECT COUNT(*) AS n FROM products WHERE size_chart_id = ?",
    [id],
  );
  if (used > 0) {
    throw ApiError.conflict("Size chart is in use by one or more products", {
      details: { usedByProducts: used },
    });
  }
  await run(c.env.DB, "DELETE FROM size_charts WHERE id = ?", [id]);
  return ok(c, { deleted: true });
});

export default app;
