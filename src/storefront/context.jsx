import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePublicSettings } from "../hooks/useStorefront";

/* ------------------------------------------------------------------ store */
const StoreCtx = createContext(null);

/**
 * Public store settings for the storefront. Everything money-related reads the
 * configured currency from here so no screen hard-codes KES.
 */
export function StoreProvider({ children }) {
  const { data } = usePublicSettings();
  const value = useMemo(
    () => ({
      settings: data ?? null,
      currency: data?.currency ?? "KES",
      locale: data?.currencyLocale ?? "en-KE",
      freeShippingCents: data?.shipping?.thresholdCents ?? null,
      shipping: data?.shipping ?? { thresholdCents: 1500000, flatCents: 50000, expressCents: 150000 },
    }),
    [data],
  );
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  return (
    useContext(StoreCtx) ?? {
      settings: null,
      currency: "KES",
      locale: "en-KE",
      freeShippingCents: null,
      shipping: { thresholdCents: 1500000, flatCents: 50000, expressCents: 150000 },
    }
  );
}

/* ------------------------------------------------------------------- cart */
const CART_KEY = "afreak:cart:v1";
const CartCtx = createContext(null);

function readStored() {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.variantId && item?.qty > 0) : [];
  } catch {
    return [];
  }
}

function clampQty(qty, maxQty) {
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  return maxQty != null ? Math.min(n, Math.max(1, maxQty)) : Math.min(n, 10);
}

/**
 * Cart lines are keyed by variant id — a print product's A4 and A3 are separate
 * variants, so their per-size prices stay apart. Prices here are for display
 * only; `/api/checkout/quote` and `/api/orders` re-price every line.
 */
export function CartProvider({ children }) {
  const [items, setItems] = useState(readStored);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch {
      /* storage full / disabled — the cart still works for this visit */
    }
  }, [items]);

  const add = useCallback((line, qty = 1) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.variantId === line.variantId);
      if (existing) {
        return prev.map((item) =>
          item.variantId === line.variantId
            ? { ...item, ...line, qty: clampQty(item.qty + qty, line.maxQty ?? item.maxQty) }
            : item,
        );
      }
      return [...prev, { ...line, qty: clampQty(qty, line.maxQty) }];
    });
    setOpen(true);
  }, []);

  const setQty = useCallback((variantId, qty) => {
    setItems((prev) =>
      prev.map((item) =>
        item.variantId === variantId ? { ...item, qty: clampQty(qty, item.maxQty) } : item,
      ),
    );
  }, []);

  const remove = useCallback((variantId) => {
    setItems((prev) => prev.filter((item) => item.variantId !== variantId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const subtotalCents = items.reduce((sum, item) => sum + (item.priceCents ?? 0) * item.qty, 0);

  const value = useMemo(
    () => ({ items, add, setQty, remove, clear, count, subtotalCents, open, setOpen }),
    [items, add, setQty, remove, clear, count, subtotalCents, open],
  );

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
