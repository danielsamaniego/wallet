import { Hono } from "hono";
import type { HonoVariables } from "../../shared/adapters/kernel/hono.context.js";
import { PrismaHoldRepo } from "../../wallet/adapters/persistence/prisma/hold.repo.js";
import { PrismaLedgerEntryRepo } from "../../wallet/adapters/persistence/prisma/ledgerEntry.repo.js";
import { PrismaMovementRepo } from "../../wallet/adapters/persistence/prisma/movement.repo.js";
import { PrismaTransactionManager } from "../../wallet/adapters/persistence/prisma/transaction.manager.js";
import { PrismaTransactionRepo } from "../../wallet/adapters/persistence/prisma/transaction.repo.js";
import { PrismaWalletRepo } from "../../wallet/adapters/persistence/prisma/wallet.repo.js";
import { CaptureHoldHandler } from "../../wallet/application/command/captureHold/handler.js";
import { PlaceHoldHandler } from "../../wallet/application/command/placeHold/handler.js";
import { VoidHoldHandler } from "../../wallet/application/command/voidHold/handler.js";
import { captureHoldRoute } from "../../wallet/ports/http/captureHold/handler.js";
import { placeHoldRoute } from "../../wallet/ports/http/placeHold/handler.js";
import { voidHoldRoute } from "../../wallet/ports/http/voidHold/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function holdRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const { prisma, idGen, logger } = deps;

  const txManager = new PrismaTransactionManager(prisma, logger);
  const walletRepo = new PrismaWalletRepo(prisma, logger);
  const holdRepo = new PrismaHoldRepo(prisma, logger);
  const transactionRepo = new PrismaTransactionRepo(prisma, logger);
  const ledgerEntryRepo = new PrismaLedgerEntryRepo(prisma, logger);
  const movementRepo = new PrismaMovementRepo(prisma, logger);

  const placeHold = new PlaceHoldHandler(txManager, walletRepo, holdRepo, idGen, logger);
  const captureHold = new CaptureHoldHandler(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const voidHold = new VoidHoldHandler(txManager, walletRepo, holdRepo, logger);

  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  router.post("/", auth, idemp, ...placeHoldRoute(placeHold));
  router.post("/:holdId/capture", auth, idemp, ...captureHoldRoute(captureHold));
  router.post("/:holdId/void", auth, ...voidHoldRoute(voidHold));

  return router;
}
