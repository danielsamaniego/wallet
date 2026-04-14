import type { AppContext } from "@/utils/kernel/context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";

const DEFAULT_TRACKING_ID = "test-tracking-id";
const DEFAULT_START_TS = 1700000000000;

export function createTestContext(overrides?: Partial<AppContext>): AppContext {
  return {
    trackingId: DEFAULT_TRACKING_ID,
    startTs: DEFAULT_START_TS,
    canonical: new CanonicalAccumulator(),
    ...overrides,
  };
}
