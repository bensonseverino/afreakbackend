const BASE = import.meta.env.VITE_API_BASE ?? "";

/**
 * Thin fetch wrapper for the AFREAK JSON API.
 * Throws an Error carrying { status, code, fields } on failure.
 */
export async function api(path, { method = "GET", body, signal, headers } = {}) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  const res = await fetch(`${BASE}/api${path}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: isForm
      ? headers
      : { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: isForm ? body : body != null ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || "Request failed");
    err.status = res.status;
    err.code = json?.error?.code;
    err.fields = json?.error?.fields;
    throw err;
  }
  return json;
}
