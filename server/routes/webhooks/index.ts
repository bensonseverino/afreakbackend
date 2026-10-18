import { Hono } from "hono";
import type { AppEnv } from "../../env";
import clerk from "./clerk";

/**
 * Third-party callbacks. Unlike `routes/public`, these are for machines, not the
 * storefront: they are mounted straight onto `/api/webhooks` and authenticate
 * with their provider's signature instead of a session.
 */
const app = new Hono<AppEnv>();

app.route("/clerk", clerk);

export default app;
