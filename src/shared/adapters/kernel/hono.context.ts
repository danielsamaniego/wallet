import type { Context } from "hono";
import type { AppContext } from "../../domain/kernel/context.js";
import type { CanonicalAccumulator } from "../../domain/observability/canonical.js";

/**
 * Hono context variable types. Used with Hono<{ Variables: HonoVariables }>.
 * Maps to the kernel context keys used by middleware (trackingId, platformId, etc.).
 */
export type HonoVariables = {
  trackingId: string;
  platformId: string | undefined;
  startTs: number;
  canonical: CanonicalAccumulator;
};

/**
 * Builds an AppContext from Hono's context variables.
 * Use this in HTTP handlers to create the context passed to app/domain layers.
 * Avoids repeating c.get() boilerplate in every handler.
 */
export function buildAppContext(c: Context<{ Variables: HonoVariables }>): AppContext {
  return {
    trackingId: c.get("trackingId"),
    startTs: c.get("startTs"),
    canonical: c.get("canonical"),
    platformId: c.get("platformId"),
  };
}
