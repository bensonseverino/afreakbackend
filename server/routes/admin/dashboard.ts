import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { all, first } from "../../lib/db";
import { ok } from "../../lib/http";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const RANGES: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

function dayList(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** GET /admin/dashboard?range=7d|30d|90d */
app.get("/", async (c) => {
  setNoStore(c);
  const range = c.req.query("range") ?? "30d";
  const days = RANGES[range] ?? 30;
  const since = `-${days} days`;
  const db = c.env.DB;

  const [
    revenueRow,
    messagesRow,
    pendingReviews,
    subscribersRow,
    viewsRow,
    addToCartRow,
    checkoutRow,
    orderSeries,
    metricSeries,
    topByViews,
    topByUnits,
    lowStock,
    recentReviews,
    recentMessages,
    awaiting,
  ] = await Promise.all([
    first<{ revenue: number; orders: number }>(
      db,
      `SELECT COALESCE(SUM(total_cents), 0) AS revenue, COUNT(*) AS orders
         FROM orders WHERE created_at >= datetime('now', ?) AND status NOT IN ('cancelled','refunded')`,
      [since],
    ),
    first<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM submissions WHERE created_at >= datetime('now', ?)`,
      [since],
    ),
    first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'`),
    first<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM subscribers WHERE created_at >= datetime('now', ?)`,
      [since],
    ),
    first<{ n: number }>(
      db,
      `SELECT COALESCE(SUM(count), 0) AS n FROM metrics_daily WHERE type = 'product_view' AND day >= date('now', ?)`,
      [since],
    ),
    first<{ n: number }>(
      db,
      `SELECT COALESCE(SUM(count), 0) AS n FROM metrics_daily WHERE type = 'add_to_cart' AND day >= date('now', ?)`,
      [since],
    ),
    first<{ n: number }>(
      db,
      `SELECT COALESCE(SUM(count), 0) AS n FROM metrics_daily WHERE type = 'checkout_start' AND day >= date('now', ?)`,
      [since],
    ),
    all<{ day: string; orders: number; revenue: number }>(
      db,
      `SELECT date(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS revenue
         FROM orders WHERE created_at >= datetime('now', ?) GROUP BY day`,
      [since],
    ),
    all<{ day: string; type: string; n: number }>(
      db,
      `SELECT day, type, SUM(count) AS n FROM metrics_daily
        WHERE day >= date('now', ?) GROUP BY day, type`,
      [since],
    ),
    all<{ product_id: number; name: string; n: number }>(
      db,
      `SELECT m.product_id, COALESCE(p.name, '—') AS name, SUM(m.count) AS n
         FROM metrics_daily m LEFT JOIN products p ON p.id = m.product_id
        WHERE m.type = 'product_view' AND m.day >= date('now', ?) AND m.product_id > 0
        GROUP BY m.product_id ORDER BY n DESC LIMIT 5`,
      [since],
    ),
    all<{ product_id: number; name: string; units: number }>(
      db,
      `SELECT oi.product_id, oi.name, SUM(oi.qty) AS units
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= datetime('now', ?) AND o.status NOT IN ('cancelled','refunded')
        GROUP BY oi.product_id ORDER BY units DESC LIMIT 5`,
      [since],
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT v.id, v.stock, v.size, v.color_name, p.name AS product_name, p.slug AS product_slug, p.id AS product_id
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.stock <= 3 ORDER BY v.stock, p.name LIMIT 5`,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT r.id, r.author_name, r.rating, r.created_at, p.name AS product_name
         FROM reviews r JOIN products p ON p.id = r.product_id
        WHERE r.status = 'pending' ORDER BY r.created_at DESC LIMIT 5`,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT id, type, name, email, created_at FROM submissions
        WHERE status = 'new' ORDER BY created_at DESC LIMIT 5`,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT id, number, email, total_cents, status, created_at FROM orders
        WHERE status IN ('pending','paid','in_production') ORDER BY created_at DESC LIMIT 5`,
    ),
  ]);

  const revenue = Number(revenueRow?.revenue ?? 0);
  const orders = Number(revenueRow?.orders ?? 0);
  const views = Number(viewsRow?.n ?? 0);

  const series = dayList(days).map((day) => {
    const o = orderSeries.find((r) => r.day === day);
    const m = metricSeries.filter((r) => r.day === day);
    const metric = (type: string) => Number(m.find((r) => r.type === type)?.n ?? 0);
    return {
      day,
      revenue: Number(o?.revenue ?? 0),
      orders: Number(o?.orders ?? 0),
      views: metric("product_view"),
      addToCart: metric("add_to_cart"),
      checkoutStart: metric("checkout_start"),
    };
  });

  return ok(c, {
    range,
    days,
    stats: {
      revenueCents: revenue,
      orders,
      averageOrderCents: orders > 0 ? Math.round(revenue / orders) : 0,
      newMessages: Number(messagesRow?.n ?? 0),
      pendingReviews: Number(pendingReviews?.n ?? 0),
      newSubscribers: Number(subscribersRow?.n ?? 0),
      productViews: views,
      conversion: views > 0 ? orders / views : 0,
    },
    series,
    topByViews: topByViews.map((r) => ({ productId: r.product_id, name: r.name, views: Number(r.n) })),
    topByUnits: topByUnits.map((r) => ({ productId: r.product_id, name: r.name, units: Number(r.units) })),
    funnel: {
      productViews: views,
      addToCart: Number(addToCartRow?.n ?? 0),
      checkoutStart: Number(checkoutRow?.n ?? 0),
      orders,
    },
    needsAttention: {
      lowStock: lowStock.map((r) => ({
        variantId: r.id,
        stock: r.stock,
        size: r.size,
        colorName: r.color_name,
        productId: r.product_id,
        productName: r.product_name,
        productSlug: r.product_slug,
      })),
      pendingReviews: recentReviews.map((r) => ({
        id: r.id,
        author: r.author_name,
        rating: r.rating,
        productName: r.product_name,
        createdAt: r.created_at,
      })),
      newMessages: recentMessages.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        email: r.email,
        createdAt: r.created_at,
      })),
      awaitingFulfillment: awaiting.map((r) => ({
        id: r.id,
        number: r.number,
        email: r.email,
        totalCents: r.total_cents,
        status: r.status,
        createdAt: r.created_at,
      })),
    },
  });
});

export default app;
