import type { IIDGenerator } from "./id.generator.js";
import type { CanonicalAccumulator } from "../observability/canonical.js";
import { CanonicalAccumulator as CanonicalAccumulatorImpl } from "../observability/canonical.js";

/**
 * AppContext carries request-scoped data through app and domain layers.
 * In Hono, the HTTP layer uses c.set()/c.get() (typed via HonoVariables).
 * App and domain handlers receive this plain object instead, keeping them
 * framework-independent.
 */
export interface AppContext {
  readonly trackingId: string;
  readonly platformId?: string;
  readonly startTs: number;
  readonly canonical: CanonicalAccumulator;
  /**
   * Opaque transactional handle. Architecturally this belongs to the
   * infrastructure layer, but we keep it here as an optional, opaque
   * (`unknown`) slot to avoid threading a second context parameter
   * through every repository method. Repositories inspect this field
   * to decide whether to run inside an active transaction or against
   * the default database client.
   */
  readonly opCtx?: unknown;
}

/**
 * Creates a fresh AppContext with an auto-generated trackingId.
 * Useful outside HTTP requests (jobs, scripts, tests, domain events).
 */
export function createAppContext(idGen: IIDGenerator): AppContext {
  return {
    trackingId: idGen.newId(),
    startTs: Date.now(),
    canonical: new CanonicalAccumulatorImpl(),
  };
}
