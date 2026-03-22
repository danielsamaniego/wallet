import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { transferRoute } from "./transfer/handler.js";
import type { Dependencies } from "../../../../../wiring.js";
import { apiKeyAuth } from "../../../../../utils/infrastructure/middleware/apiKeyAuth.js";
import { idempotency } from "../../../../../utils/infrastructure/middleware/idempotency.js";

export function transferRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.prisma);
  const idemp = idempotency(deps.idempotencyStore);

  router.post("/", auth, idemp, ...transferRoute(deps.commandBus));

  return router;
}
