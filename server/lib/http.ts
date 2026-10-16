import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "OUT_OF_STOCK"
  | "RATE_LIMITED"
  | "CAPTCHA_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL";

/** An error that maps cleanly onto the JSON error envelope. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;

  constructor(
    status: ContentfulStatusCode,
    code: ErrorCode,
    message: string,
    options: { fields?: Record<string, string>; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.details = options.details;
  }

  static badRequest(message = "Bad request"): ApiError {
    return new ApiError(400, "BAD_REQUEST", message);
  }
  static validation(fields: Record<string, string>, message = "Validation failed"): ApiError {
    return new ApiError(400, "VALIDATION", message, { fields });
  }
  static unauthorized(message = "Unauthorized"): ApiError {
    return new ApiError(401, "UNAUTHORIZED", message);
  }
  static forbidden(message = "Forbidden"): ApiError {
    return new ApiError(403, "FORBIDDEN", message);
  }
  static notFound(message = "Not found"): ApiError {
    return new ApiError(404, "NOT_FOUND", message);
  }
  static conflict(
    message = "Conflict",
    options: { code?: ErrorCode; details?: Record<string, unknown> } = {},
  ): ApiError {
    return new ApiError(409, options.code ?? "CONFLICT", message, { details: options.details });
  }
  static rateLimited(message = "Too many requests"): ApiError {
    return new ApiError(429, "RATE_LIMITED", message);
  }
}

/** Success envelope: `{ data, meta? }`. */
export function ok<T>(c: Context<AppEnv>, data: T, meta?: Record<string, unknown>) {
  return c.json(meta ? { data, meta } : { data });
}

export function errorBody(err: ApiError) {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.details ?? {}),
    },
  };
}
