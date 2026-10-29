import type { Env } from "../env";
import { first, run } from "./db";

/**
 * Live display-exchange rates.
 *
 * The shop stores prices in the store currency (KES by default) and always
 * charges that currency; these rates only decide how prices are *shown* when the
 * shopper picks another currency. Providers quote against USD, so the
 * storefront converts with `rate[target] / rate[base]`.
 *
 * Resolution order (spec §4):
 *   1. Upstream provider (keyed ExchangeRate-API when a key is configured)
 *   2. Free fallback provider (open.er-api.com)
 *   3. Last cached response in D1 (served with `stale: true`)
 *   4. Hardcoded fallback with `null`s — the storefront then keeps showing base prices
 */

export const RATES_BASE = "USD";

export type Rates = Record<string, number | null>;

export type RatesPayload = {
  base: string;
  rates: Rates;
  updatedAt: string | null;
  source: string;
  stale: boolean;
};

/**
 * Last-resort quotes (per 1 USD). Only USD is safe to state without a provider:
 * EUR, GBP and KES stay `null`, which makes the storefront fall back to base
 * prices instead of inventing a conversion.
 */
const FALLBACK_RATES: Rates = { EUR: null, USD: 1, GBP: null, KES: null };

const DEFAULT_TTL_HOURS = 6;
const PROVIDER_TIMEOUT_MS = 8000;

type StoredRates = {
  base: string;
  rates: Rates;
  updatedAt: string;
  source: string;
};

type ProviderResult = {
  rates: Rates;
  source: string;
};

type ExchangeRateRow = {
  base: string;
  rates_json: string;
  source: string;
  updated_at: string;
};

/** Keep every well-formed quote; the storefront decides what it offers. */
function pickRates(raw: unknown): Rates | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const rates: Rates = {};
  for (const [code, value] of Object.entries(source)) {
    const numeric = Number(value);
    if (!/^[A-Z]{3}$/.test(code)) continue;
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    rates[code] = numeric;
  }
  return Object.keys(rates).length > 0 ? rates : null;
}

function ttlHours(env: Env): number {
  const parsed = Number(env.RATES_TTL_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
}

function isFresh(updatedAt: string, hours: number): boolean {
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return false;
  return Date.now() - updated < hours * 60 * 60 * 1000;
}

async function readStored(env: Env): Promise<StoredRates | null> {
  const row = await first<ExchangeRateRow>(
    env.DB,
    "SELECT base, rates_json, source, updated_at FROM exchange_rates WHERE id = 1",
  );
  if (!row) return null;

  try {
    const rates = pickRates(JSON.parse(row.rates_json) as unknown);
    if (!rates) return null;
    return {
      base: row.base,
      rates,
      updatedAt: row.updated_at,
      source: row.source,
    };
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "afreak-storefront/1.0",
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch (err) {
    console.warn(`[rates] provider request failed (${url}):`, err);
    return null;
  }
}

/** Try the keyed provider first, then the free fallback. */
async function fetchFresh(env: Env): Promise<ProviderResult | null> {
  const apiKey = env.EXCHANGE_RATE_API_KEY?.trim();
  if (apiKey) {
    const body = (await fetchJson(
      `https://v6.exchangerate-api.com/v6/${encodeURIComponent(apiKey)}/latest/USD`,
    )) as { result?: string; conversion_rates?: unknown } | null;

    if (body?.result === "success") {
      const rates = pickRates(body.conversion_rates);
      if (rates) return { rates, source: "exchangerate-api" };
    }
  }

  const body = (await fetchJson("https://open.er-api.com/v6/latest/USD")) as {
    result?: string;
    rates?: unknown;
  } | null;

  if (body?.result === "success") {
    const rates = pickRates(body.rates);
    if (rates) return { rates, source: "open-er-api" };
  }

  return null;
}

async function storeRates(env: Env, rates: Rates, source: string): Promise<string> {
  const updatedAt = new Date().toISOString();
  try {
    await run(
      env.DB,
      `INSERT INTO exchange_rates (id, base, rates_json, source, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         base = excluded.base,
         rates_json = excluded.rates_json,
         source = excluded.source,
         updated_at = excluded.updated_at`,
      [RATES_BASE, JSON.stringify(rates), source, updatedAt],
    );
  } catch (err) {
    // A missing/locked table must not take pricing down; serve the fresh quotes.
    console.error("[rates] could not cache rates:", err);
  }
  return updatedAt;
}

/**
 * Current rates for the storefront and the admin rates card.
 * Pass `{ force: true }` to bypass the TTL (the admin "Refresh now" button).
 */
export async function getRates(
  env: Env,
  { force = false }: { force?: boolean } = {},
): Promise<RatesPayload> {
  const ttl = ttlHours(env);
  const stored = await readStored(env);

  if (stored && !force && isFresh(stored.updatedAt, ttl)) {
    return { ...stored, stale: false };
  }

  const fresh = await fetchFresh(env);
  if (fresh) {
    const updatedAt = await storeRates(env, fresh.rates, fresh.source);
    return {
      base: RATES_BASE,
      rates: fresh.rates,
      updatedAt,
      source: fresh.source,
      stale: false,
    };
  }

  if (stored) return { ...stored, stale: true };

  return {
    base: RATES_BASE,
    rates: FALLBACK_RATES,
    updatedAt: null,
    source: "fallback",
    stale: true,
  };
}
