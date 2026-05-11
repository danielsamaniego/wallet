import type { MiddlewareHandler } from "hono";
import type { HonoVariables } from "../hono.context.js";
import { errorResponse } from "../hono.error.js";

const SIGNATURE_HEADER = "upstash-signature";

/**
 * Structural type that matches the `Receiver` shape from `@upstash/qstash`.
 * Used so the middleware can be unit-tested with a plain mock and so the
 * production wiring depends on this interface, not on the concrete class.
 */
export interface IQStashReceiver {
  verify(args: { signature: string; body: string }): Promise<boolean>;
}

/**
 * Verifies the `Upstash-Signature` JWT against the raw request body using a
 * QStash `Receiver`. On success, stores the raw body in `rawBody` on the Hono
 * context so the downstream handler can re-parse it (the underlying request
 * stream has already been consumed by `c.req.text()` inside this middleware).
 *
 * Failures (missing header, signature mismatch, malformed JWT) collapse to
 * a single `401 INVALID_SIGNATURE` (or `MISSING_SIGNATURE` if absent) and
 * never leak the underlying verifier error.
 */
export function qstashSignature(
  receiver: IQStashReceiver,
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const signature = c.req.header(SIGNATURE_HEADER);
    if (!signature) {
      return errorResponse(c, "MISSING_SIGNATURE", "missing Upstash-Signature header", 401);
    }

    const rawBody = await c.req.text();

    let valid: boolean;
    try {
      valid = await receiver.verify({ signature, body: rawBody });
    } catch {
      return errorResponse(c, "INVALID_SIGNATURE", "signature verification failed", 401);
    }

    if (!valid) {
      return errorResponse(c, "INVALID_SIGNATURE", "signature verification failed", 401);
    }

    c.set("rawBody", rawBody);
    await next();
  };
}
