-- Print-size products, per-variant prices for print sizes, price ranges and KES.
--
-- The colour model is the existing product_options/product_option_values model
-- introduced in 0010: a "Color" option's values own their images through
-- product_images.option_value_id. This migration adds:
--
--   products.size_type        apparel | print | one_size
--   products.price_from/to    denormalised range for cards, filters and sorting
--   order_items.image_key     snapshot of the image the customer saw
--   settings                  store currency (KES) + size presets/dimensions
--
-- Variant prices already live on product_variants.price_cents (NULL = base
-- price), so print products simply require a price on every variant.

PRAGMA foreign_keys = ON;

-- ============================================================
-- SIZE TYPE + PRICE RANGE
-- ============================================================
ALTER TABLE products ADD COLUMN size_type TEXT NOT NULL DEFAULT 'apparel'
  CHECK (size_type IN ('apparel','print','one_size'));
ALTER TABLE products ADD COLUMN price_from_cents INTEGER;
ALTER TABLE products ADD COLUMN price_to_cents INTEGER;

-- Products that only sell in "One size" clearly are not apparel.
UPDATE products
   SET size_type = 'one_size'
 WHERE id IN (
   SELECT product_id FROM product_variants
    GROUP BY product_id
   HAVING COUNT(DISTINCT size) = 1 AND LOWER(MIN(size)) = 'one size'
 );

-- Fill the range for every existing product. Empty products fall back to the
-- base price; inactive variants are ignored.
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
  );

-- ============================================================
-- ORDER SNAPSHOT
-- ============================================================
ALTER TABLE order_items ADD COLUMN image_key TEXT;

-- ============================================================
-- SETTINGS: CURRENCY, SIZE PRESETS, PRINT DIMENSIONS
-- ============================================================
INSERT INTO settings (key, value_json) VALUES
  ('currency', '{"code":"KES","locale":"en-KE","symbol":"KES"}')
  ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now');

INSERT INTO settings (key, value_json) VALUES
  ('size_presets', '{"apparel":["XS","S","M","L","XL","XXL"],"print":["A4","A3","A2"],"one_size":["One size"]}')
  ON CONFLICT(key) DO NOTHING;

INSERT INTO settings (key, value_json) VALUES
  ('size_meta', '{"A4":{"mm":[210,297],"in":[8.3,11.7]},"A3":{"mm":[297,420],"in":[11.7,16.5]},"A2":{"mm":[420,594],"in":[16.5,23.4]}}')
  ON CONFLICT(key) DO NOTHING;

-- The store object carried an optional currency label; make it explicit.
UPDATE settings
   SET value_json = json_set(value_json, '$.currency', 'KES')
 WHERE key = 'store' AND json_extract(value_json, '$.currency') IS NULL;

-- Shipping placeholders move to KES. Only rows still holding the old EUR
-- defaults are touched so an owner's custom rates survive the migration.
UPDATE settings
   SET value_json = json_set(
         value_json,
         '$.threshold_cents', 1500000,
         '$.flat_cents', 50000,
         '$.express_cents', 150000
       ),
       updated_at = datetime('now')
 WHERE key = 'shipping'
   AND json_extract(value_json, '$.threshold_cents') = 15000
   AND json_extract(value_json, '$.flat_cents') = 600;

-- Storefront copy that hard-coded the old EUR amount.
UPDATE settings
   SET value_json = json_set(value_json, '$.subtitle', 'On all orders over KES 15,000')
 WHERE key = 'shipping_banner'
   AND (json_extract(value_json, '$.subtitle') LIKE '%€150%'
        OR json_extract(value_json, '$.subtitle') LIKE '%EUR150%'
        OR json_extract(value_json, '$.subtitle') LIKE '%EUR 150%');

UPDATE settings
   SET value_json = json_set(value_json, '$.text', 'Free shipping on orders over KES 15,000')
 WHERE key = 'promo_bar'
   AND (json_extract(value_json, '$.text') LIKE '%€150%'
        OR json_extract(value_json, '$.text') LIKE '%EUR150%'
        OR json_extract(value_json, '$.text') LIKE '%EUR 150%');
