import { formatMoney, toMinor } from "../../shared/money.js";

/** Store currency defaults to KES; the admin passes the configured code. */
export function formatPrice(minor, currency = "KES", locale = "en-KE") {
  return formatMoney(minor, currency, locale);
}

/** Money typed in the admin -> minor units. Empty stays empty when allowed. */
export function parseMoneyInput(value, allowEmpty = false) {
  if (value == null || value === "") return allowEmpty ? null : 0;
  return toMinor(value);
}

export function parsePriceToCents(value) {
  return toMinor(value);
}

export function centsToInput(cents) {
  if (cents == null) return "";
  const amount = Number(cents) / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T") + (value.includes("T") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T") + (value.includes("T") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}
