/** Product options, values and sellable variant helpers. */
import type { Env } from "../env";
import { all } from "./db";

export type OptionValue = {
  id: number;
  value: string;
  swatchHex: string | null;
  swatchImageUrl: string | null;
  position: number;
};

export type ProductOption = {
  id: number;
  name: string;
  type: "color" | "size" | "other";
  position: number;
  values: OptionValue[];
};

export type OptionDraftValue = {
  value: string;
  swatchHex?: string | null;
  swatchImageUrl?: string | null;
  position?: number;
};

export type OptionDraft = {
  name: string;
  type: "color" | "size" | "other";
  position?: number;
  values: OptionDraftValue[];
};

export type VariantDraft = {
  colorName: string;
  colorHex: string;
  size: string;
  sku?: string;
  stock: number;
  priceCents?: number | null;
  compareAtPriceCents?: number | null;
  trackStock?: boolean;
  isActive?: boolean;
  optionValues?: Array<{ name: string; value: string }>;
};

export type VariantWithPairs = VariantDraft & {
  colorName: string;
  colorHex: string;
  size: string;
  optionPairs: Array<{ name: string; value: string }>;
};

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** Read options + values for one product in display order. */
export async function loadProductOptions(env: Env, productId: number): Promise<ProductOption[]> {
  const rows = await all<{
    id: number;
    name: string;
    type: string;
    position: number;
    value_id: number | null;
    value: string | null;
    swatch_hex: string | null;
    swatch_image_url: string | null;
    value_position: number | null;
  }>(
    env.DB,
    `SELECT po.id, po.name, po.type, po.position,
            pov.id AS value_id, pov.value, pov.swatch_hex, pov.swatch_image_url,
            pov.position AS value_position
       FROM product_options po
       LEFT JOIN product_option_values pov ON pov.option_id = po.id
      WHERE po.product_id = ?
      ORDER BY po.position, po.id, pov.position, pov.id`,
    [productId],
  );

  const options: ProductOption[] = [];
  const byId = new Map<number, ProductOption>();
  for (const row of rows) {
    let option = byId.get(row.id);
    if (!option) {
      option = {
        id: row.id,
        name: row.name,
        type: (row.type === "color" || row.type === "size" ? row.type : "other") as ProductOption["type"],
        position: row.position,
        values: [],
      };
      byId.set(row.id, option);
      options.push(option);
    }
    if (row.value_id != null && row.value != null) {
      option.values.push({
        id: row.value_id,
        value: row.value,
        swatchHex: row.swatch_hex,
        swatchImageUrl: row.swatch_image_url,
        position: row.value_position ?? option.values.length,
      });
    }
  }
  return options;
}

/** Parse the JSON array stored in `product_variants.option_value_ids`. */
export function parseOptionValueIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
  }
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
      : [];
  } catch {
    return [];
  }
}

export function variantInStock(
  variant: { is_active: number; track_stock: number; stock: number },
  qty = 1,
): boolean {
  if (!variant.is_active) return false;
  if (!variant.track_stock) return true;
  return variant.stock >= qty;
}

/** Effective selling price for a variant (falls back to the product base). */
export function variantPrice(variantPriceCents: number | null, basePriceCents: number): number {
  return variantPriceCents ?? basePriceCents;
}

const clean = (value: unknown) => String(value ?? "").trim();

function dedupeValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Build a validated option set from the admin payload. When the caller does
 * not send `options`, derive Color/Size from the variant fields — this keeps
 * older clients (and the current CMS save payload) working.
 */
export function buildOptions(
  variants: VariantDraft[],
  provided?: OptionDraft[],
): { options: OptionDraft[]; variants: VariantWithPairs[] } {
  if (variants.length > 100) throw new Error("A product can have at most 100 variants");

  const cleaned = variants.map((v) => ({
    ...v,
    colorName: clean(v.colorName),
    colorHex: clean(v.colorHex) || "#000000",
    size: clean(v.size),
    sku: clean(v.sku) || undefined,
    optionValues: (v.optionValues ?? [])
      .map((p) => ({ name: clean(p.name), value: clean(p.value) }))
      .filter((p) => p.name && p.value),
  }));

  let options: OptionDraft[];
  if (provided?.length) {
    options = provided.map((option, index) => ({
      name: clean(option.name),
      type: option.type,
      position: index,
      values: option.values
        .map((value, valueIndex) => ({
          value: clean(value.value),
          swatchHex: value.swatchHex ? clean(value.swatchHex) : null,
          swatchImageUrl: value.swatchImageUrl ? clean(value.swatchImageUrl) : null,
          position: valueIndex,
        }))
        .filter((value) => value.value),
    }));
  } else {
    const colors = new Map<string, string>();
    const sizes: string[] = [];
    for (const variant of cleaned) {
      if (variant.colorName && !colors.has(variant.colorName)) {
        colors.set(variant.colorName, variant.colorHex);
      }
      if (variant.size) sizes.push(variant.size);
    }
    options = [];
    if (colors.size) {
      options.push({
        name: "Color",
        type: "color",
        position: 0,
        values: [...colors.entries()].map(([value, swatchHex], index) => ({
          value,
          swatchHex,
          position: index,
        })),
      });
    }
    const uniqueSizes = dedupeValues(sizes);
    if (uniqueSizes.length) {
      options.push({
        name: "Size",
        type: "size",
        position: options.length,
        values: uniqueSizes.map((value, index) => ({ value, position: index })),
      });
    }
  }

  if (options.length > 3) throw new Error("A product can have at most 3 options");

  const optionNames = new Set<string>();
  for (const option of options) {
    if (!option.name) throw new Error("Every option needs a name");
    const key = option.name.toLowerCase();
    if (optionNames.has(key)) throw new Error(`Duplicate option name: ${option.name}`);
    optionNames.add(key);
    if (!option.values.length) throw new Error(`${option.name} needs at least one value`);
    if (option.values.length > 100) throw new Error(`${option.name} has too many values`);

    const values = new Set<string>();
    for (const value of option.values) {
      const valueKey = value.value.toLowerCase();
      if (values.has(valueKey)) {
        throw new Error(`Duplicate ${option.name} value: ${value.value}`);
      }
      values.add(valueKey);
      if (option.type === "color" && value.swatchHex && !HEX.test(value.swatchHex)) {
        throw new Error(`Invalid color hex for ${value.value}`);
      }
    }
  }

  const pairsByIndex: Array<Array<{ name: string; value: string }>> = [];
  const combinations = new Set<string>();
  const skus = new Set<string>();

  for (const variant of cleaned) {
    const pairs = options.map((option) => {
      let value = variant.optionValues?.find((p) => p.name.toLowerCase() === option.name.toLowerCase())?.value;
      if (!value && option.type === "color") value = variant.colorName;
      if (!value && option.type === "size") value = variant.size;
      if (!value) throw new Error(`Choose a ${option.name.toLowerCase()} for every variant`);
      const valid = option.values.some((v) => v.value.toLowerCase() === value!.toLowerCase());
      if (!valid) throw new Error(`${value} is not a valid ${option.name} value`);
      return { name: option.name, value };
    });

    const combination = pairs.map((p) => `${p.name.toLowerCase()}=${p.value.toLowerCase()}`).join("|");
    if (combinations.has(combination)) {
      throw new Error(`Duplicate variant: ${pairs.map((p) => p.value).join(" / ")}`);
    }
    combinations.add(combination);
    if (variant.sku) {
      const skuKey = variant.sku.toLowerCase();
      if (skus.has(skuKey)) throw new Error(`Duplicate SKU: ${variant.sku}`);
      skus.add(skuKey);
    }
    pairsByIndex.push(pairs);
  }

  const colorOption = options.find((o) => o.type === "color");
  const sizeOption = options.find((o) => o.type === "size");

  const result = cleaned.map((variant, index) => {
    const pairs = pairsByIndex[index] ?? [];
    const colorPair = pairs.find((p) => p.name === colorOption?.name);
    const sizePair = pairs.find((p) => p.name === sizeOption?.name);
    // A product may have no colour at all (prints/posters): keep it empty
    // instead of inventing a "Default" colour that would show up as a swatch.
    const colorName = variant.colorName || colorPair?.value || "";
    const size = variant.size || sizePair?.value || "One size";
    const colorHex =
      variant.colorHex ||
      colorOption?.values.find((v) => v.value === colorName)?.swatchHex ||
      "#000000";
    return { ...variant, colorName, colorHex, size, optionPairs: pairs };
  });

  return { options, variants: result };
}

export type ImageDraft = {
  mediaId: string;
  colorName?: string | null;
  alt?: string | null;
  isPrimary?: boolean;
  sort?: number;
};

/** Validate image/color links and guarantee exactly one primary per color. */
export function normalizeImages(
  images: ImageDraft[],
  options: OptionDraft[],
): Array<{
  mediaId: string;
  colorName: string | null;
  alt: string | null;
  isPrimary: boolean;
  sort: number;
}> {
  if (images.length > 30) throw new Error("A product can have at most 30 images");
  const colorOption = options.find((o) => o.type === "color");
  const colorValues = new Set((colorOption?.values ?? []).map((v) => v.value.toLowerCase()));

  const normalized = images.map((image, index) => {
    const mediaId = clean(image.mediaId);
    if (!mediaId) throw new Error("Every image needs a media file");
    const colorName = clean(image.colorName) || null;
    if (colorName) {
      if (!colorOption) throw new Error("Add a Color option before assigning images to a color");
      if (!colorValues.has(colorName.toLowerCase())) {
        throw new Error(`Image color "${colorName}" is not a ${colorOption.name} value`);
      }
    }
    return {
      mediaId,
      colorName,
      alt: clean(image.alt) || null,
      isPrimary: !!image.isPrimary,
      sort: Number.isInteger(image.sort) ? Number(image.sort) : index,
    };
  });

  const groups = new Map<string, typeof normalized>();
  for (const image of normalized) {
    const key = image.colorName ?? "";
    const list = groups.get(key) ?? [];
    list.push(image);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    const primaryIndex = list.findIndex((image) => image.isPrimary);
    list.forEach((image, index) => {
      image.isPrimary = index === (primaryIndex >= 0 ? primaryIndex : 0);
    });
  }

  return normalized;
}
