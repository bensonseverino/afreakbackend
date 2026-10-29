import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { all } from "../../lib/db";
import { ok } from "../../lib/http";
import { getContentVersion } from "../../lib/contentVersion";
import { setContentCache } from "../../middleware/cache";
import { serializeLookbookItem, type LookbookRow } from "../../serializers";

const app = new Hono<AppEnv>();

/** GET /lookbook — every active lookbook item for the /lookbook page. */
app.get("/", async (c) => {
  const version = await getContentVersion(c.env);
  if (setContentCache(c, version)) return c.body(null, 304);

  const rows = await all<LookbookRow>(
    c.env.DB,
    `SELECT l.id, l.caption, l.link_url, l.sort,
            m.key AS media_key, m.alt AS media_alt, m.width AS media_w, m.height AS media_h
       FROM lookbook_items l JOIN media m ON m.id = l.media_id
      WHERE l.active = 1 ORDER BY l.sort ASC, l.id ASC LIMIT 24`,
  );
  return ok(c, rows.map(serializeLookbookItem), { version });
});

export default app;
