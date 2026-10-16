/** Server-authoritative pricing for carts, quotes and orders. */
import type { Env } from "../env";
import { all } from "./db";
import { promoDiscount, shippingFor, type DeliveryMethod } from "./money";
import { findPromo, promoUsable, type PromoRow } from "./promo";
import { imageShape, type ImageRef } from "./media";
import { getSettings, shippingConfig } from "./settings";

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
};

export type QuoteIssue = {
  lineId: number;
  variantId: number;
  code: "UNAVAILABLE" | "OUT_OF_STOCK" | "NOT_CUSTOMIZABLE";
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
  customizable: number;
  status: string;
  image_key: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
};

async function loadVariants(env: Env, ids: number[]): Promise<Map<number, VariantRow>> {
  const map = new Map<number, VariantRow>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = await all<VariantRow>(
    env.DB,
    `SELECT v.id, v.product_id, v.color_name, v.size, v.stock,
            p.slug, p.name, p.price_cents, p.print_addon_cents, p.customizable, p.status,
            m.key AS image_key, m.alt AS image_alt, m.width AS image_width, m.height AS image_height
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_images pi
         ON pi.id = (SELECT id FROM product_images WHERE product_id = p.id ORDER BY sort, id LIMIT 1)
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

    const unitPriceCents = v.price_cents + printAddonCents;
    const available = v.stock >= qty;
    if (!available) {
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
      basePriceCents: v.price_cents,
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

  const settings = await getSettings(env, ["shipping"]);
  const config = shippingConfig(env, settings);
  const discountedSubtotal = Math.max(0, subtotalCents - discountCents);
  const shippingCents = shippingFor(deliveryMethod, discountedSubtotal, config);
  const totalCents = discountedSubtotal + shippingCents;

  return {
    lines,
    issues,
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents,
    currency: env.CURRENCY,
    deliveryMethod,
    freeShippingThresholdCents: config.thresholdCents,
    promo,
  };
}
