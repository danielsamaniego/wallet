import { Hono } from "hono";
import type { HonoVariables } from "../../shared/adapters/kernel/hono.context.js";
import { PrismaHoldRepo } from "../../wallet/adapters/persistence/prisma/hold.repo.js";
import { PrismaLedgerEntryReadStore } from "../../wallet/adapters/persistence/prisma/ledgerEntry.readstore.js";
import { PrismaLedgerEntryRepo } from "../../wallet/adapters/persistence/prisma/ledgerEntry.repo.js";
import { PrismaMovementRepo } from "../../wallet/adapters/persistence/prisma/movement.repo.js";
import { PrismaTransactionManager } from "../../wallet/adapters/persistence/prisma/transaction.manager.js";
import { PrismaTransactionReadStore } from "../../wallet/adapters/persistence/prisma/transaction.readstore.js";
import { PrismaTransactionRepo } from "../../wallet/adapters/persistence/prisma/transaction.repo.js";
import { PrismaWalletReadStore } from "../../wallet/adapters/persistence/prisma/wallet.readstore.js";
import { PrismaWalletRepo } from "../../wallet/adapters/persistence/prisma/wallet.repo.js";
import { CloseWalletHandler } from "../../wallet/application/command/closeWallet/handler.js";
import { CreateWalletHandler } from "../../wallet/application/command/createWallet/handler.js";
import { DepositHandler } from "../../wallet/application/command/deposit/handler.js";
import { FreezeWalletHandler } from "../../wallet/application/command/freezeWallet/handler.js";
import { UnfreezeWalletHandler } from "../../wallet/application/command/unfreezeWallet/handler.js";
import { WithdrawHandler } from "../../wallet/application/command/withdraw/handler.js";
import { GetLedgerEntriesHandler } from "../../wallet/application/query/getLedgerEntries/handler.js";
import { GetTransactionsHandler } from "../../wallet/application/query/getTransactions/handler.js";
import { GetWalletHandler } from "../../wallet/application/query/getWallet/handler.js";
import { closeWalletRoute } from "../../wallet/ports/http/closeWallet/handler.js";
import { createWalletRoute } from "../../wallet/ports/http/createWallet/handler.js";
import { depositRoute } from "../../wallet/ports/http/deposit/handler.js";
import { freezeWalletRoute } from "../../wallet/ports/http/freezeWallet/handler.js";
import { getLedgerEntriesRoute } from "../../wallet/ports/http/getLedgerEntries/handler.js";
import { getTransactionsRoute } from "../../wallet/ports/http/getTransactions/handler.js";
import { getWalletRoute } from "../../wallet/ports/http/getWallet/handler.js";
import { unfreezeWalletRoute } from "../../wallet/ports/http/unfreezeWallet/handler.js";
import { withdrawRoute } from "../../wallet/ports/http/withdraw/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function walletRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const { prisma, idGen, logger } = deps;

  // Adapters
  const txManager = new PrismaTransactionManager(prisma, logger);
  const walletRepo = new PrismaWalletRepo(prisma, logger);
  const holdRepo = new PrismaHoldRepo(prisma, logger);
  const transactionRepo = new PrismaTransactionRepo(prisma, logger);
  const ledgerEntryRepo = new PrismaLedgerEntryRepo(prisma, logger);
  const movementRepo = new PrismaMovementRepo(prisma, logger);
  const walletReadStore = new PrismaWalletReadStore(prisma, logger);
  const transactionReadStore = new PrismaTransactionReadStore(prisma, logger);
  const ledgerEntryReadStore = new PrismaLedgerEntryReadStore(prisma, logger);

  // App handlers
  const createWallet = new CreateWalletHandler(txManager, walletRepo, idGen, logger);
  const deposit = new DepositHandler(
    txManager,
    walletRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const withdraw = new WithdrawHandler(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const freezeWallet = new FreezeWalletHandler(txManager, walletRepo, logger);
  const unfreezeWallet = new UnfreezeWalletHandler(txManager, walletRepo, logger);
  const closeWallet = new CloseWalletHandler(txManager, walletRepo, holdRepo, logger);
  const getWallet = new GetWalletHandler(walletReadStore, logger);
  const getTransactions = new GetTransactionsHandler(transactionReadStore, logger);
  const getLedgerEntries = new GetLedgerEntriesHandler(ledgerEntryReadStore, logger);

  // Middleware
  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  // Commands
  router.post("/", auth, idemp, ...createWalletRoute(createWallet));
  router.post("/:walletId/deposit", auth, idemp, ...depositRoute(deposit));
  router.post("/:walletId/withdraw", auth, idemp, ...withdrawRoute(withdraw));
  router.post("/:walletId/freeze", auth, ...freezeWalletRoute(freezeWallet));
  router.post("/:walletId/unfreeze", auth, ...unfreezeWalletRoute(unfreezeWallet));
  router.post("/:walletId/close", auth, ...closeWalletRoute(closeWallet));

  // Queries
  router.get("/:walletId", auth, ...getWalletRoute(getWallet));
  router.get("/:walletId/transactions", auth, ...getTransactionsRoute(getTransactions));
  router.get("/:walletId/ledger", auth, ...getLedgerEntriesRoute(getLedgerEntries));

  return router;
}
