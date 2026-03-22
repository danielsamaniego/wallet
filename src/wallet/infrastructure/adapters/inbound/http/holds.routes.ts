import { Hono } from "hono";
import type { HonoVariables } from "../../../../../shared/infrastructure/kernel/hono.context.js";
import { captureHoldRoute } from "./captureHold/handler.js";
import { placeHoldRoute } from "./placeHold/handler.js";
import { voidHoldRoute } from "./voidHold/handler.js";
import type { Dependencies } from "../../../../../wiring.js";
import { apiKeyAuth } from "../../../../../shared/infrastructure/http/middleware/apiKeyAuth.js";
import { idempotency } from "../../../../../shared/infrastructure/http/middleware/idempotency.js";

export function holdRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  router.post("/", auth, idemp, ...placeHoldRoute(deps.commandBus));
  router.post("/:holdId/capture", auth, idemp, ...captureHoldRoute(deps.commandBus));
  router.post("/:holdId/void", auth, ...voidHoldRoute(deps.commandBus));

  return router;
}
