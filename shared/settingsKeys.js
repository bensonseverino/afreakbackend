/**
 * Single source of truth for `settings` keys (CMS CONNECTION FIX §C-11).
 *
 * Imported by the API (server/routes/**) and by the admin CMS (src/admin/**) so
 * a typo such as `promoBar` vs `promo_bar` cannot make a save silently no-op.
 */

export const SETTINGS_KEYS = {
  STORE: 'store',
  PROMO_BAR: 'promo_bar',
  SHIPPING: 'shipping',
  SHIPPING_BANNER: 'shipping_banner',
  SHOWCASE: 'showcase',
  FOOTER: 'footer',
  MENU_FEATURE: 'menu_feature',
  DEMO_PAYMENT: 'demo_payment',
  /** { code, locale } — store currency; KES by default. */
  CURRENCY: 'currency',
  /** Size labels per size type: { apparel, print, one_size }. */
  SIZE_PRESETS: 'size_presets',
  /** Print dimensions per size label: { A4: { mm, in }, ... }. */
  SIZE_META: 'size_meta',
  /** Bumped by every admin write that can change the storefront (§6). */
  CONTENT_VERSION: 'content_version',
};

/** Keys the admin settings endpoint may read/write. */
export const EDITABLE_SETTINGS_KEYS = [
  SETTINGS_KEYS.STORE,
  SETTINGS_KEYS.PROMO_BAR,
  SETTINGS_KEYS.SHIPPING,
  SETTINGS_KEYS.SHIPPING_BANNER,
  SETTINGS_KEYS.SHOWCASE,
  SETTINGS_KEYS.FOOTER,
  SETTINGS_KEYS.MENU_FEATURE,
  SETTINGS_KEYS.DEMO_PAYMENT,
  SETTINGS_KEYS.CURRENCY,
  SETTINGS_KEYS.SIZE_PRESETS,
  SETTINGS_KEYS.SIZE_META,
];

/** Keys returned by the public storefront settings endpoint. */
export const PUBLIC_SETTINGS_KEYS = [
  SETTINGS_KEYS.STORE,
  SETTINGS_KEYS.PROMO_BAR,
  SETTINGS_KEYS.SHIPPING,
  SETTINGS_KEYS.SHIPPING_BANNER,
  SETTINGS_KEYS.SHOWCASE,
  SETTINGS_KEYS.FOOTER,
  SETTINGS_KEYS.MENU_FEATURE,
  SETTINGS_KEYS.CURRENCY,
  SETTINGS_KEYS.SIZE_PRESETS,
  SETTINGS_KEYS.SIZE_META,
];

export default SETTINGS_KEYS;
