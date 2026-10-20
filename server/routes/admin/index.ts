import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { requireAdmin } from "../../middleware/auth";
import auth from "./auth";
import dashboard from "./dashboard";
import products from "./products";
import categories from "./categories";
import media from "./media";
import orders from "./orders";
import reviews from "./reviews";
import submissions from "./submissions";
import subscribers from "./subscribers";
import customers from "./customers";
import passwordRequests from "./passwordRequests";
import promos from "./promos";
import content from "./content";
import settings from "./settings";
import users from "./users";
import artwork from "./artwork";
import sizeCharts from "./sizeCharts";

const app = new Hono<AppEnv>();

// /login, /logout, /me (and /password, which guards itself).
app.route("/", auth);

// Everything else requires a valid admin session.
const protectedRoutes = new Hono<AppEnv>();
protectedRoutes.use("*", requireAdmin);
protectedRoutes.route("/dashboard", dashboard);
protectedRoutes.route("/products", products);
protectedRoutes.route("/categories", categories);
protectedRoutes.route("/media", media);
protectedRoutes.route("/orders", orders);
protectedRoutes.route("/reviews", reviews);
protectedRoutes.route("/submissions", submissions);
protectedRoutes.route("/subscribers", subscribers);
protectedRoutes.route("/customers", customers);
protectedRoutes.route("/password-requests", passwordRequests);
protectedRoutes.route("/promos", promos);
protectedRoutes.route("/content", content);
protectedRoutes.route("/settings", settings);
protectedRoutes.route("/users", users);
protectedRoutes.route("/artwork", artwork);
protectedRoutes.route("/size-charts", sizeCharts);

app.route("/", protectedRoutes);

export default app;
