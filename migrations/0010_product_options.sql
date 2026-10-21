-- Product options, per-variant pricing/availability, and color-linked images.
--
-- The catalog already had `product_variants(color_name, color_hex, size)` and
-- `product_images(color_name)`. Those columns stay in place (checkout, order
-- snapshots and the admin UI depend on them), and the new option model is
-- layered on top:
--
--   product_options       one row per option (Color, Size, custom)
--   product_option_values one row per value (Black, M, ...)
--   product_variants      sellable combinations; option_value_ids is a JSON
--                         array of product_option_values.id values
--   product_images        optionally linked to one option value (a color)
--
-- Money remains integer cents. `price_cents` NULL falls back to the product's
-- base price. The backfill below creates Color/Size options for every existing
-- product and links the current variants/images to them.

PRAGMA foreign_keys = ON;

-- ============================================================
-- OPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS product_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('color','size','other')),
  position INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_options_name
  ON product_options(product_id, name);

CREATE TABLE IF NOT EXISTS product_option_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  option_id INTEGER NOT NULL,
  value TEXT NOT NULL,
  swatch_hex TEXT,
  swatch_image_url TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (option_id) REFERENCES product_options(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_option_values_value
  ON product_option_values(option_id, value);

-- ============================================================
-- VARIANTS / IMAGES (additive columns)
-- ============================================================
ALTER TABLE product_variants ADD COLUMN option_value_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE product_variants ADD COLUMN price_cents INTEGER;
ALTER TABLE product_variants ADD COLUMN compare_at_price_cents INTEGER;
ALTER TABLE product_variants ADD COLUMN track_stock INTEGER NOT NULL DEFAULT 1;
ALTER TABLE product_variants ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE product_variants ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

ALTER TABLE product_images ADD COLUMN option_value_id INTEGER;
ALTER TABLE product_images ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_images ADD COLUMN alt TEXT;

CREATE INDEX IF NOT EXISTS idx_variants_option_values ON product_variants(product_id, is_active);
CREATE INDEX IF NOT EXISTS idx_images_option_value ON product_images(product_id, option_value_id);

-- ============================================================
-- ORDER SNAPSHOTS (variant data must never change past orders)
-- ============================================================
ALTER TABLE order_items ADD COLUMN sku TEXT;
ALTER TABLE order_items ADD COLUMN options_json TEXT;
ALTER TABLE order_items ADD COLUMN image_url TEXT;

-- ============================================================
-- BACKFILL EXISTING PRODUCTS
-- ============================================================
-- One Color option and one Size option per product that already has variants.
INSERT OR IGNORE INTO product_options (product_id, name, type, position)
SELECT DISTINCT product_id, 'Color', 'color', 0 FROM product_variants;

INSERT OR IGNORE INTO product_options (product_id, name, type, position)
SELECT DISTINCT product_id, 'Size', 'size', 1 FROM product_variants;

INSERT OR IGNORE INTO product_option_values (option_id, value, swatch_hex, position)
SELECT po.id, v.color_name, MIN(v.color_hex), 0
  FROM product_options po
  JOIN product_variants v ON v.product_id = po.product_id
 WHERE po.name = 'Color' AND po.type = 'color'
 GROUP BY po.id, v.color_name;

INSERT OR IGNORE INTO product_option_values (option_id, value, position)
SELECT po.id, v.size, 0
  FROM product_options po
  JOIN product_variants v ON v.product_id = po.product_id
 WHERE po.name = 'Size' AND po.type = 'size'
 GROUP BY po.id, v.size;

-- Link every existing variant to its Color + Size values. json_array keeps a
-- stable order (Color first, Size second).
UPDATE product_variants
   SET option_value_ids = json_array(
     (SELECT pov.id
        FROM product_options po
        JOIN product_option_values pov ON pov.option_id = po.id
       WHERE po.product_id = product_variants.product_id
         AND po.name = 'Color' AND pov.value = product_variants.color_name),
     (SELECT pov.id
        FROM product_options po
        JOIN product_option_values pov ON pov.option_id = po.id
       WHERE po.product_id = product_variants.product_id
         AND po.name = 'Size' AND pov.value = product_variants.size)
   )
 WHERE option_value_ids = '[]';

-- Existing images already name a color; link them to that color value.
UPDATE product_images
   SET option_value_id = (
     SELECT pov.id
       FROM product_options po
       JOIN product_option_values pov ON pov.option_id = po.id
      WHERE po.product_id = product_images.product_id
        AND po.name = 'Color' AND pov.value = product_images.color_name
      LIMIT 1
   )
 WHERE option_value_id IS NULL AND color_name IS NOT NULL;

-- First image per (product, color) is primary. General images keep a primary
-- too so products with no color-specific images still have a main image.
UPDATE product_images
   SET is_primary = 1
 WHERE id IN (
   SELECT MIN(id)
     FROM product_images
    GROUP BY product_id, COALESCE(option_value_id, -1)
 );

-- ============================================================
-- HELPERS FOR PRODUCTS WITHOUT VARIANTS
-- ============================================================
-- Published products are required to have variants, but older drafts might
-- not. Give them a single "One size" variant so checkout and the storefront
-- keep working if they are published later. Insert only when none exist.
INSERT INTO product_variants
  (product_id, color_name, color_hex, size, sku, stock, option_value_ids,
   price_cents, compare_at_price_cents, track_stock, is_active, position)
SELECT p.id, 'Default', '#000000', 'One size', NULL, 0, '[]',
       NULL, NULL, 1, 1, 0
  FROM products p
 WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);

INSERT OR IGNORE INTO product_options (product_id, name, type, position)
SELECT DISTINCT product_id, 'Color', 'color', 0 FROM product_variants;

INSERT OR IGNORE INTO product_options (product_id, name, type, position)
SELECT DISTINCT product_id, 'Size', 'size', 1 FROM product_variants;

INSERT OR IGNORE INTO product_option_values (option_id, value, swatch_hex, position)
SELECT po.id, v.color_name, MIN(v.color_hex), 0
  FROM product_options po
  JOIN product_variants v ON v.product_id = po.product_id
 WHERE po.name = 'Color' AND po.type = 'color'
 GROUP BY po.id, v.color_name;

INSERT OR IGNORE INTO product_option_values (option_id, value, position)
SELECT po.id, v.size, 0
  FROM product_options po
  JOIN product_variants v ON v.product_id = po.product_id
 WHERE po.name = 'Size' AND po.type = 'size'
 GROUP BY po.id, v.size;

UPDATE product_variants
   SET option_value_ids = json_array(
     (SELECT pov.id
        FROM product_options po
        JOIN product_option_values pov ON pov.option_id = po.id
       WHERE po.product_id = product_variants.product_id
         AND po.name = 'Color' AND pov.value = product_variants.color_name),
     (SELECT pov.id
        FROM product_options po
        JOIN product_option_values pov ON pov.option_id = po.id
       WHERE po.product_id = product_variants.product_id
         AND po.name = 'Size' AND pov.value = product_variants.size)
   )
 WHERE option_value_ids = '[]';
