import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { apiKeyAuth } from "../../../../../utils/infrastructure/middleware/apiKeyAuth.js";
import type { Dependencies } from "../../../../../wiring.js";
import { getPlatformMovementBreakdownRoute } from "./getPlatformMovementBreakdown/handler.js";

/**
 * Platform-scoped analytics. Unlike the per-wallet analytics under
 * `/wallets/:walletId/analytics/*`, these aggregate across every wallet of the
 * authenticated platform (scope comes from the API key, never a path param).
 * Mounted at `/v1/analytics`.
 */
export function analyticsRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.prisma);

  router.get("/movement-breakdown", auth, ...getPlatformMovementBreakdownRoute(deps.queryBus));

  return router;
}
