/** Typed access to the `settings` table with sane defaults. */
import type { Env } from "../env";
import { all, run } from "./db";
import { parseCents, type ShippingConfig } from "./money";

export type SettingsValues = Record<string, unknown>;

const DEFAULTS: SettingsValues = {
  store: {
    name: "AFREAK",
    email: "hello@afreak.com",
    social: { instagram: "", tiktok: "", x: "", youtube: "" },
  },
  promo_bar: { text: "", active: false },
  shipping: { threshold_cents: 15000, flat_cents: 600, express_cents: 1200 },
  shipping_banner: {
    title: "Free shipping",
    subtitle: "On all orders over €150",
    cta_label: "Shop now",
    cta_url: "/shop",
  },
  showcase: { product_id: null },
  footer: { blurb: "Technical details meet minimal aesthetics." },
  demo_payment: { enabled: false },
};

export async function getSettings(env: Env, keys?: string[]): Promise<SettingsValues> {
  const rows = await all<{ key: string; value_json: string }>(
    env.DB,
    keys && keys.length
      ? `SELECT key, value_json FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`
      : "SELECT key, value_json FROM settings",
    keys ?? [],
  );
  const out: SettingsValues = { ...DEFAULTS };
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value_json);
    } catch {
      out[row.key] = row.value_json;
    }
  }
  return out;
}

export async function getSetting<T = unknown>(env: Env, key: string): Promise<T> {
  const rows = await getSettings(env, [key]);
  return rows[key] as T;
}

export async function putSetting(env: Env, key: string, value: unknown): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`,
    [key, JSON.stringify(value ?? null)],
  );
}

/** Shipping config: settings override, env vars are the fallback. */
export function shippingConfig(env: Env, settings: SettingsValues): ShippingConfig {
  const s = (settings.shipping ?? {}) as Record<string, unknown>;
  return {
    thresholdCents: Number(s.threshold_cents ?? parseCents(env.FREE_SHIPPING_THRESHOLD_CENTS, 15000)),
    flatCents: Number(s.flat_cents ?? parseCents(env.FLAT_SHIPPING_CENTS, 600)),
    expressCents: Number(s.express_cents ?? parseCents(env.EXPRESS_SHIPPING_CENTS, 1200)),
  };
}
