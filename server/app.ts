import { Hono } from "hono";
import type { AppEnv } from "./env";
import { cors } from "./middleware/cors";
import { sameOrigin } from "./middleware/csrf";
import { ApiError, errorBody, ok } from "./lib/http";
import publicRoutes from "./routes/public";
import adminRoutes from "./routes/admin";
import webhookRoutes from "./routes/webhooks";

/**
 * The single JSON API for both the storefront and the admin CMS.
 * Mounted at /api by the Pages Function `functions/api/[[route]].ts`.
 */
export function buildApp() {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", cors);
  app.use("*", sameOrigin);

  app.get("/health", (c) => ok(c, { ok: true }));

  app.route("/webhooks", webhookRoutes);
  app.route("/", publicRoutes);
  app.route("/admin", adminRoutes);

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      const headers: Record<string, string> = {};
      if (err.status === 401) headers["WWW-Authenticate"] = "Session";
      return c.json(errorBody(err), err.status, headers);
    }
    console.error("[api] unhandled error:", err);
    return c.json({ error: { code: "INTERNAL", message: "Internal server error" } }, 500);
  });

  return app;
}
