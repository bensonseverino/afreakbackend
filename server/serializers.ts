/**
 * Serializer layer (CMS CONNECTION FIX §4.3).
 *
 * Every public route maps D1 rows through these functions — no ad-hoc mapping
 * in route handlers, no snake_case leaking to the storefront (cause C-4).
 * The public contract is camelCase; arrays are always arrays; unknown optional
 * values are `null`; image objects are always `{ url, alt, width, height }`.
 */
import { imageShape } from "./lib/media";
import type { SettingsValues } from "./lib/settings";

export type ImageRef = { url: string; alt: string | null; width: number | null; height: number | null };

/* ------------------------------------------------------------------ *
 * Settings values
 * ------------------------------------------------------------------ */

/**
 * Settings are stored as JSON text. Parse once — and guard against values that
 * were written double-encoded (`"\"{...}\""`) by an older client.
 */
export function parseSettingValue<T = unknown>(value: T): unknown {
  let current: unknown = value;
  for (let i = 0; i < 2; i += 1) {
    if (typeof current !== "string") break;
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  return current;
}

function obj(value: unknown): Record<string, unknown> {
  const parsed = parseSettingValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/* ------------------------------------------------------------------ *
 * Images & content rows
 * ------------------------------------------------------------------ */

export function serializeImage(
  row: { key?: string | null; alt?: string | null; width?: number | null; height?: number | null } | null,
): ImageRef | null {
  if (!row?.key) return null;
  return imageShape({
    key: row.key,
    alt: row.alt ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
  }) as ImageRef;
}

export type HeroSlideRow = {
  id: number;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  cta_label: string | null;
  cta_url: string | null;
  sort?: number;
  media_key?: string | null;
  media_alt?: string | null;
  media_w?: number | null;
  media_h?: number | null;
};

export function serializeHeroSlide(row: HeroSlideRow) {
  return {
    id: row.id,
    eyebrow: nullableText(row.eyebrow),
    title: text(row.title),
    subtitle: nullableText(row.subtitle),
    ctaLabel: nullableText(row.cta_label),
    ctaUrl: nullableText(row.cta_url),
    image: serializeImage({
      key: row.media_key,
      alt: row.media_alt,
      width: row.media_w,
      height: row.media_h,
    }),
  };
}

export type LookbookRow = {
  id: number;
  caption: string | null;
  link_url: string | null;
  sort?: number;
  media_key: string | null;
  media_alt: string | null;
  media_w: number | null;
  media_h: number | null;
};

export function serializeLookbookItem(row: LookbookRow) {
  return {
    id: row.id,
    caption: nullableText(row.caption),
    linkUrl: nullableText(row.link_url),
    image: serializeImage({
      key: row.media_key,
      alt: row.media_alt,
      width: row.media_w,
      height: row.media_h,
    }),
  };
}

/**
 * Catalogue cards already arrive shape-normalised from `lib/catalog`; this
 * keeps the two layers honest (a card is the same object wherever it appears).
 */
export function serializeProductCard(card: Record<string, unknown> | null) {
  if (!card) return null;
  return { ...card, id: int(card.id), soldOut: bool(card.soldOut) };
}

/* ------------------------------------------------------------------ *
 * Settings → public contract
 * ------------------------------------------------------------------ */

export function serializeStore(value: unknown) {
  const v = obj(value);
  const social = obj(v.social);
  return {
    name: text(v.name, "AFREAK"),
    email: text(v.email, ""),
    currency: text(v.currency, "KES"),
    social: {
      instagram: text(social.instagram),
      tiktok: text(social.tiktok),
      x: text(social.x),
      youtube: text(social.youtube),
      pinterest: text(social.pinterest),
    },
  };
}

export function serializePromoBar(value: unknown) {
  const v = obj(value);
  return { active: bool(v.active), text: text(v.text) };
}

export function serializeShippingRules(value: unknown) {
  const v = obj(value);
  return {
    thresholdCents: int(v.threshold_cents, 1500000),
    flatCents: int(v.flat_cents, 50000),
    expressCents: int(v.express_cents, 150000),
  };
}

export function serializeShippingBanner(value: unknown) {
  const v = obj(value);
  return {
    title: text(v.title, "Free shipping"),
    subtitle: text(v.subtitle, ""),
    ctaLabel: nullableText(v.cta_label),
    ctaUrl: nullableText(v.cta_url),
  };
}

export function serializeShowcase(value: unknown) {
  const v = obj(value);
  const productId = v.product_id ?? v.productId ?? null;
  return { productId: productId == null ? null : int(productId) };
}

export function serializeFooter(value: unknown) {
  const v = obj(value);
  const social = obj(v.social);
  return {
    blurb: text(v.blurb, ""),
    social: {
      instagram: text(social.instagram),
      tiktok: text(social.tiktok),
      x: text(social.x),
      youtube: text(social.youtube),
      pinterest: text(social.pinterest),
    },
  };
}

/**
 * `menu_feature.image` is stored by the CMS as a media reference
 * (`{ key, alt, width, height }`). Older rows may carry a public image shape
 * (`{ url, ... }`) instead, so accept both — a valid image must never disappear
 * because of the shape it was written in.
 */
export function serializeMenuFeatureImage(value: unknown): ImageRef | null {
  const image = obj(value);
  const key = typeof image.key === "string" && image.key ? image.key : null;
  if (key) {
    return serializeImage({
      key,
      alt: nullableText(image.alt),
      width: image.width == null ? null : int(image.width),
      height: image.height == null ? null : int(image.height),
    });
  }
  const url = typeof image.url === "string" && image.url ? image.url : null;
  if (!url) return null;
  return {
    url,
    alt: nullableText(image.alt),
    width: image.width == null ? null : int(image.width),
    height: image.height == null ? null : int(image.height),
  };
}

export function serializeMenuFeature(value: unknown) {
  const v = obj(value);
  return {
    eyebrow: nullableText(v.eyebrow),
    title: nullableText(v.title),
    url: nullableText(v.url),
    image: serializeMenuFeatureImage(v.image),
  };
}

/** The public settings payload shared by `/api/home` and `/api/settings/public`. */
export function serializeSettings(settings: SettingsValues) {
  return {
    store: serializeStore(settings.store),
    promoBar: serializePromoBar(settings.promo_bar),
    shipping: serializeShippingRules(settings.shipping),
    shippingBanner: serializeShippingBanner(settings.shipping_banner),
    showcase: serializeShowcase(settings.showcase),
    footer: serializeFooter(settings.footer),
    menuFeature: serializeMenuFeature(settings.menu_feature),
  };
}
