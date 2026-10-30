/** Money helpers. All amounts are integer minor units of the store currency. */
import { formatMoney as sharedFormatMoney } from "../../shared/money.js";

export type DeliveryMethod = "standard" | "express";

export type ShippingConfig = {
  thresholdCents: number;
  flatCents: number;
  expressCents: number;
};

export type CurrencyConfig = {
  code: string;
  locale: string;
};

export const DEFAULT_CURRENCY: CurrencyConfig = { code: "KES", locale: "en-KE" };

/**
 * Currency the catalog prices are stored in.
 *
 * Product and variant prices were entered in EUR (0009_exchange_rates.sql:
 * "Prices themselves are always stored in the shop base currency (EUR)"), and
 * `scripts/convert-prices.mjs` is the deliberate, opt-in migration to the store
 * currency. Until that is run, `settings.currency` (KES) only describes how the
 * storefront *displays* prices and how `settings.shipping` is expressed —
 * quote math has to happen in this currency, because it is what the shopper is
 * charged and what `product_variants.price_cents` is in.
 */
export const CATALOG_CURRENCY = "EUR";

/**
 * Convert integer minor units between two currencies quoted against USD.
 * Returns the amount unchanged when either quote is missing.
 */
export function convertCents(
  amount: number,
  rates: Record<string, number | null> | null | undefined,
  from: string,
  to: string,
): number {
  const value = Number(amount) || 0;
  if (!rates || from === to) return Math.round(value);

  const source = Number(rates[from]);
  const target = Number(rates[to]);
  if (!Number.isFinite(source) || !Number.isFinite(target) || source <= 0 || target <= 0) {
    return Math.round(value);
  }
  return Math.round((value * target) / source);
}

export function parseCents(value: string | undefined, fallback = 0): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Standard shipping: free once the subtotal reaches the threshold, otherwise flat. */
export function shippingFor(
  method: DeliveryMethod,
  subtotalCents: number,
  config: ShippingConfig,
): number {
  if (method === "express") return config.expressCents;
  return subtotalCents >= config.thresholdCents ? 0 : config.flatCents;
}

/** Discount in cents for a promo applied to a subtotal. Never exceeds the subtotal. */
export function promoDiscount(
  promo: { type: "percent" | "fixed"; value: number },
  subtotalCents: number,
): number {
  const raw =
    promo.type === "percent"
      ? Math.round((subtotalCents * promo.value) / 100)
      : promo.value;
  return Math.max(0, Math.min(raw, subtotalCents));
}

/** Minor units -> "KES 3,500" using the shared formatter. */
export function formatCents(
  cents: number,
  currency = DEFAULT_CURRENCY.code,
  locale = DEFAULT_CURRENCY.locale,
): string {
  return sharedFormatMoney(cents, currency, locale);
}
