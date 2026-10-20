-- Seed size charts imported from the Mambo Beard size-chart export
-- (mambo-beard-size-charts.md, pulled 2026-10-20).
-- Inches, garment-side (measured flat). Ranges are stored as text.
-- Idempotent: re-running refreshes each chart in place.

INSERT INTO size_charts (id, title, unit, applies_to, sizes, measurements)
VALUES ('size-chart-mens-sweatpants', 'Men''s Sweatpants', 'inches', '["mens-sweatpants","mens-joggers"]', '["XS","S","M","L","XL","2XL","3XL"]', '{"Waist":["25-28","28-31","30-33","32-35","34-37","36-39","38-41"],"Hips":[34,37,40,44,47,50,53],"Thigh":[18,20,22,24,28,31,33],"Inseam":[30,31,32,33,34,35,36],"Outseam":[38,39,41,41,42,42,42]}')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  unit = excluded.unit,
  applies_to = excluded.applies_to,
  sizes = excluded.sizes,
  measurements = excluded.measurements,
  updated_at = datetime('now');

INSERT INTO size_charts (id, title, unit, applies_to, sizes, measurements)
VALUES ('size-chart-womens-sweatpants', 'Women''s Sweatpants', 'inches', '["womens-sweatpants","womens-joggers"]', '["XS","S","M","L","XL","2XL","3XL"]', '{"Waist":["25-28","28-31","30-33","32-35","34-37","36-39","38-41"],"Hips":[39,42,46,49,52,56,60],"Thigh":[22,24,26,29,33,37,40],"Inseam":[30,31,32,33,34,35,36],"Outseam":[38,39,40,41,41,42,42]}')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  unit = excluded.unit,
  applies_to = excluded.applies_to,
  sizes = excluded.sizes,
  measurements = excluded.measurements,
  updated_at = datetime('now');

INSERT INTO size_charts (id, title, unit, applies_to, sizes, measurements)
VALUES ('size-chart-tshirts', 'Standard T-Shirts', 'inches', '["t-shirts","graphic-tees","crewneck-tees"]', '["XS","S","M","L","XL","2XL","3XL"]', '{"Length":[26,27,28,29,30,31,32],"Chest":[32,34,36,38,40,42,44],"Across Shoulder":[13,14,15,16,17,18,19],"Short Sleeve Length":[5,6,7,8,9,10,11],"Long Sleeve Length":[20,22,24,27,27,29,30]}')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  unit = excluded.unit,
  applies_to = excluded.applies_to,
  sizes = excluded.sizes,
  measurements = excluded.measurements,
  updated_at = datetime('now');

INSERT INTO size_charts (id, title, unit, applies_to, sizes, measurements)
VALUES ('size-chart-cropped-tshirts', 'Cropped T-Shirts', 'inches', '["cropped-tshirts","crop-tops"]', '["XS","S","M","L","XL","2XL"]', '{"Chest":[34,36,38,40,42,44],"Shoulders":[13,14,15,16,17,18],"Sleeve":[6,7,8,9,10,11],"Length":[15,16,17,18,19,20]}')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  unit = excluded.unit,
  applies_to = excluded.applies_to,
  sizes = excluded.sizes,
  measurements = excluded.measurements,
  updated_at = datetime('now');

INSERT INTO size_charts (id, title, unit, applies_to, sizes, measurements)
VALUES ('size-chart-tshirt-dress', 'T-Shirt Dress', 'inches', '["tshirt-dresses"]', '["XS","S","M","L","XL","2XL","3XL"]', '{"Dress Length":[31,32,33,34,35,36,37],"Chest":[34,36,38,40,42,44,46],"Across Shoulder":[13,14,15,16,17,18,19]}')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  unit = excluded.unit,
  applies_to = excluded.applies_to,
  sizes = excluded.sizes,
  measurements = excluded.measurements,
  updated_at = datetime('now');

INSERT INTO size_charts (id, title, unit, applies_to, sizes, measurements)
VALUES ('size-chart-hoodies', 'Hoodies', 'inches', '["hoodies","pullovers","zip-hoodies"]', '["XS","S","M","L","XL","2XL","3XL"]', '{"Length":[26,27,28,29,30,31,32],"Chest":[36,38,40,44,46,48,50],"Across Shoulder":[16,17,18,19,20,21,22],"Sleeve":[21.5,22.5,24,26,27,28,28]}')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  unit = excluded.unit,
  applies_to = excluded.applies_to,
  sizes = excluded.sizes,
  measurements = excluded.measurements,
  updated_at = datetime('now');

INSERT INTO size_charts (id, title, unit, applies_to, sizes, measurements)
VALUES ('size-chart-college-jackets', 'College Jackets', 'inches', '["college-jackets","varsity-jackets","bomber-jackets"]', '["XS","S","M","L","XL","2XL","3XL"]', '{"Body Length":[26,27,28,29,30,31,32],"Chest":[36,38,40,44,46,48,50],"Across Shoulder":[16,17,18,19,20,21,22],"Sleeve":[21.5,22.5,24,26,27,28,28]}')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  unit = excluded.unit,
  applies_to = excluded.applies_to,
  sizes = excluded.sizes,
  measurements = excluded.measurements,
  updated_at = datetime('now');
