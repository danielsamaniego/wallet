import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { apiKeyAuth } from "../../../../../utils/infrastructure/middleware/apiKeyAuth.js";
import type { Dependencies } from "../../../../../wiring.js";
import { searchMovementsRoute } from "./searchMovements/handler.js";

/**
 * Platform-scoped, cross-wallet movement routes (not nested under a wallet).
 * Mounted at /v1/movements.
 */
export function movementRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.prisma);

  router.get("/search", auth, ...searchMovementsRoute(deps.queryBus));

  return router;
}
