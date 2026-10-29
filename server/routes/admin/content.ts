import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, batch, first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { imageShape } from "../../lib/media";
import { touchContentStatement } from "../../lib/contentVersion";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

/** GET /admin/content — hero slides + lookbook for the homepage editor. */
app.get("/", async (c) => {
  setNoStore(c);
  const [heroes, lookbook] = await Promise.all([
    all<Record<string, unknown>>(
      c.env.DB,
      `SELECT h.*, m.key, m.alt, m.width, m.height
         FROM hero_slides h LEFT JOIN media m ON m.id = h.media_id
        ORDER BY h.sort, h.id`,
    ),
    all<Record<string, unknown>>(
      c.env.DB,
      `SELECT li.*, m.key, m.alt, m.width, m.height
         FROM lookbook_items li JOIN media m ON m.id = li.media_id
        ORDER BY li.sort, li.id`,
    ),
  ]);

  return ok(c, {
    heroSlides: heroes.map((h) => ({
      id: h.id,
      eyebrow: h.eyebrow,
      title: h.title,
      subtitle: h.subtitle,
      ctaLabel: h.cta_label,
      ctaUrl: h.cta_url,
      mediaId: h.media_id,
      image: imageShape(
        h.key ? { key: h.key as string, alt: h.alt as string | null, width: h.width as number | null, height: h.height as number | null } : null,
      ),
      sort: h.sort,
      active: !!h.active,
    })),
    lookbook: lookbook.map((l) => ({
      id: l.id,
      mediaId: l.media_id,
      caption: l.caption,
      linkUrl: l.link_url,
      image: imageShape({
        key: l.key as string,
        alt: l.alt as string | null,
        width: l.width as number | null,
        height: l.height as number | null,
      }),
      sort: l.sort,
      active: !!l.active,
    })),
  });
});

// --- Hero slides -----------------------------------------------------------

const heroSchema = z.object({
  eyebrow: z.string().trim().max(80).nullable().optional(),
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(400).nullable().optional(),
  ctaLabel: z.string().trim().max(60).nullable().optional(),
  ctaUrl: z.string().trim().max(300).nullable().optional(),
  mediaId: z.string().max(80).nullable().optional(),
  sort: z.coerce.number().int().optional(),
  active: z.boolean().optional(),
});

app.post("/hero", async (c) => {
  setNoStore(c);
  const b = await parseJson(c, heroSchema);
  const count = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM hero_slides");
  if (Number(count?.n ?? 0) >= 5) throw ApiError.conflict("Maximum of 5 hero slides");

  const res = await run(
    c.env.DB,
    `INSERT INTO hero_slides (eyebrow, title, subtitle, cta_label, cta_url, media_id, sort, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      b.eyebrow ?? null,
      cleanText(b.title, 160),
      b.subtitle ?? null,
      b.ctaLabel ?? null,
      b.ctaUrl ?? null,
      b.mediaId ?? null,
      b.sort ?? 0,
      b.active === false ? 0 : 1,
    ],
  );
  return ok(c, { id: res.meta.last_row_id });
});

app.put("/hero/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const b = await parseJson(c, heroSchema);
  await run(
    c.env.DB,
    `UPDATE hero_slides SET eyebrow = ?, title = ?, subtitle = ?, cta_label = ?, cta_url = ?,
            media_id = ?, sort = ?, active = ? WHERE id = ?`,
    [
      b.eyebrow ?? null,
      cleanText(b.title, 160),
      b.subtitle ?? null,
      b.ctaLabel ?? null,
      b.ctaUrl ?? null,
      b.mediaId ?? null,
      b.sort ?? 0,
      b.active === false ? 0 : 1,
      id,
    ],
  );
  return ok(c, { id });
});

const reorderHero = async (c: Context<AppEnv>) => {
  setNoStore(c);
  const body = await parseJson(c, z.object({ ids: z.array(z.coerce.number().int().positive()).max(20) }));
  await batch(c.env.DB, [
    ...body.ids.map((id, index) => ({ sql: "UPDATE hero_slides SET sort = ? WHERE id = ?", params: [index, id] })),
    touchContentStatement(),
  ]);
  return ok(c, { reordered: true });
};

// Both paths/verbs are kept: `/hero/reorder` (CMS) and `/hero-slides/reorder` (spec §7.1).
app.post("/hero/reorder", reorderHero);
app.put("/hero/reorder", reorderHero);
app.post("/hero-slides/reorder", reorderHero);
app.put("/hero-slides/reorder", reorderHero);

app.delete("/hero/:id", async (c) => {
  setNoStore(c);
  await run(c.env.DB, "DELETE FROM hero_slides WHERE id = ?", [Number(c.req.param("id"))]);
  return ok(c, { deleted: true });
});

// --- Lookbook --------------------------------------------------------------

const lookbookSchema = z.object({
  mediaId: z.string().min(1).max(80),
  caption: z.string().trim().max(120).nullable().optional(),
  linkUrl: z.string().trim().max(300).nullable().optional(),
  sort: z.coerce.number().int().optional(),
  active: z.boolean().optional(),
});

app.post("/lookbook", async (c) => {
  setNoStore(c);
  const b = await parseJson(c, lookbookSchema);
  const res = await run(
    c.env.DB,
    `INSERT INTO lookbook_items (media_id, caption, link_url, sort, active) VALUES (?, ?, ?, ?, ?)`,
    [b.mediaId, b.caption ?? null, b.linkUrl ?? null, b.sort ?? 0, b.active === false ? 0 : 1],
  );
  return ok(c, { id: res.meta.last_row_id });
});

app.put("/lookbook/:id", async (c) => {
  setNoStore(c);
  const id = Number(c.req.param("id"));
  const b = await parseJson(c, lookbookSchema);
  await run(
    c.env.DB,
    `UPDATE lookbook_items SET media_id = ?, caption = ?, link_url = ?, sort = ?, active = ? WHERE id = ?`,
    [b.mediaId, b.caption ?? null, b.linkUrl ?? null, b.sort ?? 0, b.active === false ? 0 : 1, id],
  );
  return ok(c, { id });
});

const reorderLookbook = async (c: Context<AppEnv>) => {
  setNoStore(c);
  const body = await parseJson(c, z.object({ ids: z.array(z.coerce.number().int().positive()).max(50) }));
  await batch(c.env.DB, [
    ...body.ids.map((id, index) => ({ sql: "UPDATE lookbook_items SET sort = ? WHERE id = ?", params: [index, id] })),
    touchContentStatement(),
  ]);
  return ok(c, { reordered: true });
};

app.post("/lookbook/reorder", reorderLookbook);
app.put("/lookbook/reorder", reorderLookbook);
app.post("/lookbook-items/reorder", reorderLookbook);
app.put("/lookbook-items/reorder", reorderLookbook);

app.delete("/lookbook/:id", async (c) => {
  setNoStore(c);
  await run(c.env.DB, "DELETE FROM lookbook_items WHERE id = ?", [Number(c.req.param("id"))]);
  return ok(c, { deleted: true });
});

export default app;
