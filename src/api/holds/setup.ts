import type { Hono } from "hono";
import type { HonoVariables } from "../../shared/kernel/context.js";
import { PrismaUnitOfWork } from "../../wallet/adapters/persistence/prisma/unitOfWork.js";
import { CaptureHoldHandler } from "../../wallet/app/command/captureHold/handler.js";
import { PlaceHoldHandler } from "../../wallet/app/command/placeHold/handler.js";
import { VoidHoldHandler } from "../../wallet/app/command/voidHold/handler.js";
import { captureHoldHandler } from "../../wallet/ports/http/captureHold/handler.js";
import { placeHoldHandler } from "../../wallet/ports/http/placeHold/handler.js";
import { voidHoldHandler } from "../../wallet/ports/http/voidHold/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function setupHoldRoutes(app: Hono<{ Variables: HonoVariables }>, deps: Dependencies) {
  const { prisma, idGen, logger } = deps;

  const uow = new PrismaUnitOfWork(prisma);
  const placeHold = new PlaceHoldHandler(uow, idGen, logger);
  const captureHold = new CaptureHoldHandler(uow, idGen, logger);
  const voidHold = new VoidHoldHandler(uow, logger);

  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  app.post("/v1/holds", auth, idemp, placeHoldHandler(placeHold, logger));
  app.post("/v1/holds/:holdId/capture", auth, idemp, captureHoldHandler(captureHold, logger));
  app.post("/v1/holds/:holdId/void", auth, voidHoldHandler(voidHold, logger));
}
