/** Size types, presets and print dimensions shared by the API and admin. */
import type { SettingsValues } from "./settings";

export type SizeType = "apparel" | "print" | "one_size";

export const SIZE_TYPES: SizeType[] = ["apparel", "print", "one_size"];

export type SizeDims = { mm: [number, number]; in: [number, number] } | null;

export function isSizeType(value: unknown): value is SizeType {
  return value === "apparel" || value === "print" || value === "one_size";
}

export function sizePresets(settings: SettingsValues): Record<SizeType, string[]> {
  const raw = (settings.size_presets ?? {}) as Record<string, unknown>;
  const list = (value: unknown, fallback: string[]) =>
    Array.isArray(value) && value.length
      ? value.map((v) => String(v)).filter(Boolean)
      : fallback;
  return {
    apparel: list(raw.apparel, ["XS", "S", "M", "L", "XL", "XXL"]),
    print: list(raw.print, ["A4", "A3", "A2"]),
    one_size: list(raw.one_size, ["One size"]),
  };
}

export function sizeMeta(settings: SettingsValues): Record<string, Exclude<SizeDims, null>> {
  const raw = (settings.size_meta ?? {}) as Record<string, unknown>;
  const out: Record<string, Exclude<SizeDims, null>> = {};
  for (const [label, value] of Object.entries(raw)) {
    const v = value as { mm?: unknown; in?: unknown } | null;
    if (!v || !Array.isArray(v.mm) || !Array.isArray(v.in)) continue;
    if (v.mm.length !== 2 || v.in.length !== 2) continue;
    out[label] = {
      mm: [Number(v.mm[0]), Number(v.mm[1])],
      in: [Number(v.in[0]), Number(v.in[1])],
    };
  }
  return out;
}

/**
 * Ordered size list for a product: preset order first, then any custom sizes
 * that exist on variants. `dims` only when size_meta knows the label.
 */
export function sizesFor(
  settings: SettingsValues,
  sizeType: SizeType,
  variantSizes: string[],
): Array<{ label: string; dims: SizeDims }> {
  const presets = sizePresets(settings)[sizeType] ?? [];
  const meta = sizeMeta(settings);
  const present = new Set(variantSizes);
  const ordered: string[] = [];
  for (const label of presets) {
    if (present.has(label) || sizeType === "print") ordered.push(label);
  }
  for (const label of variantSizes) {
    if (!ordered.includes(label)) ordered.push(label);
  }
  return ordered.map((label) => ({ label, dims: meta[label] ?? null }));
}
