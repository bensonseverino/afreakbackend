import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/**
 * Storefront data hooks. Use these in the storefront app (point it at this
 * project's API with VITE_API_BASE) — the admin uses the admin hooks instead.
 */

export function useHome() {
  return useQuery({
    queryKey: ["home"],
    queryFn: () => api("/home").then((r) => r.data),
  });
}

export function useProducts(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== ""),
  ).toString();
  return useQuery({
    queryKey: ["products", params],
    queryFn: () => api(`/products${qs ? `?${qs}` : ""}`).then((r) => r),
    placeholderData: (prev) => prev,
  });
}

export function useProduct(slug) {
  return useQuery({
    queryKey: ["product", slug],
    queryFn: () => api(`/products/${slug}`).then((r) => r.data),
    enabled: !!slug,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api("/categories").then((r) => r.data),
  });
}

export function useReviews(slug, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return useQuery({
    queryKey: ["reviews", slug, params],
    queryFn: () => api(`/products/${slug}/reviews${qs ? `?${qs}` : ""}`).then((r) => r),
    enabled: !!slug,
  });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => api("/settings/public").then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function useQuote(cart) {
  return useQuery({
    queryKey: ["quote", cart],
    queryFn: () => api("/checkout/quote", { method: "POST", body: cart }).then((r) => r.data),
    enabled: !!cart?.items?.length,
  });
}

export function useSubmitReview() {
  return useMutation({
    mutationFn: ({ slug, ...body }) =>
      api(`/products/${slug}/reviews`, { method: "POST", body }),
  });
}

export function useSubmitForm(type) {
  return useMutation({
    mutationFn: (body) => api(`/forms/${type}`, { method: "POST", body }),
  });
}

export function track(type, productId) {
  const payload = JSON.stringify({ type, productId });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
  } else {
    fetch("/api/track", { method: "POST", body: payload, headers: { "Content-Type": "application/json" }, keepalive: true });
  }
}
