import { useState } from "react";
import { Link } from "react-router";
import { formatPrice } from "../lib/format";
import { useStore } from "./context";

/**
 * Price in the store currency. `from` renders the range opener ("From KES …")
 * used by cards and by products whose sizes are priced differently.
 */
export function Price({
  cents,
  compareAtCents = null,
  from = false,
  className = "",
  size = "md",
}) {
  const { currency, locale } = useStore();
  const sizes = {
    sm: "text-[13px]",
    md: "text-[15px]",
    lg: "text-[22px]",
  };
  const onSale = compareAtCents != null && cents != null && compareAtCents > cents;
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-2 ${sizes[size]} ${className}`}>
      <span className="font-medium tabular-nums">
        {from && <span className="mr-1 text-[12px] font-normal text-stone">From </span>}
        {formatPrice(cents ?? 0, currency, locale)}
      </span>
      {onSale && (
        <span className="text-[12px] text-stone line-through tabular-nums">
          {formatPrice(compareAtCents, currency, locale)}
        </span>
      )}
    </span>
  );
}

export function SectionHeading({ eyebrow, title, action }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="label mb-2 text-stone">{eyebrow}</p>}
        <h2 className="font-display text-[22px] font-extrabold uppercase tracking-tight sm:text-[28px]">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

/**
 * Catalogue card driven by the public card contract:
 * `priceCents`/`priceToCents`/`hasPriceRange`, `colors[]` each with its own
 * image, `sizeType` and `soldOut`.
 */
export function ProductCard({ card }) {
  const [activeSlug, setActiveSlug] = useState(null);
  const colors = card.colors ?? [];
  const active = colors.find((color) => color.slug === activeSlug) ?? null;
  const image = active?.image ?? card.image ?? colors.find((color) => color.image)?.image ?? null;

  const to = active ? `/product/${card.slug}?color=${active.slug}` : `/product/${card.slug}`;
  const badge = card.soldOut ? "Sold out" : card.isNew ? "New" : card.sizeType === "print" ? "Print" : null;

  return (
    <div className="group">
      <Link to={to} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-mist">
          {image ? (
            <img
              src={image.url}
              alt={image.alt || card.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-stone">No image</div>
          )}
          {badge && (
            <span
              className={`label absolute left-2 top-2 px-2 py-1 ${
                card.soldOut ? "bg-ink text-paper" : "bg-paper text-ink"
              }`}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="pt-3">
          <p className="text-[13px] leading-snug">{card.name}</p>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-stone">
            <Price
              cents={card.priceCents}
              compareAtCents={card.hasPriceRange ? null : card.oldPriceCents}
              from={card.hasPriceRange}
              size="sm"
              className="text-ink"
            />
            {card.reviewCount > 0 && (
              <span className="ml-auto whitespace-nowrap">
                ★ {Number(card.rating).toFixed(1)} ({card.reviewCount})
              </span>
            )}
          </div>
        </div>
      </Link>

      {colors.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {colors.map((color) => {
            const selected = color.slug === (active?.slug ?? "");
            return (
              <button
                key={color.slug}
                type="button"
                title={color.name}
                aria-label={`Show ${color.name}`}
                aria-pressed={selected}
                onMouseEnter={() => setActiveSlug(color.slug)}
                onFocus={() => setActiveSlug(color.slug)}
                onMouseLeave={() => setActiveSlug(null)}
                onBlur={() => setActiveSlug(null)}
                onClick={(event) => {
                  event.preventDefault();
                  setActiveSlug(color.slug);
                }}
                className={`h-3.5 w-3.5 border ${
                  selected ? "border-ink" : "border-line hover:border-stone"
                }`}
                style={{ backgroundColor: color.hex || "#0b0b0c" }}
              />
            );
          })}
          <span className="ml-1 text-[11px] text-stone">
            {colors.length} colours
          </span>
        </div>
      )}
    </div>
  );
}

export function ProductGrid({ cards, className = "" }) {
  return (
    <div className={`grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 ${className}`}>
      {cards.map((card) => (
        <ProductCard key={card.id} card={card} />
      ))}
    </div>
  );
}
