import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, count, first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { isMediaPrefix, sniffImage } from "../../lib/image";
import { mediaShape, type MediaRow } from "../../lib/media";
import { newId } from "../../lib/ids";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const MAX_BYTES = 10 * 1024 * 1024;

/** GET /admin/media — paginated library. */
app.get("/", async (c) => {
  setNoStore(c);
  const q = c.req.query("q")?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(60, Math.max(1, Number.parseInt(c.req.query("limit") ?? "24", 10) || 24));

  const where = q ? "WHERE key LIKE ? OR alt LIKE ? OR filename LIKE ?" : "";
  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];

  const total = await count(c.env.DB, `SELECT COUNT(*) AS n FROM media ${where}`, params);
  const rows = await all<MediaRow>(
    c.env.DB,
    `SELECT * FROM media ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return ok(c, rows.map(mediaShape), {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

/** POST /admin/media — upload one or more files. */
app.post("/", async (c) => {
  setNoStore(c);
  const form = await c.req.formData().catch(() => null);
  if (!form) throw ApiError.badRequest("Expected multipart form data");

  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw ApiError.badRequest("No files provided");

  const prefixRaw = String(form.get("prefix") ?? "products");
  const prefix = isMediaPrefix(prefixRaw) ? prefixRaw : "products";

  let meta: Array<{ width?: number; height?: number; alt?: string }> = [];
  const metaRaw = form.get("meta");
  if (typeof metaRaw === "string" && metaRaw) {
    try {
      const parsed = JSON.parse(metaRaw);
      if (Array.isArray(parsed)) meta = parsed;
    } catch {
      /* ignore malformed meta */
    }
  }

  const year = new Date().getUTCFullYear();
  const created: ReturnType<typeof mediaShape>[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > MAX_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", `${file.name} is larger than 10 MB`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) throw ApiError.badRequest(`Unsupported file type: ${file.name}`);

    const key = `${prefix}/${year}/${crypto.randomUUID()}.${kind.ext}`;
    await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: kind.mime } });

    const info = meta[i] ?? {};
    const id = newId("med");
    await run(
      c.env.DB,
      `INSERT INTO media (id, key, filename, mime, size, width, height, alt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        key,
        cleanText(file.name, 200),
        kind.mime,
        file.size,
        info.width ?? null,
        info.height ?? null,
        info.alt ? cleanText(info.alt, 300) : null,
      ],
    );

    const row = await first<MediaRow>(c.env.DB, "SELECT * FROM media WHERE id = ?", [id]);
    if (row) created.push(mediaShape(row));
  }

  return ok(c, created);
});

/** PATCH /admin/media/:id — update alt text. */
app.patch("/:id", async (c) => {
  setNoStore(c);
  const body = await parseJson(c, z.object({ alt: z.string().max(300).nullable() }));
  const id = c.req.param("id");

  const existing = await first<{ id: string }>(c.env.DB, "SELECT id FROM media WHERE id = ?", [id]);
  if (!existing) throw ApiError.notFound("Media not found");

  await run(c.env.DB, "UPDATE media SET alt = ? WHERE id = ?", [
    body.alt ? cleanText(body.alt, 300) : null,
    id,
  ]);
  const row = await first<MediaRow>(c.env.DB, "SELECT * FROM media WHERE id = ?", [id]);
  return ok(c, row ? mediaShape(row) : null);
});

/** DELETE /admin/media/:id — blocked while the object is referenced. */
app.delete("/:id", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  const row = await first<MediaRow>(c.env.DB, "SELECT * FROM media WHERE id = ?", [id]);
  if (!row) throw ApiError.notFound("Media not found");

  const refs = await first<{ n: number }>(
    c.env.DB,
    `SELECT
        (SELECT COUNT(*) FROM product_images WHERE media_id = ?) +
        (SELECT COUNT(*) FROM categories WHERE image_media_id = ?) +
        (SELECT COUNT(*) FROM hero_slides WHERE media_id = ?) +
        (SELECT COUNT(*) FROM lookbook_items WHERE media_id = ?) AS n`,
    [id, id, id, id],
  );
  if (Number(refs?.n ?? 0) > 0) {
    throw ApiError.conflict("This image is in use and cannot be deleted");
  }

  await run(c.env.DB, "DELETE FROM media WHERE id = ?", [id]);
  await c.env.MEDIA.delete(row.key);
  return ok(c, { deleted: true });
});

export default app;
