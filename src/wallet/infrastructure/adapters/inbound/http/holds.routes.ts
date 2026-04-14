import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { apiKeyAuth } from "../../../../../utils/infrastructure/middleware/apiKeyAuth.js";
import { idempotency } from "../../../../../utils/infrastructure/middleware/idempotency.js";
import type { Dependencies } from "../../../../../wiring.js";
import { captureHoldRoute } from "./captureHold/handler.js";
import { getHoldRoute } from "./getHold/handler.js";
import { listHoldsRoute } from "./listHolds/handler.js";
import { placeHoldRoute } from "./placeHold/handler.js";
import { voidHoldRoute } from "./voidHold/handler.js";

export function holdRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.prisma);
  const idemp = idempotency(deps.idempotencyStore);

  // Commands
  router.post("/", auth, idemp, ...placeHoldRoute(deps.commandBus));
  router.post("/:holdId/capture", auth, idemp, ...captureHoldRoute(deps.commandBus));
  router.post("/:holdId/void", auth, ...voidHoldRoute(deps.commandBus));

  // Queries
  router.get("/:holdId", auth, ...getHoldRoute(deps.queryBus));
  router.get("/wallet/:walletId", auth, ...listHoldsRoute(deps.queryBus));

  return router;
}
