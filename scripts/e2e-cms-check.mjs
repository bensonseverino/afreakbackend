#!/usr/bin/env node
/**
 * scripts/e2e-cms-check.mjs — CMS ↔ storefront end-to-end check (spec §10).
 *
 * For every module it creates (or modifies) a record with a unique `E2E-`
 * marker, asserts the marker appears on the *public* endpoint the storefront
 * reads (cache-busted, polled for up to 5 s), then removes the test data —
 * including when a check fails.
 *
 * Usage:
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… SITE_URL=http://localhost:8788 npm run check:cms
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… SITE_URL=https://afreakcms.pages.dev npm run check:cms -- --confirm
 *
 * Running against a non-local origin requires `--confirm`; test records are
 * always marked `E2E-…` and cleaned up in a `finally`.
 */

const SITE = (process.env.SITE_URL || "http://localhost:8788").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MARKER = `E2E-${Date.now().toString(36).toUpperCase()}`;
const CONFIRMED = process.argv.includes("--confirm");
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/.test(SITE);

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (e.g. owner@afreak.com / afreak-dev-admin-1).");
  process.exit(2);
}
if (!IS_LOCAL && !CONFIRMED) {
  console.error(
    `Refusing to write test records to ${SITE} without --confirm.\n` +
      "Re-run with: npm run check:cms -- --confirm",
  );
  process.exit(2);
}

/* ------------------------------------------------------------------ http */

let cookie = "";

async function request(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${SITE}/api${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    redirect: "manual",
  });

  for (const value of res.headers.getSetCookie?.() ?? []) {
    const pair = value.split(";")[0];
    if (pair?.includes("=")) cookie = pair;
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} → ${res.status} ${json?.error?.code ?? ""} ${json?.error?.message ?? ""}`.trim(),
    );
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Public read with a cache-busting query — what the storefront's browser sees. */
async function publicData(path) {
  const url = `${SITE}/api${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json())?.data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(fetchValue, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fetchValue();
      if (predicate(last)) return true;
    } catch {
      /* retry until the deadline */
    }
    await sleep(250);
  }
  return false;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function safe(promise) {
  try {
    await promise;
  } catch {
    /* cleanup must never mask the real failure */
  }
}

/* --------------------------------------------------------------- helpers */

// 1×1 PNG — enough for the upload magic-byte sniffing.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

async function uploadTestMedia(prefix = "products") {
  const form = new FormData();
  form.append("prefix", prefix);
  form.append("meta", JSON.stringify([{ width: 1, height: 1, alt: `${MARKER} test image` }]));
  form.append("file", new Blob([PNG_1X1], { type: "image/png" }), `${MARKER}.png`);
  const res = await request("/admin/media", { method: "POST", form });
  return res.data?.[0]?.id ?? null;
}

/* --------------------------------------------------------------- modules */

const results = [];

async function checkModule(name, run) {
  const started = Date.now();
  try {
    await run();
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: err.message });
  }
}

async function checkHero() {
  await checkModule("hero slides", async () => {
    let id = null;
    try {
      const created = await request("/admin/content/hero", {
        method: "POST",
        body: { eyebrow: MARKER, title: `${MARKER} hero`, subtitle: "e2e", active: true },
      });
      id = created?.data?.id;
      assert(id, "hero slide was not created");

      const visible = await eventually(
        () => publicData("/home"),
        (data) => (data?.heroSlides ?? []).some((slide) => slide.id === id),
      );
      assert(visible, "new hero slide never appeared in /api/home within 5 s");

      await request(`/admin/content/hero/${id}`, {
        method: "PUT",
        body: { title: `${MARKER} hero`, active: false },
      });
      const hidden = await eventually(
        () => publicData("/home"),
        (data) => !(data?.heroSlides ?? []).some((slide) => slide.id === id),
      );
      assert(hidden, "HIDDEN hero slide is still served by /api/home");
    } finally {
      if (id) await safe(request(`/admin/content/hero/${id}`, { method: "DELETE" }));
    }
  });
}

async function checkLookbook() {
  await checkModule("lookbook", async () => {
    let mediaId = null;
    let itemId = null;
    try {
      mediaId = await uploadTestMedia("lookbook");
      assert(mediaId, "test media upload failed");

      const created = await request("/admin/content/lookbook", {
        method: "POST",
        body: { mediaId, caption: MARKER, linkUrl: "/lookbook", active: true },
      });
      itemId = created?.data?.id;
      assert(itemId, "lookbook item was not created");

      const onHome = await eventually(
        () => publicData("/home"),
        (data) => (data?.lookbook ?? []).some((item) => item.id === itemId),
      );
      assert(onHome, "new lookbook item never appeared in /api/home within 5 s");

      const onPage = await eventually(
        () => publicData("/lookbook"),
        (data) => (Array.isArray(data) ? data : []).some((item) => item.id === itemId),
      );
      assert(onPage, "new lookbook item never appeared in /api/lookbook within 5 s");
    } finally {
      if (itemId) await safe(request(`/admin/content/lookbook/${itemId}`, { method: "DELETE" }));
      if (mediaId) await safe(request(`/admin/media/${mediaId}`, { method: "DELETE" }));
    }
  });
}

async function checkSetting(name, key, patch, readBack) {
  await checkModule(name, async () => {
    const original = (await request(`/admin/settings/${key}`))?.data ?? null;
    try {
      await request(`/admin/settings/${key}`, {
        method: "PUT",
        body: { value: { ...(original ?? {}), ...patch } },
      });
      const visible = await eventually(
        () => publicData("/home"),
        (data) => readBack(data) === MARKER,
      );
      assert(visible, `${name} change never reached /api/home within 5 s`);
    } finally {
      if (original !== null) {
        await safe(
          request(`/admin/settings/${key}`, { method: "PUT", body: { value: original } }),
        );
      }
    }
  });
}

async function checkCategory() {
  await checkModule("categories", async () => {
    let id = null;
    try {
      const created = await request("/admin/categories", {
        method: "POST",
        body: { name: `${MARKER} category` },
      });
      id = created?.data?.id;
      assert(id, "category was not created");

      const visible = await eventually(
        () => publicData("/categories"),
        (data) => (Array.isArray(data) ? data : []).some((category) => category.name === `${MARKER} category`),
      );
      assert(visible, "new category never appeared in /api/categories within 5 s");
    } finally {
      if (id) await safe(request(`/admin/categories/${id}`, { method: "DELETE" }));
    }
  });
}

async function checkProduct() {
  await checkModule("product + image + variant", async () => {
    let mediaId = null;
    let productId = null;
    try {
      mediaId = await uploadTestMedia("products");
      assert(mediaId, "test media upload failed");

      const created = await request("/admin/products", {
        method: "POST",
        body: {
          name: `${MARKER} tee`,
          price_cents: 4200,
          status: "published",
          images: [{ mediaId, isPrimary: true, alt: MARKER }],
          variants: [{ colorName: "Black", colorHex: "#000000", size: "M", stock: 3 }],
        },
      });
      productId = created?.data?.id;
      assert(productId, "product was not created");

      const visible = await eventually(
        () => publicData(`/products?q=${encodeURIComponent(MARKER)}`),
        (data) => (Array.isArray(data) ? data : []).some((product) => product.name === `${MARKER} tee`),
      );
      assert(visible, "published product never appeared in /api/products within 5 s");

      const detail = await publicData(`/products/${created.data.slug ?? ""}`);
      assert(detail?.images?.length > 0, "product detail carries no image");
      assert(detail?.variants?.length > 0, "product detail carries no variants");
    } finally {
      if (productId) await safe(request(`/admin/products/${productId}`, { method: "DELETE" }));
      if (mediaId) await safe(request(`/admin/media/${mediaId}`, { method: "DELETE" }));
    }
  });
}

async function checkReview() {
  await checkModule("review moderation", async () => {
    let reviewId = null;
    try {
      const list = await publicData("/products?limit=1");
      const slug = (Array.isArray(list) ? list : [])[0]?.slug;
      assert(slug, "no published product to attach a review to");

      await request(`/products/${slug}/reviews`, {
        method: "POST",
        body: {
          name: `${MARKER} reviewer`,
          email: `e2e+${MARKER.toLowerCase()}@example.com`,
          rating: 5,
          body: `${MARKER} — automated check`,
        },
      });

      const pending = await request("/admin/reviews?status=pending&limit=50");
      const match = (pending?.data ?? []).find((review) => review.body?.includes(MARKER));
      assert(match, "submitted review did not land in the admin pending queue");
      reviewId = match.id;

      await request(`/admin/reviews/${reviewId}`, {
        method: "PATCH",
        body: { status: "approved" },
      });

      const visible = await eventually(
        () => publicData(`/products/${slug}/reviews`),
        (data) => {
          const reviews = Array.isArray(data) ? data : (data?.reviews ?? []);
          return reviews.some((review) => String(review.body ?? "").includes(MARKER));
        },
      );
      assert(visible, "approved review never appeared on the public product reviews");
    } finally {
      if (reviewId) await safe(request(`/admin/reviews/${reviewId}`, { method: "DELETE" }));
    }
  });
}

async function checkPromoCode() {
  await checkModule("promo codes", async () => {
    const code = `${MARKER.replace(/[^A-Z0-9]/g, "")}P`.slice(0, 40);
    try {
      await request("/admin/promos", {
        method: "POST",
        body: { code, type: "percent", value: 10, minSubtotalCents: 0, active: true },
      });

      const valid = await eventually(
        () => request("/promo/validate", { method: "POST", body: { code, subtotalCents: 5000 } }).then((r) => r.data),
        (data) => data?.valid === true,
      );
      assert(valid, "new promo code never became valid via /api/promo/validate");
    } finally {
      await safe(request(`/admin/promos/${code}`, { method: "DELETE" }));
    }
  });
}

/* ------------------------------------------------------------------ main */

async function main() {
  console.log(`\nAFREAK CMS ↔ storefront check`);
  console.log(`  site   : ${SITE}`);
  console.log(`  marker : ${MARKER}${IS_LOCAL ? "" : "  (non-local — --confirm accepted)"}\n`);

  await request("/admin/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });

  const health = await request("/health").then((r) => r.data).catch(() => null);
  if (health) {
    console.log(
      `  env ${health.env} · build ${health.buildId ?? "local"} · db ${health.dbId} · content v${health.contentVersion}\n`,
    );
  }

  await checkHero();
  await checkLookbook();
  await checkSetting("promo bar", "promo_bar", { text: MARKER, active: true }, (data) => data?.promoBar?.text);
  await checkSetting(
    "shipping banner",
    "shipping_banner",
    { title: MARKER },
    (data) => data?.shippingBanner?.title,
  );
  await checkCategory();
  await checkProduct();
  await checkReview();
  await checkPromoCode();

  const width = Math.max(...results.map((r) => r.name.length), 10);
  console.log("");
  for (const result of results) {
    const status = result.ok ? "✓" : "✗";
    const suffix = result.ok ? `${result.ms} ms` : result.error;
    console.log(`  ${status} ${result.name.padEnd(width)}  ${suffix}`);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n  ${results.length - failed.length}/${results.length} modules connected` +
      `${failed.length ? ` — ${failed.length} failed` : ""}\n`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`\ne2e check aborted: ${err.message}\n`);
  process.exit(1);
});
