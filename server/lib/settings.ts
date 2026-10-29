/** Typed access to the `settings` table with sane defaults (KES). */
import type { Env } from "../env";
import { all, run } from "./db";
import { parseCents, type CurrencyConfig, type ShippingConfig, DEFAULT_CURRENCY } from "./money";

export type SettingsValues = Record<string, unknown>;

const DEFAULTS: SettingsValues = {
  store: {
    name: "AFREAK",
    email: "hello@afreak.com",
    currency: "KES",
    social: { instagram: "", tiktok: "", x: "", youtube: "" },
  },
  currency: { code: "KES", locale: "en-KE", symbol: "KES" },
  promo_bar: { text: "", active: false },
  shipping: { threshold_cents: 1500000, flat_cents: 50000, express_cents: 150000 },
  shipping_banner: {
    title: "Free shipping",
    subtitle: "On all orders over KES 15,000",
    cta_label: "Shop now",
    cta_url: "/shop",
  },
  size_presets: {
    apparel: ["XS", "S", "M", "L", "XL", "XXL"],
    print: ["A4", "A3", "A2"],
    one_size: ["One size"],
  },
  size_meta: {
    A4: { mm: [210, 297], in: [8.3, 11.7] },
    A3: { mm: [297, 420], in: [11.7, 16.5] },
    A2: { mm: [420, 594], in: [16.5, 23.4] },
  },
  showcase: { product_id: null },
  footer: { blurb: "Technical details meet minimal aesthetics." },
  menu_feature: { eyebrow: "", title: "", url: "/shop?new=1", image: null },
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
    thresholdCents: Number(s.threshold_cents ?? parseCents(env.FREE_SHIPPING_THRESHOLD_CENTS, 1500000)),
    flatCents: Number(s.flat_cents ?? parseCents(env.FLAT_SHIPPING_CENTS, 50000)),
    expressCents: Number(s.express_cents ?? parseCents(env.EXPRESS_SHIPPING_CENTS, 150000)),
  };
}

/**
 * Store currency. `currency` setting wins, then `store.currency`, then env.
 * KES / en-KE is the default when nothing is configured.
 */
export function currencyConfig(env: Env, settings: SettingsValues): CurrencyConfig {
  const c = (settings.currency ?? {}) as Record<string, unknown>;
  const store = (settings.store ?? {}) as Record<string, unknown>;
  const code =
    (typeof c.code === "string" && c.code) ||
    (typeof store.currency === "string" && store.currency) ||
    env.CURRENCY ||
    DEFAULT_CURRENCY.code;
  const locale =
    (typeof c.locale === "string" && c.locale) || DEFAULT_CURRENCY.locale;
  return { code: code.toUpperCase(), locale };
}

/** Loads just the currency (cached by the caller's single settings read when possible). */
export async function getCurrency(env: Env): Promise<CurrencyConfig> {
  return currencyConfig(env, await getSettings(env, ["currency", "store"]));
}
