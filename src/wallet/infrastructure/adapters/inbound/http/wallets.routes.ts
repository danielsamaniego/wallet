import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { apiKeyAuth } from "../../../../../utils/infrastructure/middleware/apiKeyAuth.js";
import { idempotency } from "../../../../../utils/infrastructure/middleware/idempotency.js";
import type { Dependencies } from "../../../../../wiring.js";
import { adjustBalanceRoute } from "./adjustBalance/handler.js";
import { closeWalletRoute } from "./closeWallet/handler.js";
import { createWalletRoute } from "./createWallet/handler.js";
import { depositRoute } from "./deposit/handler.js";
import { freezeWalletRoute } from "./freezeWallet/handler.js";
import { getLedgerEntriesRoute } from "./getLedgerEntries/handler.js";
import { getTransactionsRoute } from "./getTransactions/handler.js";
import { getWalletRoute } from "./getWallet/handler.js";
import { unfreezeWalletRoute } from "./unfreezeWallet/handler.js";
import { withdrawRoute } from "./withdraw/handler.js";

export function walletRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.prisma);
  const idemp = idempotency(deps.idempotencyStore);

  // Commands
  router.post("/", auth, idemp, ...createWalletRoute(deps.commandBus));
  router.post("/:walletId/deposit", auth, idemp, ...depositRoute(deps.commandBus));
  router.post("/:walletId/withdraw", auth, idemp, ...withdrawRoute(deps.commandBus));
  router.post("/:walletId/adjust", auth, idemp, ...adjustBalanceRoute(deps.commandBus));
  router.post("/:walletId/freeze", auth, ...freezeWalletRoute(deps.commandBus));
  router.post("/:walletId/unfreeze", auth, ...unfreezeWalletRoute(deps.commandBus));
  router.post("/:walletId/close", auth, ...closeWalletRoute(deps.commandBus));

  // Queries
  router.get("/:walletId", auth, ...getWalletRoute(deps.queryBus));
  router.get("/:walletId/transactions", auth, ...getTransactionsRoute(deps.queryBus));
  router.get("/:walletId/ledger", auth, ...getLedgerEntriesRoute(deps.queryBus));

  return router;
}
