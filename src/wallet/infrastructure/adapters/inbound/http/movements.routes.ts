import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { apiKeyAuth } from "../../../../../utils/infrastructure/middleware/apiKeyAuth.js";
import type { Dependencies } from "../../../../../wiring.js";
import { getMovementRoute } from "./getMovement/handler.js";

export function movementRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.prisma);

  router.get("/:movementId", auth, ...getMovementRoute(deps.queryBus));

  return router;
}
