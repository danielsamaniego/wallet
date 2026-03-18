import type { Hono } from "hono";
import type { HonoVariables } from "../../shared/kernel/context.js";
import { PrismaLedgerEntryReadStore } from "../../wallet/adapters/persistence/prisma/ledgerEntryReadStore.js";
import { PrismaTransactionReadStore } from "../../wallet/adapters/persistence/prisma/transactionReadStore.js";
// Adapters
import { PrismaUnitOfWork } from "../../wallet/adapters/persistence/prisma/unitOfWork.js";
import { PrismaWalletReadStore } from "../../wallet/adapters/persistence/prisma/walletReadStore.js";
import { CloseWalletHandler } from "../../wallet/app/command/closeWallet/handler.js";
// App handlers
import { CreateWalletHandler } from "../../wallet/app/command/createWallet/handler.js";
import { DepositHandler } from "../../wallet/app/command/deposit/handler.js";
import { FreezeWalletHandler } from "../../wallet/app/command/freezeWallet/handler.js";
import { WithdrawHandler } from "../../wallet/app/command/withdraw/handler.js";
import { GetLedgerEntriesHandler } from "../../wallet/app/query/getLedgerEntries/handler.js";
import { GetTransactionsHandler } from "../../wallet/app/query/getTransactions/handler.js";
import { GetWalletHandler } from "../../wallet/app/query/getWallet/handler.js";
import { closeWalletHandler } from "../../wallet/ports/http/closeWallet/handler.js";
// HTTP handlers
import { createWalletHandler } from "../../wallet/ports/http/createWallet/handler.js";
import { depositHandler } from "../../wallet/ports/http/deposit/handler.js";
import { freezeWalletHandler } from "../../wallet/ports/http/freezeWallet/handler.js";
import { getLedgerEntriesHandler } from "../../wallet/ports/http/getLedgerEntries/handler.js";
import { getTransactionsHandler } from "../../wallet/ports/http/getTransactions/handler.js";
import { getWalletHandler } from "../../wallet/ports/http/getWallet/handler.js";
import { withdrawHandler } from "../../wallet/ports/http/withdraw/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function setupWalletRoutes(app: Hono<{ Variables: HonoVariables }>, deps: Dependencies) {
  const { prisma, idGen, logger } = deps;

  // Adapters
  const uow = new PrismaUnitOfWork(prisma);
  const walletReadStore = new PrismaWalletReadStore(prisma);
  const transactionReadStore = new PrismaTransactionReadStore(prisma);
  const ledgerEntryReadStore = new PrismaLedgerEntryReadStore(prisma);

  // App handlers
  const createWallet = new CreateWalletHandler(uow, idGen, logger);
  const deposit = new DepositHandler(uow, idGen, logger);
  const withdraw = new WithdrawHandler(uow, idGen, logger);
  const freezeWallet = new FreezeWalletHandler(uow, logger);
  const closeWallet = new CloseWalletHandler(uow, logger);
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
