import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { ApiError } from "../../lib/http";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

/**
 * GET /admin/artwork/:rest{.+}
 * Streams a private customer artwork object from R2 as a download.
 * Accepts both `artwork/2026/x.pdf` and `2026/x.pdf` forms.
 */
app.get("/:rest{.+}", async (c) => {
  setNoStore(c);
  const rest = c.req.param("rest");
  const key = rest.startsWith("artwork/") ? rest : `artwork/${rest}`;

  // Defense in depth: only ever serve the private artwork prefix.
  if (!key.startsWith("artwork/")) throw ApiError.forbidden();

  const object = await c.env.MEDIA.get(key);
  if (!object) throw ApiError.notFound("Artwork not found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Disposition", `attachment; filename="${key.split("/").pop()}"`);

  return new Response(object.body, { headers });
});

export default app;
