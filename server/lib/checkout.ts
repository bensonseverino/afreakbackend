/** Server-authoritative pricing for carts, quotes and orders. */
import type { Env } from "../env";
import { all } from "./db";
import { CATALOG_CURRENCY, convertCents, promoDiscount, shippingFor, type DeliveryMethod } from "./money";
import { findPromo, promoUsable, type PromoRow } from "./promo";
import { imageShape, type ImageRef } from "./media";
import { getSettings, shippingConfig, currencyConfig } from "./settings";
import { getRates } from "./rates";

export type PrintInput = { placement?: string | null; artworkKey?: string | null } | null;

export type LineInput = {
  variantId: number;
  qty: number;
  print?: PrintInput;
};

export type PricedLine = {
  lineId: number;
  variantId: number;
  productId: number;
  slug: string;
  name: string;
  colorName: string;
  size: string;
  qty: number;
  basePriceCents: number;
  printAddonCents: number;
  unitPriceCents: number;
  stock: number;
  available: boolean;
  image: ImageRef | null;
  print: PrintInput;
  sku: string | null;
  optionValueIds: number[];
};

export type QuoteIssue = {
  lineId: number;
  variantId: number;
  code: "UNAVAILABLE" | "OUT_OF_STOCK" | "NOT_CUSTOMIZABLE" | "PRICE_MISSING";
  message: string;
  available: number;
};

export type Quote = {
  lines: PricedLine[];
  issues: QuoteIssue[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  deliveryMethod: DeliveryMethod;
  freeShippingThresholdCents: number;
  promo: {
    code: string;
    type: "percent" | "fixed";
    value: number;
    valid: boolean;
    reason?: string;
    discountCents: number;
  } | null;
};

type VariantRow = {
  id: number;
  product_id: number;
  color_name: string;
  size: string;
  stock: number;
  slug: string;
  name: string;
  price_cents: number;
  print_addon_cents: number;
  size_type: string;
  customizable: number;
  status: string;
  image_key: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
  variant_price_cents: number | null;
  variant_compare_at_price_cents: number | null;
  track_stock: number;
  is_active: number;
  option_value_ids: string | null;
};

async function loadVariants(env: Env, ids: number[]): Promise<Map<number, VariantRow>> {
  const map = new Map<number, VariantRow>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = await all<VariantRow>(
    env.DB,
    `SELECT v.id, v.product_id, v.color_name, v.size, v.stock,
            p.slug, p.name, p.price_cents, p.print_addon_cents, p.size_type, p.customizable, p.status,
            m.key AS image_key, m.alt AS image_alt, m.width AS image_width, m.height AS image_height,
            v.price_cents AS variant_price_cents, v.compare_at_price_cents AS variant_compare_at_price_cents,
            v.track_stock, v.is_active, v.option_value_ids
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_images pi
         ON pi.id = (
           SELECT pi2.id FROM product_images pi2
            WHERE pi2.product_id = p.id
              AND (pi2.option_value_id IN (
                     SELECT pov.id
                       FROM product_options po
                       JOIN product_option_values pov ON pov.option_id = po.id
                      WHERE po.product_id = p.id
                        AND po.name = 'Color'
                        AND pov.value = v.color_name
                   ) OR pi2.color_name = v.color_name)
            ORDER BY pi2.is_primary DESC, pi2.sort, pi2.id LIMIT 1
         )
       LEFT JOIN media m ON m.id = pi.media_id
      WHERE v.id IN (${placeholders})`,
    ids,
  );
  for (const row of rows) map.set(row.id, row);
  return map;
}

export function normalizeDeliveryMethod(value: unknown): DeliveryMethod {
  return value === "express" ? "express" : "standard";
}

/** Build a fully authoritative quote from client line inputs. */
export async function buildQuote(
  env: Env,
  input: { items: LineInput[]; deliveryMethod?: unknown; promoCode?: string | null },
): Promise<Quote> {
  const deliveryMethod = normalizeDeliveryMethod(input.deliveryMethod);
  const variantIds = [...new Set(input.items.map((i) => i.variantId))];
  const variants = await loadVariants(env, variantIds);

  const lines: PricedLine[] = [];
  const issues: QuoteIssue[] = [];
  let subtotalCents = 0;

  input.items.forEach((item, index) => {
    const lineId = index;
    const v = variants.get(item.variantId);
    if (!v || v.status !== "published") {
      issues.push({
        lineId,
        variantId: item.variantId,
        code: "UNAVAILABLE",
        message: "This item is no longer available",
        available: 0,
      });
      return;
    }
    if (!v.is_active) {
      issues.push({
        lineId,
        variantId: v.id,
        code: "UNAVAILABLE",
        message: "This item is no longer available",
        available: 0,
      });
      return;
    }

    const qty = Math.max(1, Math.floor(item.qty));
    const wantsPrint = !!(item.print && (item.print.artworkKey || item.print.placement));
    const printAddonCents = wantsPrint ? (v.customizable ? v.print_addon_cents : 0) : 0;
    if (wantsPrint && !v.customizable) {
      issues.push({
        lineId,
        variantId: v.id,
        code: "NOT_CUSTOMIZABLE",
        message: "Custom printing is not available for this product",
        available: v.stock,
      });
    }

    // Print products price every size individually: a variant without its own
    // price is not sellable rather than silently falling back to the base.
    const priceMissing = v.size_type === "print" && v.variant_price_cents == null;
    const effectivePriceCents = v.variant_price_cents ?? v.price_cents;
    const unitPriceCents = effectivePriceCents + printAddonCents;

    if (priceMissing) {
      issues.push({
        lineId,
        variantId: v.id,
        code: "PRICE_MISSING",
        message: "This size has no price yet",
        available: 0,
      });
    }

    let available: boolean;
    if (!v.track_stock) {
      available = true;
    } else {
      available = v.stock >= qty;
    }
    if (priceMissing) available = false;
    if (!available && !priceMissing) {
      issues.push({
        lineId,
        variantId: v.id,
        code: "OUT_OF_STOCK",
        message: v.stock > 0 ? `Only ${v.stock} left in stock` : "Out of stock",
        available: v.stock,
      });
    }

    subtotalCents += unitPriceCents * qty;
    lines.push({
      lineId,
      variantId: v.id,
      productId: v.product_id,
      slug: v.slug,
      name: v.name,
      colorName: v.color_name,
      size: v.size,
      qty,
      basePriceCents: effectivePriceCents,
      printAddonCents,
      unitPriceCents,
      stock: v.stock,
      available,
      image: imageShape(
        v.image_key
          ? { key: v.image_key, alt: v.image_alt, width: v.image_width, height: v.image_height }
          : null,
      ),
      print: wantsPrint ? (item.print ?? null) : null,
      sku: null,
      optionValueIds: v.option_value_ids ? JSON.parse(v.option_value_ids) : [],
    });
  });

  // Promo
  let promo: Quote["promo"] = null;
  let discountCents = 0;
  const code = input.promoCode?.trim();
  if (code) {
    const row: PromoRow | null = await findPromo(env, code);
    if (!row) {
      promo = { code, type: "percent", value: 0, valid: false, reason: "Invalid code", discountCents: 0 };
    } else {
      const check = promoUsable(row, subtotalCents);
      if (check.usable) {
        discountCents = promoDiscount(row, subtotalCents);
        promo = { code: row.code, type: row.type, value: row.value, valid: true, discountCents };
      } else {
        promo = {
          code: row.code,
          type: row.type,
          value: row.value,
          valid: false,
          reason: check.reason,
          discountCents: 0,
        };
      }
    }
  }

  const settings = await getSettings(env, ["shipping", "currency", "store"]);
  const config = shippingConfig(env, settings);
  const storeCurrency = currencyConfig(env, settings).code;

  // `settings.shipping` is expressed in the store currency (KES) while the
  // product prices above are in CATALOG_CURRENCY. Convert the shipping side so
  // the threshold comparison, the shipping line and the total all speak the
  // same currency — otherwise free shipping can never trigger and the total
  // adds KES cents to EUR cents.
  let shippingConfigForQuote = config;
  if (storeCurrency !== CATALOG_CURRENCY) {
    const { rates } = await getRates(env);
    shippingConfigForQuote = {
      thresholdCents: convertCents(config.thresholdCents, rates, storeCurrency, CATALOG_CURRENCY),
      flatCents: convertCents(config.flatCents, rates, storeCurrency, CATALOG_CURRENCY),
      expressCents: convertCents(config.expressCents, rates, storeCurrency, CATALOG_CURRENCY),
    };
  }

  const discountedSubtotal = Math.max(0, subtotalCents - discountCents);
  const shippingCents = shippingFor(deliveryMethod, discountedSubtotal, shippingConfigForQuote);
  const totalCents = discountedSubtotal + shippingCents;

  return {
    lines,
    issues,
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents,
    currency: CATALOG_CURRENCY,
    deliveryMethod,
    freeShippingThresholdCents: shippingConfigForQuote.thresholdCents,
    promo,
  };
}
