import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { formatPrice } from "../lib/format";
import { useCart, useStore } from "./context";

const NAV = [
  { label: "Shop", to: "/shop" },
  { label: "New in", to: "/shop?new=1" },
  { label: "Prints", to: "/shop?sizeType=print" },
];

function CartDrawer() {
  const cart = useCart();
  const { currency, locale } = useStore();

  useEffect(() => {
    if (!cart.open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") cart.setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [cart]);

  if (!cart.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/40" onClick={() => cart.setOpen(false)} />
      <aside className="relative flex h-full w-full max-w-[420px] flex-col bg-paper">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <p className="label">Your bag ({cart.count})</p>
          <button className="label text-stone hover:text-ink" onClick={() => cart.setOpen(false)}>
            Close
          </button>
        </div>

        {cart.items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="font-display text-[18px] font-extrabold uppercase">Your bag is empty</p>
            <Link
              to="/shop"
              className="label border border-ink px-5 py-3 hover:bg-ink hover:text-paper"
              onClick={() => cart.setOpen(false)}
            >
              Shop the collection
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5">
              {cart.items.map((item) => (
                <div key={item.variantId} className="flex gap-3 border-b border-line py-4">
                  <Link
                    to={`/product/${item.slug}`}
                    onClick={() => cart.setOpen(false)}
                    className="h-[104px] w-[82px] shrink-0 overflow-hidden bg-mist"
                  >
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                    ) : null}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] leading-snug">{item.name}</p>
                      <span className="whitespace-nowrap text-[13px] tabular-nums">
                        {formatPrice((item.priceCents ?? 0) * item.qty, currency, locale)}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-stone">
                      {[item.colorName, item.size].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex items-center border border-line">
                        <button
                          className="h-8 w-8 text-[14px] text-graphite disabled:text-stone"
                          disabled={item.qty <= 1}
                          onClick={() => cart.setQty(item.variantId, item.qty - 1)}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="w-7 text-center text-[13px] tabular-nums">{item.qty}</span>
                        <button
                          className="h-8 w-8 text-[14px] text-graphite disabled:text-stone"
                          disabled={item.maxQty != null && item.qty >= item.maxQty}
                          onClick={() => cart.setQty(item.variantId, item.qty + 1)}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="text-[11px] uppercase tracking-[0.08em] text-stone underline hover:text-ink"
                        onClick={() => cart.remove(item.variantId)}
                      >
                        Remove
                      </button>
                    </div>
                    {item.maxQty != null && item.qty >= item.maxQty && (
                      <p className="mt-2 text-[11px] text-warn">Only {item.maxQty} left</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-line px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="label text-stone">Subtotal</span>
                <span className="text-[16px] font-medium tabular-nums">
                  {formatPrice(cart.subtotalCents, currency, locale)}
                </span>
              </div>
              <p className="mt-2 text-[12px] text-stone">
                Shipping and any discounts are confirmed at checkout.
              </p>
              <Link
                to="/checkout"
                onClick={() => cart.setOpen(false)}
                className="label mt-4 block bg-ink px-5 py-4 text-center text-paper hover:bg-graphite"
              >
                Checkout
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export default function StorefrontLayout() {
  const cart = useCart();
  const { settings } = useStore();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const promo = settings?.promoBar;

  useEffect(() => {
    window.scrollTo(0, 0);
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {promo?.active && promo.text && (
        <div className="bg-ink px-4 py-2 text-center text-[11px] uppercase tracking-[0.08em] text-paper">
          {promo.text}
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <button
              className="label text-ink lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              Menu
            </button>
            <Link to="/" className="font-display text-[20px] font-extrabold uppercase tracking-tight">
              AFREAK
            </Link>
          </div>

          <nav className="hidden items-center gap-6 lg:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) =>
                  `label ${isActive ? "text-ink" : "text-stone hover:text-ink"}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            className="label flex items-center gap-2 text-ink"
            onClick={() => cart.setOpen(true)}
          >
            Bag
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center border border-ink px-1 text-[10px] font-bold">
              {cart.count}
            </span>
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMenuOpen(false)} />
          <div className="relative flex h-full w-[82%] max-w-[320px] flex-col bg-paper">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <span className="font-display text-[18px] font-extrabold uppercase">AFREAK</span>
              <button className="label text-stone" onClick={() => setMenuOpen(false)}>
                Close
              </button>
            </div>
            <nav className="flex flex-col">
              {NAV.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className="border-b border-line px-5 py-4 font-display text-[18px] font-semibold uppercase"
                >
                  {item.label}
                </Link>
              ))}
              <Link to="/size-guide" onClick={() => setMenuOpen(false)} className="px-5 py-4 text-[13px] text-graphite">
                Size guide
              </Link>
            </nav>
          </div>
        </div>
      )}

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-16 border-t border-line bg-mist">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
          <div>
            <p className="font-display text-[20px] font-extrabold uppercase tracking-tight">AFREAK</p>
            <p className="mt-3 max-w-[280px] text-[13px] leading-relaxed text-graphite">
              {settings?.footer?.blurb || "Technical details meet minimal aesthetics."}
            </p>
          </div>
          <div>
            <p className="label mb-3 text-stone">Shop</p>
            {NAV.map((item) => (
              <Link key={item.label} to={item.to} className="block py-1 text-[13px] hover:underline">
                {item.label}
              </Link>
            ))}
          </div>
          <div>
            <p className="label mb-3 text-stone">Follow</p>
            {Object.entries(settings?.footer?.social ?? {})
              .filter(([, url]) => !!url)
              .map(([network, url]) => (
                <a
                  key={network}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block py-1 text-[13px] capitalize hover:underline"
                >
                  {network}
                </a>
              ))}
            {settings?.store?.email && (
              <a href={`mailto:${settings.store.email}`} className="mt-3 block text-[13px] hover:underline">
                {settings.store.email}
              </a>
            )}
          </div>
        </div>
        <div className="border-t border-line px-4 py-4 text-center text-[11px] uppercase tracking-[0.08em] text-stone sm:px-6">
          © {new Date().getFullYear()} AFREAK · Prices in {settings?.currency ?? "KES"}
        </div>
      </footer>

      <CartDrawer />
    </div>
  );
}
