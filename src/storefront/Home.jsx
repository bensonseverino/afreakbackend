import { Link } from "react-router";
import { useHome } from "../hooks/useStorefront";
import { ErrorState, Spinner } from "../components/ui";
import { ProductCard, SectionHeading } from "./components";

function Hero({ slide }) {
  return (
    <section className="relative flex min-h-[70vh] items-end overflow-hidden bg-ink text-paper">
      {slide?.image ? (
        <img
          src={slide.image.url}
          alt={slide.image.alt || slide.title}
          className="absolute inset-0 h-full w-full object-cover opacity-80"
        />
      ) : (
        <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,#161618_0px,#161618_12px,#1e1e21_12px,#1e1e21_24px)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
      <div className="relative mx-auto w-full max-w-[1440px] px-4 pb-14 pt-24 sm:px-6 sm:pb-20">
        {slide?.eyebrow && <p className="label mb-4 text-paper/70">{slide.eyebrow}</p>}
        <h1 className="max-w-[18ch] font-display text-[38px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[64px] lg:text-[80px]">
          {slide?.title || "Built for the ones who move different"}
        </h1>
        {slide?.subtitle && (
          <p className="mt-5 max-w-[46ch] text-[14px] leading-relaxed text-paper/80">{slide.subtitle}</p>
        )}
        <Link
          to={slide?.ctaUrl || "/shop"}
          className="label mt-8 inline-block bg-paper px-7 py-4 text-ink hover:bg-volt"
        >
          {slide?.ctaLabel || "Shop now"}
        </Link>
      </div>
    </section>
  );
}

function Showcase({ item }) {
  if (!item) return null;
  const image = item.image ?? item.colors?.find((color) => color.image)?.image ?? null;
  return (
    <section className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
      <div className="grid items-stretch gap-8 md:grid-cols-2">
        <Link to={`/product/${item.slug}`} className="block aspect-[4/3] overflow-hidden bg-mist md:aspect-auto">
          {image ? (
            <img src={image.url} alt={image.alt || item.name} className="h-full w-full object-cover" />
          ) : null}
        </Link>
        <div className="flex flex-col justify-center border border-line p-6 sm:p-10">
          <p className="label mb-4 text-stone">The piece</p>
          <h2 className="font-display text-[28px] font-extrabold uppercase leading-tight tracking-tight sm:text-[38px]">
            {item.name}
          </h2>
          {item.shortDescription && (
            <p className="mt-4 text-[14px] leading-relaxed text-graphite">{item.shortDescription}</p>
          )}
          {Array.isArray(item.features) && item.features.length > 0 && (
            <ul className="mt-6 space-y-2">
              {item.features.slice(0, 4).map((feature, index) => (
                <li key={index} className="flex gap-3 text-[13px] text-graphite">
                  <span className="mt-[7px] h-px w-4 shrink-0 bg-ink" />
                  {String(feature.title ?? feature.label ?? feature.text ?? feature)}
                </li>
              ))}
            </ul>
          )}
          <Link
            to={`/product/${item.slug}`}
            className="label mt-8 inline-block border border-ink px-6 py-4 hover:bg-ink hover:text-paper"
          >
            View product
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const home = useHome();

  if (home.isLoading) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-20 sm:px-6">
        <Spinner label="Loading the collection" />
      </div>
    );
  }
  if (home.error) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-20">
        <ErrorState error={home.error} onRetry={home.refetch} />
      </div>
    );
  }

  const data = home.data ?? {};
  const heroSlides = data.heroSlides ?? [];
  const featured = data.featured ?? [];
  const newArrivals = data.newArrivals ?? [];
  const lookbook = data.lookbook ?? [];

  return (
    <div>
      <Hero slide={heroSlides[0]} />

      {featured.length > 0 && (
        <section className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
          <SectionHeading
            eyebrow="Selected"
            title="Featured"
            action={
              <Link to="/shop" className="label border-b border-ink pb-1 hover:opacity-70">
                All products
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {featured.slice(0, 4).map((card) => (
              <ProductCard key={card.id} card={card} />
            ))}
          </div>
        </section>
      )}

      <Showcase item={data.showcase} />

      {newArrivals.length > 0 && (
        <section className="border-y border-line bg-mist">
          <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
            <SectionHeading
              eyebrow="Just landed"
              title="New arrivals"
              action={
                <Link to="/shop?new=1" className="label border-b border-ink pb-1 hover:opacity-70">
                  See all
                </Link>
              }
            />
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {newArrivals.slice(0, 4).map((card) => (
                <ProductCard key={card.id} card={card} />
              ))}
            </div>
          </div>
        </section>
      )}

      {lookbook.length > 0 && (
        <section className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
          <SectionHeading eyebrow="Lookbook" title="In the wild" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {lookbook.slice(0, 4).map((item) => (
              <figure key={item.id} className="bg-mist">
                {item.linkUrl ? (
                  <Link to={item.linkUrl} className="block aspect-square overflow-hidden">
                    {item.image && (
                      <img
                        src={item.image.url}
                        alt={item.image.alt || item.caption || ""}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.02]"
                      />
                    )}
                  </Link>
                ) : (
                  <div className="aspect-square overflow-hidden">
                    {item.image && (
                      <img
                        src={item.image.url}
                        alt={item.image.alt || item.caption || ""}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                )}
                {item.caption && <figcaption className="px-1 py-2 text-[12px] text-stone">{item.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </section>
      )}

      {data.shippingBanner?.title && (
        <section className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-4 border border-ink px-6 py-10 sm:flex-row sm:items-center">
            <div>
              <p className="font-display text-[22px] font-extrabold uppercase tracking-tight">
                {data.shippingBanner.title}
              </p>
              {data.shippingBanner.subtitle && (
                <p className="mt-1 text-[13px] text-graphite">{data.shippingBanner.subtitle}</p>
              )}
            </div>
            <Link
              to={data.shippingBanner.ctaUrl || "/shop"}
              className="label bg-ink px-6 py-4 text-paper hover:bg-graphite"
            >
              {data.shippingBanner.ctaLabel || "Shop now"}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
