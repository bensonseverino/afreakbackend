import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { all, count, run } from "../../lib/db";
import { ok } from "../../lib/http";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET /admin/subscribers/export.csv */
app.get("/export.csv", async (c) => {
  const rows = await all<{ email: string; source: string | null; status: string; created_at: string }>(
    c.env.DB,
    "SELECT email, source, status, created_at FROM subscribers ORDER BY created_at DESC LIMIT 20000",
  );
  const csv = [["email", "source", "status", "created_at"], ...rows.map((r) => [r.email, r.source, r.status, r.created_at])]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="subscribers.csv"');
  setNoStore(c);
  return c.body(csv);
});

/** GET /admin/subscribers */
app.get("/", async (c) => {
  setNoStore(c);
  const q = c.req.query("q")?.trim();
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50));

  const where = q ? "WHERE email LIKE ?" : "";
  const params = q ? [`%${q}%`] : [];

  const [total, rows] = await Promise.all([
    count(c.env.DB, `SELECT COUNT(*) AS n FROM subscribers ${where}`, params),
    all<Record<string, unknown>>(
      c.env.DB,
      `SELECT id, email, source, status, created_at FROM subscribers ${where}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    ),
  ]);

  return ok(
    c,
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      source: r.source,
      status: r.status,
      createdAt: r.created_at,
    })),
    { total, page, pages: Math.max(1, Math.ceil(total / limit)) },
  );
});

/** DELETE /admin/subscribers/:id */
app.delete("/:id", async (c) => {
  setNoStore(c);
  await run(c.env.DB, "DELETE FROM subscribers WHERE id = ?", [Number(c.req.param("id"))]);
  return ok(c, { deleted: true });
});

export default app;
