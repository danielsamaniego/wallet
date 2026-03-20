import { Hono } from "hono";
import type { HonoVariables } from "../../shared/adapters/kernel/hono.context.js";
import { captureHoldRoute } from "../../wallet/ports/http/captureHold/handler.js";
import { placeHoldRoute } from "../../wallet/ports/http/placeHold/handler.js";
import { voidHoldRoute } from "../../wallet/ports/http/voidHold/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function holdRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  router.post("/", auth, idemp, ...placeHoldRoute(deps.placeHold));
  router.post("/:holdId/capture", auth, idemp, ...captureHoldRoute(deps.captureHold));
  router.post("/:holdId/void", auth, ...voidHoldRoute(deps.voidHold));

  return router;
}
