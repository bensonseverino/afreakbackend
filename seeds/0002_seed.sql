-- AFREAK sample data — DEV / STAGING ONLY.
-- For production, delete this file before running `migrations apply`,
-- or keep seeds out of the migrations folder and run them manually.

PRAGMA foreign_keys = ON;

-- Categories ---------------------------------------------------------------
INSERT INTO categories (slug, name, sort) VALUES
  ('hoodies', 'Hoodies', 1),
  ('t-shirts', 'T-Shirts', 2),
  ('pants', 'Pants', 3),
  ('outerwear', 'Outerwear', 4),
  ('accessories', 'Accessories', 5),
  ('prints', 'Prints', 6);

-- Products -----------------------------------------------------------------
INSERT INTO products
  (slug, name, short_description, description, price_cents, old_price_cents, category_id, status,
   is_new, is_featured, customizable, print_addon_cents, features_json, rating_avg, review_count)
VALUES
  ('utility-hoodie', 'Utility Hoodie', 'Technical details meet minimal aesthetics.',
   'Built for the in-between. A heavyweight shell with a relaxed cut, articulated sleeves and a hood that holds its shape.',
   450000, 550000, (SELECT id FROM categories WHERE slug='hoodies'), 'published', 1, 1, 1, 40000,
   '[{"icon":"drop","title":"Water resistant","sub":"Light rain ready"},{"icon":"pocket","title":"Multi pockets","sub":"Everyday storage"},{"icon":"fit","title":"Adjustable fit","sub":"Hem + hood toggles"}]',
   4.8, 1200),
  ('oversized-t-shirt', 'Oversized T-Shirt', 'Technical details meet minimal aesthetics.',
   'A boxy heavyweight tee cut from 240gsm combed cotton. Garment-dyed for depth.',
   220000, NULL, (SELECT id FROM categories WHERE slug='t-shirts'), 'published', 0, 1, 1, 30000,
   '[{"icon":"drop","title":"Heavyweight cotton","sub":"240gsm, garment-dyed"},{"icon":"ruler","title":"Boxy fit","sub":"Dropped shoulders"},{"icon":"refresh","title":"Pre-shrunk","sub":"Keeps its shape"}]',
   4.7, 860),
  ('cargo-pants', 'Cargo Pants', 'Technical details meet minimal aesthetics.',
   'Utility-driven trousers with a considered fit. Reinforced seams and a drawcord hem.',
   400000, NULL, (SELECT id FROM categories WHERE slug='pants'), 'published', 0, 0, 0, 0,
   '[{"icon":"pocket","title":"Deep pockets","sub":"Cargo utility"},{"icon":"fit","title":"Adjustable hem","sub":"Drawcord cuffs"},{"icon":"shield","title":"Reinforced seams","sub":"Built to last"}]',
   4.6, 540),
  ('tech-cap', 'Tech Cap', 'Technical details meet minimal aesthetics.',
   'A small object with a big job. Made from durable materials and finished with AFREAK hardware.',
   150000, NULL, (SELECT id FROM categories WHERE slug='accessories'), 'published', 0, 0, 0, 0,
   '[{"icon":"shield","title":"Durable build","sub":"Everyday hardware"},{"icon":"fit","title":"One size","sub":"Adjustable strap"},{"icon":"refresh","title":"Easy care","sub":"Wipe clean"}]',
   4.5, 320),
  ('tech-cargo-hoodie', 'Tech Cargo Hoodie', 'Technical details meet minimal aesthetics.',
   'Utility reworked into a heavyweight hoodie with oversized cargo pockets.',
   480000, NULL, (SELECT id FROM categories WHERE slug='hoodies'), 'published', 1, 1, 1, 40000,
   '[{"icon":"drop","title":"Water resistant","sub":"Light rain ready"},{"icon":"pocket","title":"Multi pockets","sub":"Everyday storage"},{"icon":"fit","title":"Adjustable fit","sub":"Hem + hood toggles"}]',
   4.9, 210),
  ('bucket-hat', 'Bucket Hat', 'Technical details meet minimal aesthetics.',
   'A small object with a big job. Made from durable materials and finished with AFREAK hardware.',
   120000, NULL, (SELECT id FROM categories WHERE slug='accessories'), 'published', 1, 0, 0, 0,
   '[{"icon":"shield","title":"Durable build","sub":"Everyday hardware"},{"icon":"fit","title":"One size","sub":"Adjustable strap"},{"icon":"refresh","title":"Easy care","sub":"Wipe clean"}]',
   4.4, 180),
  ('shoulder-bag', 'Shoulder Bag', 'Technical details meet minimal aesthetics.',
   'A small object with a big job. Made from durable materials and finished with AFREAK hardware.',
   250000, NULL, (SELECT id FROM categories WHERE slug='accessories'), 'published', 1, 0, 0, 0,
   '[{"icon":"shield","title":"Durable build","sub":"Everyday hardware"},{"icon":"fit","title":"One size","sub":"Adjustable strap"},{"icon":"refresh","title":"Easy care","sub":"Wipe clean"}]',
   4.7, 240),
  ('graphic-tee', 'Graphic Tee', 'Technical details meet minimal aesthetics.',
   'A boxy heavyweight tee cut from 240gsm combed cotton with a printed graphic.',
   200000, 280000, (SELECT id FROM categories WHERE slug='t-shirts'), 'published', 0, 0, 0, 0,
   '[{"icon":"drop","title":"Heavyweight cotton","sub":"240gsm, garment-dyed"},{"icon":"ruler","title":"Boxy fit","sub":"Dropped shoulders"},{"icon":"refresh","title":"Pre-shrunk","sub":"Keeps its shape"}]',
   4.6, 690),
  ('heavyweight-hoodie', 'Heavyweight Hoodie', 'Technical details meet minimal aesthetics.',
   'The heaviest shell in the line. Dense loopback fleece with a structured hood.',
   420000, 520000, (SELECT id FROM categories WHERE slug='hoodies'), 'published', 0, 0, 1, 40000,
   '[{"icon":"drop","title":"Water resistant","sub":"Light rain ready"},{"icon":"pocket","title":"Multi pockets","sub":"Everyday storage"},{"icon":"fit","title":"Adjustable fit","sub":"Hem + hood toggles"}]',
   4.8, 410),
  ('track-pants', 'Track Pants', 'Technical details meet minimal aesthetics.',
   'Utility-driven trousers with a considered fit and a tapered leg.',
   350000, NULL, (SELECT id FROM categories WHERE slug='pants'), 'published', 0, 0, 0, 0,
   '[{"icon":"pocket","title":"Deep pockets","sub":"Cargo utility"},{"icon":"fit","title":"Adjustable hem","sub":"Drawcord cuffs"},{"icon":"shield","title":"Reinforced seams","sub":"Built to last"}]',
   4.5, 300),
  ('puffer-vest', 'Puffer Vest', 'Technical details meet minimal aesthetics.',
   'A technical outer layer that shrugs off wind and light rain.',
   520000, NULL, (SELECT id FROM categories WHERE slug='outerwear'), 'published', 1, 0, 0, 0,
   '[{"icon":"drop","title":"Weatherproof","sub":"Wind + light rain"},{"icon":"shield","title":"Sealed seams","sub":"Fully taped"},{"icon":"refresh","title":"Packable","sub":"Folds into pocket"}]',
   4.8, 130),
  ('windbreaker', 'Windbreaker', 'Technical details meet minimal aesthetics.',
   'Sealed seams and a packable build make it the one you reach for on repeat.',
   600000, 720000, (SELECT id FROM categories WHERE slug='outerwear'), 'published', 0, 0, 0, 0,
   '[{"icon":"drop","title":"Weatherproof","sub":"Wind + light rain"},{"icon":"shield","title":"Sealed seams","sub":"Fully taped"},{"icon":"refresh","title":"Packable","sub":"Folds into pocket"}]',
   4.7, 175),
  -- Print product: no colours, one price per size.
  ('south-sudan-peace-print', 'South Sudan Peace Print', 'Archival print on heavyweight matte paper.',
   'A museum-grade giclée print on 310gsm cotton rag, shipped rolled in a rigid tube.',
   150000, NULL, (SELECT id FROM categories WHERE slug='prints'), 'published', 1, 1, 0, 0,
   '[{"icon":"ruler","title":"Archival paper","sub":"310gsm cotton rag"},{"icon":"shield","title":"Fade resistant","sub":"Giclée pigment inks"},{"icon":"refresh","title":"Ships rolled","sub":"Rigid tube"}]',
   4.9, 64);

-- One-size products.
UPDATE products SET size_type = 'one_size'
 WHERE slug IN ('tech-cap', 'bucket-hat', 'shoulder-bag');
UPDATE products SET size_type = 'print'
 WHERE slug = 'south-sudan-peace-print';

-- Print variants: A4 / A3 / A2 each with its own price.
INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock, price_cents)
SELECT p.id, '', '#000000', s.size,
       'AF-' || p.slug || '-' || lower(s.size), s.stock, s.price
FROM products p
JOIN (
  SELECT 'A4' AS size, 25 AS stock, 150000 AS price UNION ALL
  SELECT 'A3', 15, 250000 UNION ALL
  SELECT 'A2', 8, 450000
) s
WHERE p.slug = 'south-sudan-peace-print';

-- Variants -----------------------------------------------------------------
-- Apparel: Black across XS–XL (stock varies; some sizes out of stock on purpose).
INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Black', '#000000', s.size, 'AF-' || p.slug || '-black-' || lower(s.size), s.stock
FROM products p
JOIN (
  SELECT 'XS' AS size, 4 AS stock UNION ALL SELECT 'S', 10 UNION ALL
  SELECT 'M', 2 UNION ALL SELECT 'L', 0 UNION ALL SELECT 'XL', 7
) s
WHERE p.slug IN ('utility-hoodie', 'tech-cargo-hoodie', 'heavyweight-hoodie');

INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Stone', '#D9D9D6', s.size, 'AF-' || p.slug || '-stone-' || lower(s.size), s.stock
FROM products p
JOIN (
  SELECT 'S' AS size, 6 AS stock UNION ALL SELECT 'M', 9 UNION ALL SELECT 'L', 3 UNION ALL SELECT 'XL', 2
) s
WHERE p.slug IN ('utility-hoodie', 'tech-cargo-hoodie', 'heavyweight-hoodie');

INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Black', '#000000', s.size, 'AF-' || p.slug || '-black-' || lower(s.size), s.stock
FROM products p
JOIN (
  SELECT 'XS' AS size, 8 AS stock UNION ALL SELECT 'S', 14 UNION ALL
  SELECT 'M', 12 UNION ALL SELECT 'L', 6 UNION ALL SELECT 'XL', 4
) s
WHERE p.slug IN ('oversized-t-shirt', 'graphic-tee');

INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Cream', '#F5F5F3', s.size, 'AF-' || p.slug || '-cream-' || lower(s.size), s.stock
FROM products p
JOIN (
  SELECT 'S' AS size, 8 AS stock UNION ALL SELECT 'M', 10 UNION ALL SELECT 'L', 5 UNION ALL SELECT 'XL', 2
) s
WHERE p.slug IN ('oversized-t-shirt', 'graphic-tee');

INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Black', '#000000', s.size, 'AF-' || p.slug || '-black-' || lower(s.size), s.stock
FROM products p
JOIN (
  SELECT 'S' AS size, 9 AS stock UNION ALL SELECT 'M', 11 UNION ALL SELECT 'L', 5 UNION ALL SELECT 'XL', 0
) s
WHERE p.slug IN ('cargo-pants', 'track-pants');

INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Olive', '#6B7B5C', s.size, 'AF-' || p.slug || '-olive-' || lower(s.size), s.stock
FROM products p
JOIN (
  SELECT 'S' AS size, 6 AS stock UNION ALL SELECT 'M', 9 UNION ALL SELECT 'L', 4 UNION ALL SELECT 'XL', 3
) s
WHERE p.slug IN ('cargo-pants', 'puffer-vest');

INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Black', '#000000', s.size, 'AF-' || p.slug || '-black-' || lower(s.size), s.stock
FROM products p
JOIN (
  SELECT 'S' AS size, 5 AS stock UNION ALL SELECT 'M', 8 UNION ALL SELECT 'L', 4 UNION ALL SELECT 'XL', 0
) s
WHERE p.slug = 'puffer-vest';

INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Navy', '#1B2A4A', s.size, 'AF-' || p.slug || '-navy-' || lower(s.size), s.stock
FROM products p
JOIN (
  SELECT 'S' AS size, 6 AS stock UNION ALL SELECT 'M', 9 UNION ALL SELECT 'L', 5 UNION ALL SELECT 'XL', 3
) s
WHERE p.slug = 'windbreaker';

INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Olive', '#6B7B5C', s.size, 'AF-' || p.slug || '-olive-' || lower(s.size), s.stock
FROM products p
JOIN (
  SELECT 'S' AS size, 4 AS stock UNION ALL SELECT 'M', 7 UNION ALL SELECT 'L', 4 UNION ALL SELECT 'XL', 2
) s
WHERE p.slug = 'windbreaker';

-- One-size accessories.
INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Black', '#000000', 'One size', 'AF-' || p.slug || '-black-os', 25
FROM products p WHERE p.slug IN ('tech-cap', 'bucket-hat', 'shoulder-bag');

INSERT INTO product_variants (product_id, color_name, color_hex, size, sku, stock)
SELECT p.id, 'Stone', '#D9D9D6', 'One size', 'AF-' || p.slug || '-stone-os', 18
FROM products p WHERE p.slug IN ('tech-cap', 'bucket-hat', 'shoulder-bag');

-- Relations (pair it with) ------------------------------------------------
INSERT INTO product_relations (product_id, related_id, type, sort)
SELECT p.id, r.id, 'pair', 0
FROM products p JOIN products r ON r.slug = 'cargo-pants'
WHERE p.slug IN ('utility-hoodie', 'oversized-t-shirt');

INSERT INTO product_relations (product_id, related_id, type, sort)
SELECT p.id, r.id, 'accessory', 0
FROM products p JOIN products r ON r.slug = 'tech-cap'
WHERE p.slug IN ('utility-hoodie', 'oversized-t-shirt', 'tech-cargo-hoodie');

-- Homepage content ---------------------------------------------------------
INSERT INTO hero_slides (eyebrow, title, subtitle, cta_label, cta_url, sort, active) VALUES
  ('New season', 'BUILT FOR THE IN-BETWEEN', 'Technical details meet minimal aesthetics.', 'Shop the drop', '/shop', 0, 1),
  ('Outerwear', 'WEATHERPROOF, NOT HEAVY', 'Sealed seams and a packable build.', 'Explore outerwear', '/shop?category=outerwear', 1, 1),
  ('Essentials', 'HEAVYWEIGHT BASICS', 'Cotton that keeps its shape, wash after wash.', 'Shop essentials', '/shop?category=t-shirts', 2, 1);

-- Settings -----------------------------------------------------------------
INSERT INTO settings (key, value_json) VALUES
  ('store', '{"name":"AFREAK","email":"hello@afreak.com","currency":"KES","social":{"instagram":"","tiktok":"","x":"","youtube":""}}'),
  ('promo_bar', '{"text":"Free shipping on orders over KES 15,000","active":true}'),
  ('shipping', '{"threshold_cents":1500000,"flat_cents":50000,"express_cents":150000}'),
  ('shipping_banner', '{"title":"Free shipping","subtitle":"On all orders over KES 15,000","cta_label":"Shop now","cta_url":"/shop"}'),
  ('currency', '{"code":"KES","locale":"en-KE","symbol":"KES"}'),
  ('size_presets', '{"apparel":["XS","S","M","L","XL","XXL"],"print":["A4","A3","A2"],"one_size":["One size"]}'),
  ('size_meta', '{"A4":{"mm":[210,297],"in":[8.3,11.7]},"A3":{"mm":[297,420],"in":[11.7,16.5]},"A2":{"mm":[420,594],"in":[16.5,23.4]}}'),
  ('showcase', '{"product_id":1}'),
  ('footer', '{"blurb":"Technical details meet minimal aesthetics."}'),
  ('demo_payment', '{"enabled":false}')
ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now');

-- Promo --------------------------------------------------------------------
INSERT INTO promo_codes (code, type, value, min_subtotal_cents, active, max_uses, uses)
VALUES ('AFREAK10', 'percent', 10, 0, 1, NULL, 0);

-- Denormalised ranges (cards, filters and sorting read these).
UPDATE products SET
  price_from_cents = COALESCE(
    (SELECT MIN(COALESCE(v.price_cents, products.price_cents))
       FROM product_variants v WHERE v.product_id = products.id AND v.is_active = 1),
    price_cents),
  price_to_cents = COALESCE(
    (SELECT MAX(COALESCE(v.price_cents, products.price_cents))
       FROM product_variants v WHERE v.product_id = products.id AND v.is_active = 1),
    price_cents);
