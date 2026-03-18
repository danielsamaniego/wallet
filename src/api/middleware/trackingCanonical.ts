import type { MiddlewareHandler } from "hono";
import type { HonoVariables, RequestContext } from "../../shared/kernel/context.js";
import type { IDGenerator } from "../../shared/kernel/idGenerator.js";
import { CanonicalAccumulator } from "../../shared/observability/canonical.js";
import type { Logger } from "../../shared/observability/logger.js";

const canonicalDispatchMsg = "Canonical log | request completed";

/**
 * Hono middleware that injects tracking_id (UUID v7), canonical accumulator,
 * and request start time into context, and dispatches the canonical log on exit.
 * Runs first in the middleware chain so all subsequent handlers have tracking context.
 */
export function trackingCanonical(
  idGen: IDGenerator,
  logger: Logger,
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const trackingId = idGen.newId();
    const startTs = Date.now();
    const canonical = new CanonicalAccumulator();

    c.set("trackingId", trackingId);
    c.set("startTs", startTs);
    c.set("canonical", canonical);

    // Build a proper RequestContext for the canonical dispatch.
    // platformId is not yet available (set later by apiKeyAuth route middleware).
    const ctx: RequestContext = { trackingId, startTs, canonical };

    try {
      await next();
    } finally {
      // Re-read platformId from Hono context in case apiKeyAuth set it during handler execution.
      const finalCtx: RequestContext = {
        ...ctx,
        platformId: c.get("platformId"),
      };
      logger.dispatchCanonicalInfo(finalCtx, canonicalDispatchMsg);
    }
  };
}
