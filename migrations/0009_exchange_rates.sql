-- Cached display-exchange rates.
--
-- One row (`id = 1`) holds the latest provider response so the storefront can
-- keep showing converted prices when the upstream provider is unreachable.
-- `rates_json` is a JSON object keyed by ISO currency code, quoted per 1 USD
-- (the provider base), e.g. {"USD":1,"EUR":0.92,"GBP":0.79,"KES":129.4}.
--
-- Prices themselves are always stored in the shop base currency (EUR); these
-- rates are display-only and never used to charge a customer.

CREATE TABLE IF NOT EXISTS exchange_rates (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base TEXT NOT NULL,                           -- provider base, e.g. USD
  rates_json TEXT NOT NULL,                     -- JSON object of quotes
  source TEXT NOT NULL,                         -- provider label for attribution
  updated_at TEXT NOT NULL                      -- ISO-8601 timestamp
);
