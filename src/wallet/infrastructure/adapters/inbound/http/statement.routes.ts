import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { apiKeyAuth } from "../../../../../utils/infrastructure/middleware/apiKeyAuth.js";
import type { Dependencies } from "../../../../../wiring.js";
import { getMovementStatementRoute } from "./getMovementStatement/handler.js";

/**
 * Platform-scoped statement lookups. Unlike the per-wallet statement under
 * `/wallets/:walletId/statement/*`, this resolves a movement without knowing
 * its wallet (scope comes from the API key). Mounted at `/v1/statement`.
 */
export function statementRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.prisma);

  router.get("/:movementId", auth, ...getMovementStatementRoute(deps.queryBus));

  return router;
}
