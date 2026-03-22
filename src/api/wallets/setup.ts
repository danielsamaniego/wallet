import { Hono } from "hono";
import type { HonoVariables } from "../../shared/infrastructure/kernel/hono.context.js";
import { closeWalletRoute } from "../../wallet/infrastructure/adapters/inbound/http/closeWallet/handler.js";
import { createWalletRoute } from "../../wallet/infrastructure/adapters/inbound/http/createWallet/handler.js";
import { depositRoute } from "../../wallet/infrastructure/adapters/inbound/http/deposit/handler.js";
import { freezeWalletRoute } from "../../wallet/infrastructure/adapters/inbound/http/freezeWallet/handler.js";
import { getLedgerEntriesRoute } from "../../wallet/infrastructure/adapters/inbound/http/getLedgerEntries/handler.js";
import { getTransactionsRoute } from "../../wallet/infrastructure/adapters/inbound/http/getTransactions/handler.js";
import { getWalletRoute } from "../../wallet/infrastructure/adapters/inbound/http/getWallet/handler.js";
import { unfreezeWalletRoute } from "../../wallet/infrastructure/adapters/inbound/http/unfreezeWallet/handler.js";
import { withdrawRoute } from "../../wallet/infrastructure/adapters/inbound/http/withdraw/handler.js";
import type { Dependencies } from "../../wiring.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { idempotency } from "../middleware/idempotency.js";

export function walletRoutes(deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  // Commands
  router.post("/", auth, idemp, ...createWalletRoute(deps.createWallet));
  router.post("/:walletId/deposit", auth, idemp, ...depositRoute(deps.deposit));
  router.post("/:walletId/withdraw", auth, idemp, ...withdrawRoute(deps.withdraw));
  router.post("/:walletId/freeze", auth, ...freezeWalletRoute(deps.freezeWallet));
  router.post("/:walletId/unfreeze", auth, ...unfreezeWalletRoute(deps.unfreezeWallet));
  router.post("/:walletId/close", auth, ...closeWalletRoute(deps.closeWallet));

  // Queries
  router.get("/:walletId", auth, ...getWalletRoute(deps.getWallet));
  router.get("/:walletId/transactions", auth, ...getTransactionsRoute(deps.getTransactions));
  router.get("/:walletId/ledger", auth, ...getLedgerEntriesRoute(deps.getLedgerEntries));

  return router;
}
