import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useProduct } from "../hooks/useStorefront";
import { ErrorState, Spinner } from "../components/ui";
import { formatPrice } from "../lib/format";
import { useCart, useStore } from "./context";
import { Price, ProductCard, SectionHeading } from "./components";

function dimsLabel(dims) {
  if (!dims?.mm) return null;
  return `${dims.mm[0]} × ${dims.mm[1]} mm`;
}

function featureLabel(feature) {
  if (feature == null) return "";
  if (typeof feature === "string") return feature;
  return feature.title ?? feature.label ?? feature.text ?? "";
}

function Related({ title, cards }) {
  if (!cards?.length) return null;
  return (
    <section className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6">
      <SectionHeading title={title} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {cards.slice(0, 4).map((card) => (
          <ProductCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

export default function Product() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const requestedColor = searchParams.get("color") ?? null;
  const productQuery = useProduct(slug);
  const product = productQuery.data;
  const cart = useCart();
  const { currency, locale, settings } = useStore();

  const [colorSlug, setColorSlug] = useState(requestedColor);
  const [size, setSize] = useState(null);
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    setColorSlug(requestedColor);
    setSize(null);
    setQty(1);
  }, [slug, requestedColor]);

  useEffect(() => {
    if (product?.name) document.title = `${product.name} — AFREAK`;
    return () => {
      document.title = "AFREAK";
    };
  }, [product?.name]);

  const colors = useMemo(() => product?.colors ?? [], [product]);
  const variants = useMemo(() => product?.variants ?? [], [product]);

  const selectedColor = useMemo(() => {
    if (!product) return null;
    const requested = colors.find((color) => color.slug === colorSlug);
    if (requested) return requested;
    const withStock = colors.find((color) =>
      variants.some(
        (variant) =>
          variant.isActive &&
          variant.colorName === color.name &&
          (!variant.trackStock || variant.stock > 0),
      ),
    );
    return withStock ?? colors[0] ?? null;
  }, [product, colors, variants, colorSlug]);

  /** Every size in the product, with the variant/price for the chosen colour. */
  const sizeRows = useMemo(() => {
    if (!product) return [];
    const sizeList =
      (product.sizes ?? []).length > 0
        ? product.sizes
        : Array.from(new Set(variants.map((variant) => variant.size))).map((label) => ({
            label,
            dims: null,
          }));
    const colorName = selectedColor?.name ?? "";
    return sizeList.map((entry) => {
      const variant =
        variants.find(
          (candidate) =>
            candidate.isActive &&
            candidate.size === entry.label &&
            (colors.length === 0 || candidate.colorName === colorName),
        ) ?? null;
      const missingPrice = product.sizeType === "print" && variant != null && !variant.hasOwnPrice;
      const soldOut = !variant || (variant.trackStock && variant.stock <= 0);
      return {
        label: entry.label,
        dims: entry.dims ?? null,
        variant,
        price: variant && !missingPrice ? variant.priceCents : null,
        missingPrice,
        soldOut,
        disabled: soldOut || missingPrice,
      };
    });
  }, [product, selectedColor, variants, colors.length]);

  const chosen =
    sizeRows.find((row) => row.label === size) ?? sizeRows.find((row) => !row.disabled) ?? sizeRows[0] ?? null;

  const gallery = useMemo(() => {
    const images = product?.images ?? [];
    if (!selectedColor) return images;
    const own = images.filter(
      (image) =>
        (selectedColor.id != null && image.colorId === selectedColor.id) ||
        (image.colorName && image.colorName === selectedColor.name),
    );
    const shared = images.filter((image) => image.colorId == null && !image.colorName);
    if (own.length) return [...own, ...shared.filter((image) => !own.includes(image))];
    return shared.length ? shared : images;
  }, [product, selectedColor]);

  useEffect(() => {
    setActiveImage(0);
  }, [selectedColor?.slug]);

  if (productQuery.isLoading) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-20 sm:px-6">
        <Spinner label="Loading product" />
      </div>
    );
  }
  if (productQuery.error) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-20">
        <ErrorState error={productQuery.error} onRetry={productQuery.refetch} />
      </div>
    );
  }
  if (!product) return null;

  const current = gallery[Math.min(activeImage, Math.max(0, gallery.length - 1))] ?? null;
  const maxQty = chosen?.variant?.trackStock
    ? Math.max(1, Math.min(chosen.variant.stock, 10))
    : 10;
  const canAdd = !!chosen?.variant && !chosen.disabled && product.purchasable !== false;
  const threshold = settings?.shipping?.thresholdCents ?? null;

  const addToCart = () => {
    if (!canAdd) return;
    cart.add(
      {
        variantId: chosen.variant.id,
        slug: product.slug,
        name: product.name,
        colorName: selectedColor?.name ?? "",
        size: chosen.label,
        sizeType: product.sizeType,
        priceCents: chosen.price,
        currency: product.currency ?? currency,
        image: gallery[0]?.url ?? null,
        maxQty: chosen.variant.trackStock ? chosen.variant.stock : null,
      },
      qty,
    );
  };

  const statusMessage = (() => {
    if (!sizeRows.length) return "This product has no sizes configured yet.";
    if (chosen?.missingPrice) return "This size is not priced yet — check back soon.";
    if (chosen?.soldOut) return "This size is sold out.";
    if (product.sizeType === "print" && product.purchasable === false)
      return "Print sizes are not fully priced yet, so online ordering is paused.";
    if (chosen?.variant?.trackStock && chosen.variant.stock > 0 && chosen.variant.stock <= 3)
      return `Only ${chosen.variant.stock} left in ${chosen.label}.`;
    return null;
  })();

  return (
    <div>
      <div className="mx-auto max-w-[1440px] px-4 pt-6 sm:px-6">
        <nav className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-stone">
          <Link to="/shop" className="hover:text-ink">
            Shop
          </Link>
          {product.category && (
            <>
              <span>/</span>
              <Link to={`/shop?category=${product.category.slug}`} className="hover:text-ink">
                {product.category.name}
              </Link>
            </>
          )}
          <span>/</span>
          <span className="text-graphite">{product.name}</span>
        </nav>
      </div>

      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-14 lg:py-12">
        {/* Gallery — driven by the selected colour */}
        <div>
          <div className="relative aspect-[4/5] overflow-hidden bg-mist">
            {current ? (
              <img
                src={current.url}
                alt={current.alt || `${product.name}${selectedColor ? ` in ${selectedColor.name}` : ""}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-stone">No image</div>
            )}
          </div>
          {gallery.length > 1 && (
            <div className="mt-2 grid grid-cols-5 gap-2">
              {gallery.slice(0, 10).map((image, index) => (
                <button
                  key={`${image.url}-${index}`}
                  onClick={() => setActiveImage(index)}
                  aria-label={`View image ${index + 1}`}
                  aria-pressed={index === activeImage}
                  className={`aspect-square overflow-hidden border bg-mist ${
                    index === activeImage ? "border-ink" : "border-transparent hover:border-line"
                  }`}
                >
                  <img src={image.url} alt={image.alt || ""} loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buy panel */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          {product.isNew && <span className="label mb-3 inline-block bg-ink px-2 py-1 text-paper">New</span>}
          <h1 className="font-display text-[28px] font-extrabold uppercase leading-tight tracking-tight sm:text-[34px]">
            {product.name}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-[12px] text-stone">
            {product.rating?.count > 0 && (
              <span>
                ★ {Number(product.rating.average).toFixed(1)} ({product.rating.count})
              </span>
            )}
            {product.sizeType === "print" && <span className="uppercase tracking-[0.08em]">Print · A-series</span>}
          </div>

          <div className="mt-4">
            <Price
              cents={chosen?.price ?? product.priceCents}
              compareAtCents={chosen?.variant?.oldPriceCents ?? (chosen ? null : product.oldPriceCents)}
              from={!chosen && product.hasPriceRange}
              size="lg"
            />
            {product.sizeType === "print" && chosen && (
              <p className="mt-1 text-[12px] text-stone">Price for {chosen.label}</p>
            )}
          </div>

          {product.shortDescription && (
            <p className="mt-4 text-[14px] leading-relaxed text-graphite">{product.shortDescription}</p>
          )}

          {colors.length > 0 && (
            <div className="mt-7">
              <div className="mb-3 flex items-baseline justify-between">
                <p className="label text-stone">Colour</p>
                <p className="text-[12px] text-graphite">{selectedColor?.name}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {colors.map((color) => {
                  const active = color.slug === selectedColor?.slug;
                  return (
                    <button
                      key={color.slug}
                      onClick={() => {
                        setColorSlug(color.slug);
                        setSize(null);
                        setQty(1);
                      }}
                      aria-pressed={active}
                      title={color.name}
                      className={`flex items-center gap-2 border px-2 py-1.5 ${
                        active ? "border-ink" : "border-line hover:border-stone"
                      }`}
                    >
                      <span
                        className="h-4 w-4 border border-line"
                        style={{ backgroundColor: color.hex || "#0b0b0c" }}
                      />
                      <span className="text-[12px] text-graphite">{color.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-7">
            <div className="mb-3 flex items-baseline justify-between">
              <p className="label text-stone">
                {product.sizeType === "print" ? "Print size" : "Size"}
              </p>
              <Link
                to={`/size-guide?product=${product.slug}`}
                className="text-[12px] underline hover:text-stone"
              >
                View size guide
              </Link>
            </div>

            {sizeRows.length === 0 ? (
              <p className="text-[13px] text-stone">Sizes are being added.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {sizeRows.map((row) => {
                  const active = row.label === chosen?.label;
                  return (
                    <button
                      key={row.label}
                      disabled={row.disabled}
                      onClick={() => {
                        setSize(row.label);
                        setQty(1);
                      }}
                      aria-pressed={active}
                      className={`flex flex-col items-center justify-center gap-1 border px-2 py-2.5 text-center ${
                        active
                          ? "border-ink bg-ink text-paper"
                          : row.disabled
                            ? "border-line bg-mist text-stone line-through"
                            : "border-line text-graphite hover:border-ink"
                      }`}
                    >
                      <span className="text-[13px] font-medium uppercase">{row.label}</span>
                      {dimsLabel(row.dims) && (
                        <span className={`text-[10px] ${active ? "text-paper/70" : "text-stone"}`}>
                          {dimsLabel(row.dims)}
                        </span>
                      )}
                      {product.sizeType === "print" && (
                        <span className={`text-[11px] tabular-nums ${active ? "text-paper" : "text-stone"}`}>
                          {row.missingPrice
                            ? "—"
                            : row.price != null
                              ? formatPrice(row.price, product.currency ?? currency, locale)
                              : "Sold out"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-7 flex items-stretch gap-3">
            <div className="flex items-center border border-line">
              <button
                className="h-12 w-11 text-[16px] text-graphite disabled:text-stone"
                onClick={() => setQty((value) => Math.max(1, value - 1))}
                disabled={qty <= 1}
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="w-8 text-center text-[14px] tabular-nums">{qty}</span>
              <button
                className="h-12 w-11 text-[16px] text-graphite disabled:text-stone"
                onClick={() => setQty((value) => Math.min(maxQty, value + 1))}
                disabled={qty >= maxQty}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <button
              onClick={addToCart}
              disabled={!canAdd}
              className="label flex-1 bg-ink px-6 py-4 text-paper hover:bg-graphite disabled:cursor-not-allowed disabled:bg-line disabled:text-stone"
            >
              {canAdd ? "Add to cart" : chosen?.soldOut ? "Sold out" : "Not available"}
            </button>
          </div>

          {statusMessage && <p className="mt-3 text-[12px] text-stone">{statusMessage}</p>}
          {threshold != null && (
            <p className="mt-4 border-t border-line pt-4 text-[12px] text-stone">
              Free standard shipping on orders over {formatPrice(threshold, product.currency ?? currency, locale)}.
            </p>
          )}

          <div className="mt-8 divide-y divide-line border-y border-line">
            {product.description && (
              <details className="group py-4" open>
                <summary className="label cursor-pointer list-none text-ink">Description</summary>
                <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-graphite">
                  {product.description}
                </p>
              </details>
            )}
            {Array.isArray(product.features) && product.features.length > 0 && (
              <details className="group py-4">
                <summary className="label cursor-pointer list-none text-ink">Details</summary>
                <ul className="mt-3 space-y-2">
                  {product.features.map((feature, index) => (
                    <li key={index} className="flex gap-3 text-[13px] text-graphite">
                      <span className="mt-[7px] h-px w-4 shrink-0 bg-ink" />
                      {featureLabel(feature)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {product.sizeType === "print" && (
              <details className="group py-4">
                <summary className="label cursor-pointer list-none text-ink">Print sizes</summary>
                <ul className="mt-3 space-y-2">
                  {sizeRows.map((row) => (
                    <li key={row.label} className="flex justify-between gap-4 text-[13px] text-graphite">
                      <span className="uppercase">{row.label}</span>
                      <span className="text-stone">{dimsLabel(row.dims) ?? "—"}</span>
                      <span className="ml-auto tabular-nums">
                        {row.price != null
                          ? formatPrice(row.price, product.currency ?? currency, locale)
                          : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </div>

      <Related title="Pair it with" cards={product.pairWith} />
      <Related title="Complete the look" cards={product.accessories} />
    </div>
  );
}
