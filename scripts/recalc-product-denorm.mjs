#!/usr/bin/env node
/**
 * Rebuild denormalised product data (price ranges + rating counts).
 *
 *   node scripts/recalc-product-denorm.mjs            # local D1
 *   node scripts/recalc-product-denorm.mjs --remote   # production D1
 *
 * Idempotent. The same pass is available as Admin → Diagnostics → RECALC PRICES.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const remote = process.argv.includes("--remote");
const dir = mkdtempSync(join(tmpdir(), "afreak-recalc-"));
const file = join(dir, "recalc.sql");

const SQL = `
UPDATE products SET
  price_from_cents = COALESCE(
    (SELECT MIN(COALESCE(v.price_cents, products.price_cents))
       FROM product_variants v
      WHERE v.product_id = products.id AND v.is_active = 1),
    price_cents),
  price_to_cents = COALESCE(
    (SELECT MAX(COALESCE(v.price_cents, products.price_cents))
       FROM product_variants v
      WHERE v.product_id = products.id AND v.is_active = 1),
    price_cents);
UPDATE products SET
  rating_avg = COALESCE(
    (SELECT ROUND(AVG(r.rating), 2) FROM reviews r
      WHERE r.product_id = products.id AND r.status = 'approved'), 0),
  review_count = (
    SELECT COUNT(*) FROM reviews r
     WHERE r.product_id = products.id AND r.status = 'approved');
SELECT COUNT(*) AS products FROM products;
`;

try {
  writeFileSync(file, SQL, "utf8");
  execSync(
    `npx wrangler d1 execute afreak-db ${remote ? "--remote" : "--local"} --file "${file}"`,
    { stdio: "inherit" },
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
