/**
 * Phone numbers, normalised to E.164.
 *
 * Sign-up accepts a phone number in any of the shapes a person types — local
 * (`0712 345 678`), international (`+254 712 345 678`) or with a `00` prefix —
 * and stores exactly one form. That single form is what the login lookup, the
 * UNIQUE index and guest-order matching all rely on, so an unparseable number is
 * rejected rather than guessed at: a wrong guess would sign someone into
 * somebody else's account.
 */

/** Dial codes for the countries the storefront offers. */
export const DIAL_CODES: Record<string, string> = {
  KE: "254",
  UG: "256",
  TZ: "255",
  RW: "250",
  NG: "234",
  GH: "233",
  ZA: "27",
  US: "1",
  CA: "1",
  GB: "44",
  IE: "353",
  FR: "33",
  DE: "49",
  IT: "39",
  ES: "34",
  PT: "351",
  NL: "31",
  BE: "32",
  SE: "46",
  NO: "47",
  DK: "45",
  AE: "971",
  IN: "91",
  AU: "61",
};

/** Country a number without a country code is assumed to belong to. */
export const DEFAULT_PHONE_COUNTRY = "KE";

function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}

/** A number that already carries its country code, or null. */
export function normalizePhoneE164(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("+")) return null;
  const digits = digitsOnly(trimmed.slice(1));
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/** Best-effort E.164 for anything typed into a phone field. */
export function toE164(value: unknown, country = DEFAULT_PHONE_COUNTRY): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (raw.startsWith("+")) return normalizePhoneE164(raw);

  if (raw.startsWith("00")) {
    const digits = digitsOnly(raw.slice(2));
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  const dial = DIAL_CODES[country.toUpperCase()] ?? DIAL_CODES[DEFAULT_PHONE_COUNTRY];
  const digits = digitsOnly(raw);
  if (!dial || !digits) return null;

  // A national number may or may not carry its trunk prefix ("0").
  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  const full = dial + national;
  return full.length >= 9 && full.length <= 15 ? `+${full}` : null;
}
