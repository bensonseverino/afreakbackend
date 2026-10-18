import { Hono } from "hono";
import type { AppEnv } from "../../env";
import auth from "./auth";
import profile from "./profile";

/**
 * `/api/account/*` — the customer-facing account API.
 *
 * `auth` is open (sign up, sign in, sign out, forgot password); everything else
 * sits behind `requireCustomer`, which each route applies itself.
 */
const app = new Hono<AppEnv>();

app.route("/auth", auth);
app.route("/", profile);

export default app;
