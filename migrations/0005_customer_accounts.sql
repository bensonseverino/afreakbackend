-- AFREAK customer accounts: own password auth + admin approval workflow.
--
-- Replaces the earlier external-identity design. `customers` is rebuilt with
-- password credentials, the pending/active/rejected/suspended/deleted workflow
-- and the audit trail the CMS needs, and `id` becomes a plain uuid again.
--
-- Existing rows survive as migrated accounts: they keep their contact details
-- and order history but have no password until an admin resets one, or the
-- customer uses "Forgot password".
--
-- Run after `0002_customers.sql` (the only other customer migration here).

PRAGMA defer_foreign_keys = true;

-- ============================================================
-- 1) CUSTOMERS
-- ============================================================
CREATE TABLE customers_new (
  id TEXT PRIMARY KEY,                               -- uuid, FK target everywhere
  email TEXT UNIQUE,                                 -- lowercased, nullable
  phone_e164 TEXT UNIQUE,                            -- E.164, nullable
  first_name TEXT, last_name TEXT,
  password_hash TEXT, password_salt TEXT,            -- PBKDF2; NULL = cannot sign in yet
  must_change_password INTEGER NOT NULL DEFAULT 0,
  password_changed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','rejected','suspended','deleted')),
  signup_source TEXT NOT NULL DEFAULT 'self' CHECK (signup_source IN ('self','admin','migrated')),
  approved_at TEXT, approved_by TEXT,                -- admins.id
  rejected_reason TEXT,
  admin_notes TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  provider_customer_id TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

INSERT INTO customers_new
  (id, email, phone_e164, first_name, last_name, marketing_opt_in, status,
   signup_source, created_at, last_login_at)
SELECT
   id,
   lower(email),
   phone,
   first_name,
   last_name,
   COALESCE(marketing_opt_in, 0),
   CASE status
     WHEN 'disabled' THEN 'suspended'
     WHEN 'deleted'  THEN 'deleted'
     ELSE 'active'
   END,
   'migrated',
   created_at,
   last_sign_in_at
FROM customers;

DROP TABLE customers;
ALTER TABLE customers_new RENAME TO customers;
CREATE INDEX idx_customers_status ON customers(status, created_at);

-- ============================================================
-- 2) CUSTOMER SESSIONS
-- The cookie carries a random id; only its SHA-256 hash is stored, so a leak of
-- this table cannot be replayed as a session.
-- ============================================================
DROP TABLE IF EXISTS customer_sessions;
CREATE TABLE customer_sessions (
  id_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_cust_sessions ON customer_sessions(customer_id);

-- ============================================================
-- 3) RATE LIMITS
-- D1-backed fixed windows, keyed by a hash so identifiers are never stored.
-- ============================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- ============================================================
-- 4) PASSWORD-RESET REQUESTS
-- "Forgot password" cannot email a link yet, so it raises a request an admin
-- works through in the CMS.
-- ============================================================
CREATE TABLE password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX idx_pw_requests ON password_reset_requests(status, created_at);

-- ============================================================
-- 5) AUDIT LOG
-- Every admin action on an account. No FK: the log outlives the row it
-- describes (a delete anonymises the customer but keeps this history).
-- ============================================================
CREATE TABLE customer_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  admin_id TEXT,
  action TEXT NOT NULL,   -- signup|create|approve|reject|suspend|unsuspend|reset_password|edit|delete|link_orders
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_customer ON customer_audit_log(customer_id, created_at);

-- ============================================================
-- 6) ORDERS: name the customer
-- `phone_e164` is deliberately separate from `orders.phone`: the latter is what
-- the customer typed at checkout (free text), while this is the normalised form
-- we are willing to match on.
-- ============================================================
ALTER TABLE orders ADD COLUMN customer_id TEXT;
ALTER TABLE orders ADD COLUMN phone_e164 TEXT;
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_phone_e164 ON orders(phone_e164);

-- ============================================================
-- 7) Remove leftovers from earlier designs
-- ============================================================
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS otp_codes;
