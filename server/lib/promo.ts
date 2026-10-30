import type { Env } from "../env";
import { first } from "./db";
import { CATALOG_CURRENCY, convertCents } from "./money";

export type PromoRow = {
  code: string;
  type: "percent" | "fixed";
  value: number;
  min_subtotal_cents: number;
  active: number;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
};

export function findPromo(env: Env, code: string): Promise<PromoRow | null> {
  return first<PromoRow>(
    env.DB,
    `SELECT code, type, value, min_subtotal_cents, active, expires_at, max_uses, uses
       FROM promo_codes WHERE code = ? COLLATE NOCASE`,
    [code],
  );
}

export type PromoCheck = { usable: boolean; reason?: string };

export function promoUsable(promo: PromoRow, subtotalCents: number): PromoCheck {
  if (!promo.active) return { usable: false, reason: "This code is no longer active" };
  if (promo.expires_at && Date.parse(promo.expires_at) < Date.now()) {
    return { usable: false, reason: "This code has expired" };
  }
  if (promo.max_uses != null && promo.uses >= promo.max_uses) {
    return { usable: false, reason: "This code has reached its limit" };
  }
  if (subtotalCents < promo.min_subtotal_cents) {
    return { usable: false, reason: "Order does not meet the minimum for this code" };
  }
  return { usable: true };
}

/**
 * Promo amounts (`min_subtotal_cents`, and `value` for a fixed code) are stored
 * in the store currency, while quote and validation subtotals are in the
 * catalog currency. Convert them once so a minimum or a fixed discount is
 * compared and subtracted in the same units as the subtotal.
 */
export function promoInCurrency(
  promo: PromoRow,
  rates: Record<string, number | null> | null,
  from: string,
  to: string = CATALOG_CURRENCY,
): PromoRow {
  if (from === to || !rates) return promo;
  return {
    ...promo,
    min_subtotal_cents: convertCents(promo.min_subtotal_cents, rates, from, to),
    value: promo.type === "fixed" ? convertCents(promo.value, rates, from, to) : promo.value,
  };
}
