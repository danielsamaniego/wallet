import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { ErrorKind } from "../../kernel/appError.js";

/**
 * Zod schema for the standard error response shape.
 * Reuse across all endpoint schemas for OpenAPI documentation.
 */
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

const kindStatus: Record<ErrorKind, ContentfulStatusCode> = {
  [ErrorKind.Validation]: 400,
  [ErrorKind.Unauthorized]: 401,
  [ErrorKind.Forbidden]: 403,
  [ErrorKind.NotFound]: 404,
  [ErrorKind.Conflict]: 409,
  [ErrorKind.DomainRule]: 422,
  [ErrorKind.Internal]: 500,
};

/**
 * Maps ErrorKind to HTTP status code.
 */
export function httpStatus(kind: ErrorKind): ContentfulStatusCode {
  return kindStatus[kind] ?? 500;
}

/**
 * Builds a structured JSON error response.
 * Single source of truth for the error shape — used by middleware
 * (apiKeyAuth, idempotency, validationHook) and by the global onError handler.
 */
export function errorResponse(
  c: Context,
  code: string,
  message: string,
  status: ContentfulStatusCode,
): Response {
  return c.json({ error: code, message }, status);
}

/**
 * Shared validation hook for hono-openapi validator.
 * Returns a structured 400 response when validation fails.
 */
// biome-ignore lint/suspicious/noExplicitAny: reusable hook across all zValidator schemas
export const validationHook = (result: any, c: Context) => {
  if (!result.success) {
    return errorResponse(c, "INVALID_REQUEST", result.error.message, 400);
  }
};
