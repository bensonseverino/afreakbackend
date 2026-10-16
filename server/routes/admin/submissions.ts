import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, count, first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson } from "../../lib/validate";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const TYPES = ["contact", "custom_print", "notify_me", "other"] as const;
const STATUSES = ["new", "read", "replied", "archived"] as const;

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET /admin/submissions/export.csv */
app.get("/export.csv", async (c) => {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, type, created_at, status, name, email, subject, message, payload_json
       FROM submissions ORDER BY created_at DESC LIMIT 10000`,
  );
  const csv = [
    ["id", "type", "created_at", "status", "name", "email", "subject", "message", "payload"],
    ...rows.map((r) => [
      r.id, r.type, r.created_at, r.status, r.name, r.email, r.subject, r.message, r.payload_json,
    ]),
  ]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="submissions.csv"');
  setNoStore(c);
  return c.body(csv);
});

/** GET /admin/submissions */
app.get("/", async (c) => {
  setNoStore(c);
  const type = c.req.query("type");
  const status = c.req.query("status");
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query("limit") ?? "20", 10) || 20));

  const where: string[] = [];
  const params: unknown[] = [];
  if (type && (TYPES as readonly string[]).includes(type)) {
    where.push("type = ?");
    params.push(type);
  }
  if (status && (STATUSES as readonly string[]).includes(status)) {
    where.push("status = ?");
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [total, rows, countsRows] = await Promise.all([
    count(c.env.DB, `SELECT COUNT(*) AS n FROM submissions ${whereSql}`, params),
    all<Record<string, unknown>>(
      c.env.DB,
      `SELECT * FROM submissions ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    ),
    all<{ type: string; n: number }>(
      c.env.DB,
      "SELECT type, COUNT(*) AS n FROM submissions GROUP BY type",
    ),
  ]);

  const counts: Record<string, number> = { all: 0 };
  for (const row of countsRows) {
    counts[row.type] = Number(row.n);
    counts.all += Number(row.n);
  }

  return ok(
    c,
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      email: r.email,
      subject: r.subject,
      message: r.message,
      payload: safeParse<Record<string, unknown>>(r.payload_json as string, {}),
      status: r.status,
      createdAt: r.created_at,
    })),
    { total, page, pages: Math.max(1, Math.ceil(total / limit)), counts },
  );
});

/** GET /admin/submissions/:id */
app.get("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const row = await first<Record<string, unknown>>(c.env.DB, "SELECT * FROM submissions WHERE id = ?", [id]);
  if (!row) throw ApiError.notFound("Submission not found");
  return ok(c, {
    id: row.id,
    type: row.type,
    name: row.name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    payload: safeParse<Record<string, unknown>>(row.payload_json as string, {}),
    status: row.status,
    createdAt: row.created_at,
  });
});

/** PATCH /admin/submissions/:id */
app.patch("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const body = await parseJson(c, z.object({ status: z.enum(STATUSES) }));
  await run(c.env.DB, "UPDATE submissions SET status = ? WHERE id = ?", [body.status, id]);
  return ok(c, { id, status: body.status });
});

/** DELETE /admin/submissions/:id */
app.delete("/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  await run(c.env.DB, "DELETE FROM submissions WHERE id = ?", [id]);
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
