import type { Context } from "hono";

import { AppError, ErrorKind } from "../../shared/domain/appError.js";
import type { AppContext } from "../../shared/domain/kernel/context.js";
import type { ILogger } from "../../shared/domain/observability/logger.port.js";

const kindStatus: Record<ErrorKind, number> = {
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
export function httpStatus(kind: ErrorKind): number {
  return kindStatus[kind] ?? 500;
}

/**
 * Inspects err for AppError and writes a structured JSON response.
 * Unknown errors produce 500 with no internal details.
 * Maps AppError Kind → HTTP status; unknown errors produce 500 with no internal details.
 */
export function withError(
  c: Context,
  logger: ILogger,
  ctx: AppContext,
  logTag: string,
  err: unknown,
): Response {
  if (AppError.is(err)) {
    const status = httpStatus(err.kind);
    if (status >= 500) {
      logger.error(ctx, `${logTag} ${err.code}`, { error: err.message });
    } else {
      logger.info(ctx, `${logTag} ${err.code}`);
    }
    return c.json({ error: err.code, message: err.msg }, status as 400);
  }

  const message = err instanceof Error ? err.message : "unknown error";
  logger.error(ctx, `${logTag} unexpected error`, { error: message });
  return c.json({ error: "INTERNAL_ERROR", message: "an unexpected error occurred" }, 500);
}
