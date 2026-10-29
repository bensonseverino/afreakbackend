/**
 * Idempotent denormalisation pass for product cards.
 *
 * `products.price_from_cents/price_to_cents` and the rating columns are read by
 * every card, list filter and sort, so they must be derivable from the rows they
 * summarise. Run after a migration, or from Admin → Diagnostics.
 */
import type { Env } from "../env";
import { run } from "./db";

const RANGE_SQL = `
  UPDATE products SET
    price_from_cents = COALESCE(
      (SELECT MIN(COALESCE(v.price_cents, products.price_cents))
         FROM product_variants v
        WHERE v.product_id = products.id AND v.is_active = 1),
      price_cents
    ),
    price_to_cents = COALESCE(
      (SELECT MAX(COALESCE(v.price_cents, products.price_cents))
         FROM product_variants v
        WHERE v.product_id = products.id AND v.is_active = 1),
      price_cents
    )
`;

const RATING_SQL = `
  UPDATE products SET
    rating_avg = COALESCE(
      (SELECT ROUND(AVG(r.rating), 2) FROM reviews r
        WHERE r.product_id = products.id AND r.status = 'approved'),
      0
    ),
    review_count = (
      SELECT COUNT(*) FROM reviews r
       WHERE r.product_id = products.id AND r.status = 'approved'
    )
`;

export async function recalcProductDenorm(env: Env, productId?: number): Promise<void> {
  if (productId != null) {
    await run(env.DB, `${RANGE_SQL} WHERE id = ?`, [productId]);
    await run(env.DB, `${RATING_SQL} WHERE id = ?`, [productId]);
    return;
  }
  await run(env.DB, RANGE_SQL);
  await run(env.DB, RATING_SQL);
}
