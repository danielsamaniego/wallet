import type { Context } from "hono";
import { createFactory } from "hono/factory";
import type { AppContext } from "../kernel/context.js";
import type { CanonicalAccumulator } from "../kernel/observability/canonical.js";

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

export const handlerFactory = createFactory<{ Variables: HonoVariables }>();

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
