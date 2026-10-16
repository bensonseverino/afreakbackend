import type { Env } from "../../server/env";

const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Streams public R2 media. Objects under the private `artwork/` prefix are
 * never served here (admins download them via /api/admin/artwork/*).
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const raw = params.path;
  const key = (Array.isArray(raw) ? raw.join("/") : String(raw ?? "")).replace(/^\/+/, "");
  if (!key || key.startsWith("artwork/")) {
    return new Response("Not found", { status: 404 });
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const object = await env.MEDIA.get(key, { range: request.headers });
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", IMMUTABLE);
  headers.set("Accept-Ranges", "bytes");

  if (request.headers.get("If-None-Match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  const range = object.range;
  let status = 200;
  if (range && "offset" in range && range.offset != null && range.length != null) {
    status = 206;
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
    );
    headers.set("Content-Length", String(range.length));
  } else if (range && "suffix" in range) {
    const start = Math.max(0, object.size - range.suffix);
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${object.size - 1}/${object.size}`);
    headers.set("Content-Length", String(object.size - start));
  } else {
    headers.set("Content-Length", String(object.size));
  }

  if (request.method === "HEAD") return new Response(null, { status, headers });

  const response = new Response(object.body, { status, headers });
  if (status === 200) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};
