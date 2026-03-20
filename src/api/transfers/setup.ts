import { Hono } from "hono";
import type { HonoVariables } from "../../shared/adapters/kernel/hono.context.js";
import { transferRoute } from "../../wallet/ports/http/transfer/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function transferRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  router.post("/", auth, idemp, ...transferRoute(deps.transfer));

  return router;
}
