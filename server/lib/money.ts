/** Money helpers. All amounts are integer cents. */

export type DeliveryMethod = "standard" | "express";

export type ShippingConfig = {
  thresholdCents: number;
  flatCents: number;
  expressCents: number;
};

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

export function formatCents(cents: number, currency = "EUR"): string {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${(cents / 100).toFixed(2)}`;
}
