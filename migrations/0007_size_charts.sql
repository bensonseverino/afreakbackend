-- Size charts for products.
--
-- A chart is a reusable measurement table: one row per size, one column per
-- measurement, unit inches (garment-side, measured flat). Values are stored as
-- strings so ranges such as "25-28" survive untouched.
--
-- Products reference a chart via `products.size_chart_id`, so the admin picks
-- one (or none) when uploading a product. Charts live independently of
-- products, so one chart can size many products and vice-versa.

PRAGMA foreign_keys = ON;

CREATE TABLE size_charts (
  id TEXT PRIMARY KEY,                          -- e.g. size-chart-tshirts
  title TEXT NOT NULL,                          -- "Standard T-Shirts"
  unit TEXT NOT NULL DEFAULT 'inches',
  applies_to TEXT NOT NULL DEFAULT '[]',        -- JSON array of category slugs (advisory only)
  sizes TEXT NOT NULL DEFAULT '[]',             -- JSON array of size labels in display order
  measurements TEXT NOT NULL DEFAULT '{}',      -- JSON: { "Chest": ["32","34",...], ... }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_size_charts_title ON size_charts(title);

-- Products: optional link to a size chart.
ALTER TABLE products ADD COLUMN size_chart_id TEXT;
CREATE INDEX idx_products_size_chart ON products(size_chart_id);
