import { Hono } from "hono";
import type { HonoVariables } from "../../shared/adapters/kernel/hono.context.js";
import { PrismaHoldRepo } from "../../wallet/adapters/persistence/prisma/hold.repo.js";
import { PrismaLedgerEntryRepo } from "../../wallet/adapters/persistence/prisma/ledgerEntry.repo.js";
import { PrismaMovementRepo } from "../../wallet/adapters/persistence/prisma/movement.repo.js";
import { PrismaTransactionManager } from "../../wallet/adapters/persistence/prisma/transaction.manager.js";
import { PrismaTransactionRepo } from "../../wallet/adapters/persistence/prisma/transaction.repo.js";
import { PrismaWalletRepo } from "../../wallet/adapters/persistence/prisma/wallet.repo.js";
import { TransferHandler } from "../../wallet/application/command/transfer/handler.js";
import { transferRoute } from "../../wallet/ports/http/transfer/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function transferRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const { prisma, idGen, logger } = deps;

  const txManager = new PrismaTransactionManager(prisma, logger);
  const walletRepo = new PrismaWalletRepo(prisma, logger);
  const holdRepo = new PrismaHoldRepo(prisma, logger);
  const transactionRepo = new PrismaTransactionRepo(prisma, logger);
  const ledgerEntryRepo = new PrismaLedgerEntryRepo(prisma, logger);
  const movementRepo = new PrismaMovementRepo(prisma, logger);

  const transfer = new TransferHandler(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );

  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  router.post("/", auth, idemp, ...transferRoute(transfer));

  return router;
}
