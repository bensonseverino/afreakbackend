/** URL-safe slugs derived from free text. */
export function slugify(input: string): string {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Slug + short random suffix, for guaranteed uniqueness. */
export function uniqueSlug(input: string, suffix = 4): string {
  const base = slugify(input) || "item";
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, suffix);
  return `${base}-${rand}`;
}
