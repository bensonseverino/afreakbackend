-- AFREAK customers
-- Identity lives in Clerk (the storefront never mints credentials). Rows here
-- are created and kept in sync by the Clerk webhook in
-- `server/routes/webhooks/clerk.ts`, so `id` is the Clerk user id (`user_…`).
PRAGMA foreign_keys = ON;

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE customers (
  id TEXT PRIMARY KEY,                          -- Clerk user id
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,                                   -- E.164, from Clerk's primary phone
  image_url TEXT,
  marketing_opt_in INTEGER,                     -- newsletter consent (Clerk public metadata)
  sms_opt_in INTEGER,                           -- SMS consent (Clerk public metadata)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  last_sign_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),   -- Clerk's created_at
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_created ON customers(created_at DESC);
CREATE INDEX idx_customers_status ON customers(status, created_at DESC);

-- ============================================================
-- WEBHOOK LEDGER
-- Svix retries a delivery until it is acknowledged, so every handled message
-- id is recorded to keep processing idempotent.
-- ============================================================
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,                          -- svix-id of the delivery
  provider TEXT NOT NULL DEFAULT 'clerk',
  type TEXT NOT NULL,
  subject_id TEXT,                              -- the Clerk user the event describes
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_webhook_events_received ON webhook_events(received_at DESC);
