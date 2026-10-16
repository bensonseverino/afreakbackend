import type { Context } from "hono";
import type { ZodType, ZodError } from "zod";
import type { AppEnv } from "../env";
import { ApiError } from "./http";

/** Maximum accepted JSON body size (bytes) — guards against abuse. */
export const MAX_JSON_BYTES = 100 * 1024;

/** Turn a ZodError into an `{ field: message }` map for inline form errors. */
export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/** Parse + validate a JSON request body, raising a VALIDATION ApiError on failure. */
export async function parseJson<T>(
  c: Context<AppEnv>,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw ApiError.badRequest("Expected a JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw ApiError.validation(zodFields(parsed.error));
  return parsed.data;
}

/** Parse a query object (all values are strings) against a schema. */
export function parseQuery<T, Q extends Record<string, string>>(
  query: Q,
  schema: ZodType<T>,
): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success) throw ApiError.validation(zodFields(parsed.error));
  return parsed.data;
}

/** Strip control characters and trim, with a hard length cap. */
export function cleanText(value: unknown, maxLength = 5000): string {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

/** Enforce the JSON body limit by reading the raw body once. */
export async function readJsonWithLimit(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw ApiError.badRequest("Malformed JSON");
  }
}
