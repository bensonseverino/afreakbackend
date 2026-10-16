import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { ApiError, ok } from "../../lib/http";
import { sniffImage } from "../../lib/image";
import { setNoStore } from "../../middleware/cache";
import { rateLimit } from "../../middleware/rateLimit";

const app = new Hono<AppEnv>();

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * POST /uploads/artwork — private customer artwork (custom print).
 * Stored under a prefix that `/media/*` always 404s.
 */
app.post(
  "/artwork",
  rateLimit({ scope: "artwork", limit: 10, windowMs: 60 * 60_000 }),
  async (c) => {
    setNoStore(c);

    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw ApiError.badRequest("Missing file");

    if (file.size > MAX_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "File must be 10 MB or smaller");
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(buffer);
    if (!kind) throw ApiError.badRequest("Unsupported file type (png, jpg, webp, pdf)");

    const year = new Date().getUTCFullYear();
    const key = `artwork/${year}/${crypto.randomUUID()}.${kind.ext}`;

    await c.env.MEDIA.put(key, buffer, {
      httpMetadata: { contentType: kind.mime },
    });

    return ok(c, { artworkKey: key });
  },
);

export default app;
