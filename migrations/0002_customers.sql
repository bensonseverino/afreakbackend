-- AFREAK customers
-- The base customer table. Later migrations rebuild this table as the account
-- system grows: see `0005_customer_accounts.sql`, which replaces this shape with
-- the password-backed account model.
PRAGMA foreign_keys = ON;

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  image_url TEXT,
  marketing_opt_in INTEGER,
  sms_opt_in INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  last_sign_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_created ON customers(created_at DESC);
CREATE INDEX idx_customers_status ON customers(status, created_at DESC);

-- ============================================================
-- INBOUND WEBHOOK LEDGER
-- A generic ledger of inbound provider deliveries, keyed by the provider's own
-- message id so retries stay idempotent. Dropped again in
-- `0005_customer_accounts.sql`: the account system signs its own users in and no
-- longer receives a delivery per user change.
-- ============================================================
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,                          -- provider message id
  provider TEXT,
  type TEXT NOT NULL,
  subject_id TEXT,                              -- the subject the event describes
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_webhook_events_received ON webhook_events(received_at DESC);
