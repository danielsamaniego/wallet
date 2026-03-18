import type { Context } from "hono";
import type { CanonicalAccumulator } from "../observability/canonical.js";

/**
 * RequestContext carries request-scoped data through app and domain layers.
 * In Hono, the HTTP layer uses c.set()/c.get() (typed via HonoVariables).
 * App and domain handlers receive this plain object instead, keeping them
 * framework-independent.
 */
export interface RequestContext {
  readonly trackingId: string;
  readonly platformId?: string;
  readonly startTs: number;
  readonly canonical: CanonicalAccumulator;
}

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
 * Builds a RequestContext from Hono's context variables.
 * Use this in HTTP handlers to create the context passed to app/domain layers.
 * Avoids repeating c.get() boilerplate in every handler.
 */
export function buildRequestContext(c: Context<{ Variables: HonoVariables }>): RequestContext {
  return {
    trackingId: c.get("trackingId"),
    startTs: c.get("startTs"),
    canonical: c.get("canonical"),
    platformId: c.get("platformId"),
  };
}
