import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { apiKeyAuth } from "../../../../../utils/infrastructure/middleware/apiKeyAuth.js";
import type { Dependencies } from "../../../../../wiring.js";
import { listPlatformsRoute } from "./listPlatforms/handler.js";
import { updatePlatformConfigRoute } from "./updatePlatformConfig/handler.js";

export function platformRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();

  router.get("/", ...listPlatformsRoute(deps.queryBus));
  router.patch("/config", apiKeyAuth(deps.prisma), ...updatePlatformConfigRoute(deps.commandBus));

  return router;
}
