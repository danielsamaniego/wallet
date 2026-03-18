import type { Hono } from "hono";
import type { HonoVariables } from "../../shared/kernel/context.js";
import { PrismaUnitOfWork } from "../../wallet/adapters/persistence/prisma/unitOfWork.js";
import { TransferHandler } from "../../wallet/app/command/transfer/handler.js";
import { transferHandler } from "../../wallet/ports/http/transfer/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function setupTransferRoutes(app: Hono<{ Variables: HonoVariables }>, deps: Dependencies) {
  const { prisma, idGen, logger } = deps;

  const uow = new PrismaUnitOfWork(prisma);
  const transfer = new TransferHandler(uow, idGen, logger);

  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  app.post("/v1/transfers", auth, idemp, transferHandler(transfer, logger));
}
