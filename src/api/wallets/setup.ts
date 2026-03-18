import type { Hono } from "hono";
import type { HonoVariables } from "../../shared/adapters/kernel/hono.context.js";
import { PrismaHoldRepo } from "../../wallet/adapters/persistence/prisma/hold.repo.js";
import { PrismaLedgerEntryReadStore } from "../../wallet/adapters/persistence/prisma/ledgerEntry.readstore.js";
import { PrismaLedgerEntryRepo } from "../../wallet/adapters/persistence/prisma/ledgerEntry.repo.js";
// Adapters
import { PrismaTransactionManager } from "../../wallet/adapters/persistence/prisma/transaction.manager.js";
import { PrismaTransactionReadStore } from "../../wallet/adapters/persistence/prisma/transaction.readstore.js";
import { PrismaTransactionRepo } from "../../wallet/adapters/persistence/prisma/transaction.repo.js";
import { PrismaWalletReadStore } from "../../wallet/adapters/persistence/prisma/wallet.readstore.js";
import { PrismaWalletRepo } from "../../wallet/adapters/persistence/prisma/wallet.repo.js";
import { CloseWalletHandler } from "../../wallet/application/command/closeWallet/handler.js";
// App handlers
import { CreateWalletHandler } from "../../wallet/application/command/createWallet/handler.js";
import { DepositHandler } from "../../wallet/application/command/deposit/handler.js";
import { FreezeWalletHandler } from "../../wallet/application/command/freezeWallet/handler.js";
import { UnfreezeWalletHandler } from "../../wallet/application/command/unfreezeWallet/handler.js";
import { WithdrawHandler } from "../../wallet/application/command/withdraw/handler.js";
import { GetLedgerEntriesHandler } from "../../wallet/application/query/getLedgerEntries/handler.js";
import { GetTransactionsHandler } from "../../wallet/application/query/getTransactions/handler.js";
import { GetWalletHandler } from "../../wallet/application/query/getWallet/handler.js";
import { closeWalletHandler } from "../../wallet/ports/http/closeWallet/handler.js";
// HTTP handlers
import { createWalletHandler } from "../../wallet/ports/http/createWallet/handler.js";
import { depositHandler } from "../../wallet/ports/http/deposit/handler.js";
import { freezeWalletHandler } from "../../wallet/ports/http/freezeWallet/handler.js";
import { getLedgerEntriesHandler } from "../../wallet/ports/http/getLedgerEntries/handler.js";
import { getTransactionsHandler } from "../../wallet/ports/http/getTransactions/handler.js";
import { getWalletHandler } from "../../wallet/ports/http/getWallet/handler.js";
import { unfreezeWalletHandler } from "../../wallet/ports/http/unfreezeWallet/handler.js";
import { withdrawHandler } from "../../wallet/ports/http/withdraw/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function setupWalletRoutes(app: Hono<{ Variables: HonoVariables }>, deps: Dependencies) {
  const { prisma, idGen, logger } = deps;

  // Adapters
  const txManager = new PrismaTransactionManager(prisma, logger);
  const walletRepo = new PrismaWalletRepo(prisma, logger);
  const holdRepo = new PrismaHoldRepo(prisma, logger);
  const transactionRepo = new PrismaTransactionRepo(prisma, logger);
  const ledgerEntryRepo = new PrismaLedgerEntryRepo(prisma, logger);
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
    idGen,
    logger,
  );
  const withdraw = new WithdrawHandler(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
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

  // Commands (mutations — require auth + idempotency)
  app.post("/v1/wallets", auth, idemp, createWalletHandler(createWallet, logger));
  app.post("/v1/wallets/:walletId/deposit", auth, idemp, depositHandler(deposit, logger));
  app.post("/v1/wallets/:walletId/withdraw", auth, idemp, withdrawHandler(withdraw, logger));
  app.post("/v1/wallets/:walletId/freeze", auth, freezeWalletHandler(freezeWallet, logger));
  app.post("/v1/wallets/:walletId/unfreeze", auth, unfreezeWalletHandler(unfreezeWallet, logger));
  app.post("/v1/wallets/:walletId/close", auth, closeWalletHandler(closeWallet, logger));

  // Queries (reads — require auth only)
  app.get("/v1/wallets/:walletId", auth, getWalletHandler(getWallet, logger));
  app.get(
    "/v1/wallets/:walletId/transactions",
    auth,
    getTransactionsHandler(getTransactions, logger),
  );
  app.get("/v1/wallets/:walletId/ledger", auth, getLedgerEntriesHandler(getLedgerEntries, logger));
}
