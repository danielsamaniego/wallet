import type { MiddlewareHandler } from "hono";
import type { HonoVariables } from "../../shared/adapters/kernel/hono.context.js";
import type { AppContext } from "../../shared/domain/kernel/context.js";
import type { IIDGenerator } from "../../shared/domain/kernel/id.generator.js";
import { CanonicalAccumulator } from "../../shared/domain/observability/canonical.js";
import type { ILogger } from "../../shared/domain/observability/logger.port.js";

const canonicalDispatchMsg = "Canonical log | request completed";
const TRACKING_HEADER = "x-tracking-id";

/**
 * Hono middleware that injects tracking_id, canonical accumulator,
 * and request start time into context, and dispatches the canonical log on exit.
 *
 * If the request includes an X-Tracking-Id header, that value is used with
 * an "ext-" prefix to indicate it originated externally. Otherwise a new
 * UUID v7 is generated.
 *
 * Runs first in the middleware chain so all subsequent handlers have tracking context.
 */
export function trackingCanonical(
  idGen: IIDGenerator,
  logger: ILogger,
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const externalId = c.req.header(TRACKING_HEADER);
    const trackingId = externalId ? `ext-${externalId}` : idGen.newId();
    const startTs = Date.now();
    const canonical = new CanonicalAccumulator();

    c.set("trackingId", trackingId);
    c.set("startTs", startTs);
    c.set("canonical", canonical);

    // Build a proper AppContext for the canonical dispatch.
    // platformId is not yet available (set later by apiKeyAuth route middleware).
    const ctx: AppContext = { trackingId, startTs, canonical };

    try {
      await next();
    } finally {
      // Re-read platformId from Hono context in case apiKeyAuth set it during handler execution.
      const finalCtx: AppContext = {
        ...ctx,
        platformId: c.get("platformId"),
      };
      logger.dispatchCanonicalInfo(finalCtx, canonicalDispatchMsg);
    }
  };
}
