import { Hono } from "hono";
import type { HonoVariables } from "../../../../../shared/infrastructure/kernel/hono.context.js";
import { transferRoute } from "./transfer/handler.js";
import type { Dependencies } from "../../../../../wiring.js";
import { apiKeyAuth } from "../../../../../shared/infrastructure/http/middleware/apiKeyAuth.js";
import { idempotency } from "../../../../../shared/infrastructure/http/middleware/idempotency.js";

export function transferRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  router.post("/", auth, idemp, ...transferRoute(deps.commandBus));

  return router;
}
