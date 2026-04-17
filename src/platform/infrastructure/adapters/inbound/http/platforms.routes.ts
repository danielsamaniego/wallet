import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
// import { apiKeyAuth } from "../../../../../utils/infrastructure/middleware/apiKeyAuth.js";
import type { Dependencies } from "../../../../../wiring.js";
// import { listPlatformsRoute } from "./listPlatforms/handler.js";
// import { updatePlatformConfigRoute } from "./updatePlatformConfig/handler.js";

export function platformRoutes(_deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();

  // Platform management routes are disabled until proper admin auth is implemented.
  // Exposing these publicly allows any authenticated platform to list all platforms
  // and modify global config — scope must be restricted to internal/admin only.
  // router.get("/", ...listPlatformsRoute(deps.queryBus));
  // router.patch("/config", apiKeyAuth(deps.prisma), ...updatePlatformConfigRoute(deps.commandBus));

  return router;
}
