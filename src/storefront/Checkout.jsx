import { useRef, useState } from "react";
import { Link } from "react-router";
import { useQuote } from "../hooks/useStorefront";
import { api } from "../lib/api";
import { formatPrice } from "../lib/format";
import { Spinner } from "../components/ui";
import { useCart, useStore } from "./context";

const INPUT =
  "w-full border border-line bg-paper px-3 py-2.5 text-[14px] outline-none focus:border-ink";

const HARD_ISSUES = new Set(["OUT_OF_STOCK", "UNAVAILABLE", "PRICE_MISSING"]);

function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="label mb-2 block text-stone">{label}</span>
      {children}
    </label>
  );
}

export default function Checkout() {
  const cart = useCart();
  const { currency, locale, shipping } = useStore();
  const [deliveryMethod, setDeliveryMethod] = useState("standard");
  const [promoCode, setPromoCode] = useState("");
  const [form, setForm] = useState({
    email: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    postalCode: "",
    country: "Kenya",
    notes: "",
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const idempotencyKey = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `order-${Date.now()}`,
  );

  const items = cart.items.map((item) => ({ variantId: item.variantId, qty: item.qty }));
  const quoteQuery = useQuote({
    items,
    deliveryMethod,
    promoCode: promoCode.trim() || null,
  });
  const quote = quoteQuery.data;
  const hardIssue = quote?.issues?.some((issue) => HARD_ISSUES.has(issue.code)) ?? false;

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!form.email.trim() || !form.email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (!form.line1.trim() || !form.city.trim() || !form.postalCode.trim() || !form.country.trim()) {
      setError("Fill in your delivery address.");
      return;
    }
    if (!items.length) {
      setError("Your bag is empty.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await api("/orders", {
        method: "POST",
        headers: { "X-Idempotency-Key": idempotencyKey.current },
        body: {
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          address: {
            line1: form.line1.trim(),
            line2: form.line2.trim() || undefined,
            city: form.city.trim(),
            postalCode: form.postalCode.trim(),
            country: form.country.trim(),
          },
          deliveryMethod,
          promoCode: promoCode.trim() || null,
          items,
          notes: form.notes.trim() || undefined,
        },
      });
      setResult(response.data);
      cart.clear();
    } catch (err) {
      setError(err.message || "Could not place the order.");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-[620px] px-4 py-20 sm:px-6">
        <p className="label mb-3 text-stone">Order received</p>
        <h1 className="font-display text-[30px] font-extrabold uppercase tracking-tight">
          Thank you
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-graphite">
          Your order <span className="text-ink">{result.number}</span> is confirmed. A receipt is on
          its way to {result.email}.
        </p>
        <div className="mt-6 border border-line p-5">
          <div className="flex justify-between text-[14px]">
            <span className="text-graphite">Total</span>
            <span className="font-medium tabular-nums">
              {formatPrice(result.totalCents, currency, locale)}
            </span>
          </div>
        </div>
        <Link to="/shop" className="label mt-8 inline-block bg-ink px-6 py-4 text-paper hover:bg-graphite">
          Keep shopping
        </Link>
      </div>
    );
  }

  if (!cart.items.length) {
    return (
      <div className="mx-auto max-w-[620px] px-4 py-20 text-center sm:px-6">
        <h1 className="font-display text-[26px] font-extrabold uppercase tracking-tight">
          Your bag is empty
        </h1>
        <p className="mt-3 text-[13px] text-stone">Add something before heading to checkout.</p>
        <Link to="/shop" className="label mt-8 inline-block bg-ink px-6 py-4 text-paper hover:bg-graphite">
          Shop the collection
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 sm:py-14">
      <p className="label mb-2 text-stone">Secure checkout</p>
      <h1 className="font-display text-[30px] font-extrabold uppercase tracking-tight sm:text-[38px]">
        Checkout
      </h1>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={submit} className="space-y-8">
          <section>
            <h2 className="label mb-4 text-ink">Contact</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email">
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => set({ email: event.target.value })}
                  className={INPUT}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Phone (optional)">
                <input
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => set({ phone: event.target.value })}
                  className={INPUT}
                  placeholder="+254 700 000 000"
                />
              </Field>
            </div>
          </section>

          <section>
            <h2 className="label mb-4 text-ink">Delivery address</h2>
            <div className="space-y-3">
              <Field label="Address">
                <input
                  required
                  autoComplete="address-line1"
                  value={form.line1}
                  onChange={(event) => set({ line1: event.target.value })}
                  className={INPUT}
                />
              </Field>
              <Field label="Apartment, suite (optional)">
                <input
                  autoComplete="address-line2"
                  value={form.line2}
                  onChange={(event) => set({ line2: event.target.value })}
                  className={INPUT}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="City">
                  <input
                    required
                    autoComplete="address-level2"
                    value={form.city}
                    onChange={(event) => set({ city: event.target.value })}
                    className={INPUT}
                  />
                </Field>
                <Field label="Postal code">
                  <input
                    required
                    autoComplete="postal-code"
                    value={form.postalCode}
                    onChange={(event) => set({ postalCode: event.target.value })}
                    className={INPUT}
                  />
                </Field>
                <Field label="Country">
                  <input
                    required
                    autoComplete="country-name"
                    value={form.country}
                    onChange={(event) => set({ country: event.target.value })}
                    className={INPUT}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section>
            <h2 className="label mb-4 text-ink">Delivery method</h2>
            <div className="space-y-2">
              {[
                [
                  "standard",
                  "Standard delivery",
                  quote?.freeShippingThresholdCents != null
                    ? `Free over ${formatPrice(quote.freeShippingThresholdCents, currency, locale)}`
                    : "",
                ],
                [
                  "express",
                  "Express delivery",
                  formatPrice(shipping.expressCents, currency, locale),
                ],
              ].map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center justify-between border px-4 py-3 text-[13px] ${
                    deliveryMethod === value ? "border-ink" : "border-line"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="delivery"
                      value={value}
                      checked={deliveryMethod === value}
                      onChange={() => setDeliveryMethod(value)}
                      className="h-3.5 w-3.5 accent-ink"
                    />
                    {label}
                  </span>
                  <span className="text-[12px] text-stone">{hint}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h2 className="label mb-4 text-ink">Order notes (optional)</h2>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => set({ notes: event.target.value })}
              className={INPUT}
            />
          </section>

          {error && <p className="border border-danger px-4 py-3 text-[13px] text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting || hardIssue || !quote}
            className="label w-full bg-ink px-6 py-4 text-paper hover:bg-graphite disabled:cursor-not-allowed disabled:bg-line disabled:text-stone"
          >
            {submitting ? "Placing order…" : "Place order"}
          </button>
          <p className="text-center text-[11px] text-stone">
            Prices are re-checked by the server before your order is created.
          </p>
        </form>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="border border-line p-5">
            <p className="label mb-4 text-stone">Your order</p>

            {quoteQuery.isLoading && <Spinner label="Pricing your bag" />}
            {quoteQuery.error && (
              <p className="text-[13px] text-danger">{quoteQuery.error.message}</p>
            )}

            {quote?.lines?.map((line) => (
              <div key={line.lineId} className="flex gap-3 border-b border-line py-3">
                <div className="h-[72px] w-[58px] shrink-0 overflow-hidden bg-mist">
                  {line.image?.url && (
                    <img src={line.image.url} alt={line.name} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug">{line.name}</p>
                  <p className="mt-1 text-[12px] text-stone">
                    {[line.colorName, line.size].filter(Boolean).join(" · ")} · Qty {line.qty}
                  </p>
                  <p className="mt-1 text-[12px] tabular-nums">
                    {formatPrice(line.unitPriceCents * line.qty, currency, locale)}
                  </p>
                </div>
              </div>
            ))}

            {quote?.issues?.length > 0 && (
              <ul className="mt-3 space-y-1">
                {quote.issues.map((issue) => (
                  <li key={`${issue.lineId}-${issue.code}`} className="text-[12px] text-danger">
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
              <div className="flex items-center gap-2 border-b border-line pb-3">
                <input
                  value={promoCode}
                  onChange={(event) => setPromoCode(event.target.value)}
                  placeholder="Promo code"
                  className="min-w-0 flex-1 border border-line px-3 py-2 text-[13px] outline-none focus:border-ink"
                />
              </div>
              {quote?.promo && (
                <p className={`mt-2 text-[12px] ${quote.promo.valid ? "text-ok" : "text-stone"}`}>
                  {quote.promo.valid
                    ? `${quote.promo.code} applied`
                    : `${quote.promo.code}: ${quote.promo.reason ?? "not valid"}`}
                </p>
              )}
            </div>

            {quote && (
              <div className="mt-4 space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-graphite">Subtotal</span>
                  <span className="tabular-nums">{formatPrice(quote.subtotalCents, currency, locale)}</span>
                </div>
                {quote.discountCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-graphite">Discount</span>
                    <span className="tabular-nums">− {formatPrice(quote.discountCents, currency, locale)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-graphite">Shipping</span>
                  <span className="tabular-nums">
                    {quote.shippingCents === 0
                      ? "Free"
                      : formatPrice(quote.shippingCents, currency, locale)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-[15px] font-medium">
                  <span>Total</span>
                  <span className="tabular-nums">{formatPrice(quote.totalCents, currency, locale)}</span>
                </div>
              </div>
            )}
          </div>
          <p className="mt-3 text-[11px] text-stone">
            Need to change something?{" "}
            <Link to="/shop" className="text-ink underline">
              Keep shopping
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
