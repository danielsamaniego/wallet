import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { qstashSignature } from "../../../../../utils/infrastructure/middleware/qstashSignature.js";
import type { Dependencies } from "../../../../../wiring.js";
import { processMovementRoute } from "./processMovement.handler.js";

/**
 * Internal worker routes invoked by QStash. Mounted at `/internal/worker`
 * (outside the `/v1` API contract). Every route enforces a valid
 * `Upstash-Signature` JWT — there is no API-key auth here.
 *
 * The whole router is mounted only when `deps.qstashReceiver` is wired
 * (i.e. both QSTASH_*_SIGNING_KEY env vars are set). When absent, callers
 * see a 404 — matching the principle that an unconfigured worker should
 * not pretend to be reachable.
 */
export function workerRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();

  if (!deps.qstashReceiver) {
    // No receiver wired → no routes mounted. The parent app still serves
    // 404 for `/internal/worker/*` paths, exactly as for any unknown URL.
    return router;
  }

  const sig = qstashSignature(deps.qstashReceiver);

  router.post(
    "/process-movement",
    sig,
    ...processMovementRoute(deps.commandBus, deps.idGen, deps.logger),
  );

  return router;
}
