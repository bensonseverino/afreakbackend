/**
 * Customer password policy and temporary-password generation.
 *
 * Deliberately stricter than "not empty, not too short" but kinder than the
 * usual symbol soup: the only rules a customer has to satisfy are a length
 * minimum, "not obviously guessable" and "not your own email or phone number".
 */
import { ApiError } from "./http";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * The usual suspects. Small on purpose — a real breach list would be an asset,
 * and the rate limiter plus admin approval do most of the work here.
 */
const COMMON_PASSWORDS = new Set([
  "123456", "12345678", "123456789", "1234567890", "111111", "000000", "123123",
  "654321", "121212", "112233", "11223344", "123321", "12341234", "123123123",
  "password", "password1", "password123", "passw0rd", "p@ssword", "p@ssw0rd",
  "qwerty", "qwerty123", "qwertyuiop", "qwerty1234", "asdfghjkl", "zxcvbnm",
  "iloveyou", "letmein", "welcome", "welcome1", "admin", "admin123", "administrator",
  "root", "toor", "guest", "user", "default", "changeme", "secret", "monkey",
  "dragon", "master", "shadow", "sunshine", "princess", "football", "baseball",
  "superman", "batman", "trustno1", "abc123", "abcd1234", "a1b2c3d4", "1q2w3e4r",
  "1qaz2wsx", "qazwsx", "zaq12wsx", "qwerty1", "asdf1234", "liverpool", "chelsea",
  "arsenal", "afreak", "afreak123", "test1234", "testtest", "hello123", "freedom",
  "whatever", "nothing", "starwars", "pokemon", "computer", "internet", "samsung",
  "google", "facebook", "instagram", "whatsapp", "kenya2024", "kenya1234",
]);

/** `null` when the password is acceptable, otherwise a human-readable problem. */
export function passwordProblem(
  password: unknown,
  options: { identifiers?: (string | null | undefined)[] } = {},
): string | null {
  if (typeof password !== "string" || password === "") return "Enter a password";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters`;
  }

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return "That password is too common — choose another";
  }
  for (const identifier of options.identifiers ?? []) {
    if (identifier && lower === identifier.toLowerCase()) {
      return "Your password must not be your email or phone number";
    }
  }
  return null;
}

/** Validate or raise a field-level VALIDATION error. */
export function assertPassword(
  password: unknown,
  options: { identifiers?: (string | null | undefined)[] } = {},
): string {
  const problem = passwordProblem(password, options);
  if (problem) throw ApiError.validation({ password: problem });
  return password as string;
}

/**
 * A temporary password a human can read out loud.
 *
 * The alphabet drops every glyph pair that gets misread (`0`/`O`, `1`/`l`/`I`)
 * because these are copied by hand from a message the admin sends themselves.
 */
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateTempPassword(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length];
  }
  return out;
}
