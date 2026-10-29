/**
 * Money helpers shared by the API, the admin CMS and the storefront.
 *
 * Amounts are integer minor units. The store currency is KES by default, but
 * every formatter takes the configured code/locale so a future store can change
 * it without touching call sites.
 */

/** Minor units -> "KES 3,500" (drops ".00" when whole, keeps 2 decimals otherwise). */
export function formatMoney(minor, currency = "KES", locale = "en-KE") {
  const amount = Number(minor ?? 0) / 100;
  const whole = Number.isInteger(amount);
  try {
    const s = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
    return s.replace(/\u00A0/g, " ");
  } catch {
    return `${currency} ${amount.toLocaleString("en", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

/** "3,500.50" / "KES 3500" -> 350050 minor units. Blocks negatives, keeps 2 decimals. */
export const toMinor = (input) => {
  const cleaned = String(input ?? "").replace(/[^\d.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};

export const isWholeAmount = (minor) => Number(minor ?? 0) % 100 === 0;

export default { formatMoney, toMinor };
