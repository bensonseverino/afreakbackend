/** Random ids and human-friendly order numbers. */

export function uuid(): string {
  return crypto.randomUUID();
}

/** A namespaced random id, e.g. `prd_a1b2c3`. */
export function newId(prefix: string): string {
  const raw = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  return `${prefix}_${raw}`;
}

/** `AF-123456` — 6 random digits, unique enough for a small store. */
export function orderNumber(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return `AF-${String(n).padStart(6, "0")}`;
}

/** Random hex string (default 32 bytes → 64 chars) from a CSPRNG. */
export function randomHex(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}
