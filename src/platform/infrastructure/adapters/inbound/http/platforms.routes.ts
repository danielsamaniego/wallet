import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { listPlatformsRoute } from "./listPlatforms/handler.js";
import type { Dependencies } from "../../../../../wiring.js";

export function platformRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();

  router.get("/", ...listPlatformsRoute(deps.queryBus));

  return router;
}
