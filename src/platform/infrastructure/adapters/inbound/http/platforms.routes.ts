import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import type { Dependencies } from "../../../../../wiring.js";
import { listPlatformsRoute } from "./listPlatforms/handler.js";

export function platformRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();

  router.get("/", ...listPlatformsRoute(deps.queryBus));

  return router;
}
