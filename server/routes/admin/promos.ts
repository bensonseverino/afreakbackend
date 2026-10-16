import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson } from "../../lib/validate";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const promoBody = z.object({
  code: z.string().trim().min(2).max(40),
  type: z.enum(["percent", "fixed"]),
  value: z.coerce.number().int().min(0),
  minSubtotalCents: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
  expiresAt: z.string().trim().max(40).nullable().optional(),
  maxUses: z.coerce.number().int().min(1).nullable().optional(),
});

/** GET /admin/promos */
app.get("/", async (c) => {
  setNoStore(c);
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    "SELECT * FROM promo_codes ORDER BY active DESC, code",
  );
  return ok(
    c,
    rows.map((r) => ({
      code: r.code,
      type: r.type,
      value: r.value,
      minSubtotalCents: r.min_subtotal_cents,
      active: !!r.active,
      expiresAt: r.expires_at,
      maxUses: r.max_uses,
      uses: r.uses,
    })),
  );
});

/** POST /admin/promos */
app.post("/", async (c) => {
  setNoStore(c);
  const body = await parseJson(c, promoBody);
  const code = body.code.toUpperCase();

  const clash = await first(c.env.DB, "SELECT code FROM promo_codes WHERE code = ?", [code]);
  if (clash) throw ApiError.validation({ code: "This code already exists" });

  await run(
    c.env.DB,
    `INSERT INTO promo_codes (code, type, value, min_subtotal_cents, active, expires_at, max_uses)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      body.type,
      body.value,
      body.minSubtotalCents,
      body.active ? 1 : 0,
      body.expiresAt ?? null,
      body.maxUses ?? null,
    ],
  );
  return ok(c, { code });
});

/** PUT /admin/promos/:code */
app.put("/:code", async (c) => {
  setNoStore(c);
  const code = c.req.param("code").toUpperCase();
  const body = await parseJson(c, promoBody);

  const existing = await first(c.env.DB, "SELECT code FROM promo_codes WHERE code = ?", [code]);
  if (!existing) throw ApiError.notFound("Promo not found");

  await run(
    c.env.DB,
    `UPDATE promo_codes SET type = ?, value = ?, min_subtotal_cents = ?, active = ?,
            expires_at = ?, max_uses = ? WHERE code = ?`,
    [
      body.type,
      body.value,
      body.minSubtotalCents,
      body.active ? 1 : 0,
      body.expiresAt ?? null,
      body.maxUses ?? null,
      code,
    ],
  );
  return ok(c, { code });
});

/** DELETE /admin/promos/:code */
app.delete("/:code", async (c) => {
  setNoStore(c);
  await run(c.env.DB, "DELETE FROM promo_codes WHERE code = ?", [c.req.param("code").toUpperCase()]);
  return ok(c, { deleted: true });
});

export default app;
