import type { Env } from "../env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile token. When no secret is configured (local dev / tests)
 * verification is skipped and every token passes.
 */
export async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  ip?: string | null,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;

  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    // Fail closed only when a secret is present.
    return false;
  }
}
