/**
 * Clerk → Workers plumbing: Svix signature verification plus the mapping from a
 * Clerk user payload onto a `customers` row.
 *
 * Clerk delivers through Svix, which signs `${svix-id}.${svix-timestamp}.${body}`
 * with the endpoint secret and sends the result in `svix-signature` as a
 * space-separated list of `v1,<base64 HMAC-SHA256>` entries. WebCrypto keeps
 * this dependency-free (no node compat needed) and the comparison is
 * constant-time, so a wrong signature cannot be probed byte by byte.
 */

/** Svix rejects anything older than this; so do we. */
const TOLERANCE_MS = 5 * 60 * 1000;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function equals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export type SignatureInput = {
  /** The endpoint secret, `whsec_…`. */
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  /** The raw request body — parsed JSON would change the bytes. */
  body: string;
};

/** True when `signature` carries a valid `v1` HMAC for this delivery. */
export async function verifyClerkSignature(input: SignatureInput): Promise<boolean> {
  const { secret, id, timestamp, signature, body } = input;
  const secretBytes = decodeBase64(secret.replace(/^whsec_/, ""));

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || !id || !signature) return false;
  if (Math.abs(Date.now() - seconds * 1000) > TOLERANCE_MS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );

  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    try {
      return equals(mac, decodeBase64(value));
    } catch {
      return false; // not base64 — treat as a bad signature, not a 500
    }
  });
}

/* ------------------------------------------------------------------ *
 * Clerk user → customer row
 * ------------------------------------------------------------------ */

type ClerkEmail = { id?: string; email_address?: string };
type ClerkPhone = { id?: string; phone_number?: string };

/** The slice of `customers` a Clerk user can fill in. `null` means "unknown". */
export type ClerkCustomer = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  imageUrl: string | null;
  marketingOptIn: number | null;
  smsOptIn: number | null;
  createdAt: string | null;
  lastSignInAt: string | null;
};

/** Clerk sends `""` for unset fields; store those as NULL. */
function orNull(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed === "" ? null : trimmed;
}

/** `true`/`1` → 1, `false`/`0` → 0, anything else (including absent) → null. */
function flag(value: unknown): number | null {
  if (value === true || value === 1 || value === "true") return 1;
  if (value === false || value === 0 || value === "false") return 0;
  return null;
}

/** Clerk timestamps are milliseconds since the epoch. */
function toIso(value: unknown): string | null {
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function pickPrimary<T extends { id?: string }>(items: unknown, primaryId: unknown): T | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const list = items as T[];
  return list.find((item) => item.id === primaryId) ?? list[0];
}

/**
 * Map `event.data` of `user.created` / `user.updated` onto a customer row.
 * Returns null when the payload carries no user id.
 */
export function customerFromClerkUser(data: Record<string, unknown>): ClerkCustomer | null {
  const id = orNull(data.id);
  if (!id) return null;

  const email = pickPrimary<ClerkEmail>(data.email_addresses, data.primary_email_address_id);
  const phone = pickPrimary<ClerkPhone>(data.phone_numbers, data.primary_phone_number_id);
  const metadata =
    data.public_metadata && typeof data.public_metadata === "object"
      ? (data.public_metadata as Record<string, unknown>)
      : {};

  return {
    id,
    email: orNull(email?.email_address),
    firstName: orNull(data.first_name, 120),
    lastName: orNull(data.last_name, 120),
    phone: orNull(phone?.phone_number, 32),
    imageUrl: orNull(data.image_url, 500),
    // Consent is optional metadata: absent means "leave what we have".
    marketingOptIn: flag(metadata.marketingOptIn),
    smsOptIn: flag(metadata.smsOptIn),
    createdAt: toIso(data.created_at),
    lastSignInAt: toIso(data.last_sign_in_at),
  };
}
