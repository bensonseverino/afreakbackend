export function formatPrice(cents, currency = "EUR") {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${(Number(cents ?? 0) / 100).toFixed(2)}`;
}

export function parsePriceToCents(value) {
  const n = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function centsToInput(cents) {
  return (Number(cents ?? 0) / 100).toFixed(2);
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
