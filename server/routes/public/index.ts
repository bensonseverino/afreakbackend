import { Hono } from "hono";
import type { AppEnv } from "../../env";
import settings from "./settings";
import categories from "./categories";
import products from "./products";
import reviews from "./reviews";
import home from "./home";
import forms from "./forms";
import uploads from "./uploads";
import promo from "./promo";
import checkout from "./checkout";
import orders from "./orders";
import track from "./track";
import rates from "./rates";
import geo from "./geo";

const app = new Hono<AppEnv>();

app.route("/settings/public", settings);
app.route("/categories", categories);

// `products` serves GET / and GET /:slug; `reviews` adds POST /:slug/reviews.
app.route("/products", products);
app.route("/products", reviews);

app.route("/home", home);
app.route("/forms", forms);
app.route("/uploads", uploads);
app.route("/promo", promo);
app.route("/checkout", checkout);
app.route("/orders", orders);
app.route("/track", track);
app.route("/rates", rates);
app.route("/geo", geo);

export default app;
