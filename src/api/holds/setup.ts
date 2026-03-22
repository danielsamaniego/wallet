import { Hono } from "hono";
import type { HonoVariables } from "../../shared/infrastructure/kernel/hono.context.js";
import { captureHoldRoute } from "../../wallet/infrastructure/adapters/inbound/http/captureHold/handler.js";
import { placeHoldRoute } from "../../wallet/infrastructure/adapters/inbound/http/placeHold/handler.js";
import { voidHoldRoute } from "../../wallet/infrastructure/adapters/inbound/http/voidHold/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function holdRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  router.post("/", auth, idemp, ...placeHoldRoute(deps.commandBus));
  router.post("/:holdId/capture", auth, idemp, ...captureHoldRoute(deps.commandBus));
  router.post("/:holdId/void", auth, ...voidHoldRoute(deps.commandBus));

  return router;
}
