import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { ICommandBus, IQueryBus } from "@/utils/application/cqrs.js";

import { captureHoldRoute } from "@/wallet/infrastructure/adapters/inbound/http/captureHold/handler.js";
import { closeWalletRoute } from "@/wallet/infrastructure/adapters/inbound/http/closeWallet/handler.js";
import { createWalletRoute } from "@/wallet/infrastructure/adapters/inbound/http/createWallet/handler.js";
import { depositRoute } from "@/wallet/infrastructure/adapters/inbound/http/deposit/handler.js";
import { freezeWalletRoute } from "@/wallet/infrastructure/adapters/inbound/http/freezeWallet/handler.js";
import { getWalletRoute } from "@/wallet/infrastructure/adapters/inbound/http/getWallet/handler.js";
import { placeHoldRoute } from "@/wallet/infrastructure/adapters/inbound/http/placeHold/handler.js";
import { transferRoute } from "@/wallet/infrastructure/adapters/inbound/http/transfer/handler.js";
import { unfreezeWalletRoute } from "@/wallet/infrastructure/adapters/inbound/http/unfreezeWallet/handler.js";
import { voidHoldRoute } from "@/wallet/infrastructure/adapters/inbound/http/voidHold/handler.js";
import { withdrawRoute } from "@/wallet/infrastructure/adapters/inbound/http/withdraw/handler.js";

/** Injects tracking context + platformId (simulating trackingCanonical + apiKeyAuth). */
function withContext(app: Hono<{ Variables: HonoVariables }>) {
  app.use("*", async (c, next) => {
    c.set("trackingId", "test-tracking");
    c.set("startTs", Date.now());
    c.set("canonical", new CanonicalAccumulator());
    c.set("platformId", "platform-1");
    await next();
  });
  return app;
}

describe("Wallet command HTTP handlers", () => {
  // ── captureHold ────────────────────────────────────────────────
  describe("captureHoldRoute", () => {
    it("Given a valid holdId, When POST is called, Then dispatches CaptureHoldCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-1", movementId: "mov-1" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = captureHoldRoute(commandBus);
      app.post("/holds/:holdId/capture", ...handlers);

      const res = await app.request("/holds/hold-1/capture", {
        method: "POST",
        headers: { "idempotency-key": "idem-1" },
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ transaction_id: "txn-1", movement_id: "mov-1" });
    });
  });

  // ── closeWallet ────────────────────────────────────────────────
  describe("closeWalletRoute", () => {
    it("Given a valid walletId, When POST is called, Then dispatches CloseWalletCommand and returns 200", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue(undefined),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = closeWalletRoute(commandBus);
      app.post("/wallets/:walletId/close", ...handlers);

      const res = await app.request("/wallets/wallet-1/close", { method: "POST" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "closed" });
    });
  });

  // ── createWallet ───────────────────────────────────────────────
  describe("createWalletRoute", () => {
    it("Given a valid body, When POST is called, Then dispatches CreateWalletCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ walletId: "wallet-new" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = createWalletRoute(commandBus);
      app.post("/wallets", ...handlers);

      const res = await app.request("/wallets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner_id: "owner-1", currency_code: "USD" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ wallet_id: "wallet-new" });
    });
  });

  // ── deposit ────────────────────────────────────────────────────
  describe("depositRoute", () => {
    it("Given a valid walletId and body, When POST is called, Then dispatches DepositCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-dep", movementId: "mov-dep" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = depositRoute(commandBus);
      app.post("/wallets/:walletId/deposit", ...handlers);

      const res = await app.request("/wallets/wallet-1/deposit", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
        body: JSON.stringify({ amount_cents: 5000 }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ transaction_id: "txn-dep", movement_id: "mov-dep" });
    });
  });

  // ── freezeWallet ───────────────────────────────────────────────
  describe("freezeWalletRoute", () => {
    it("Given a valid walletId, When POST is called, Then dispatches FreezeWalletCommand and returns 200", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue(undefined),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = freezeWalletRoute(commandBus);
      app.post("/wallets/:walletId/freeze", ...handlers);

      const res = await app.request("/wallets/wallet-1/freeze", { method: "POST" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "frozen" });
    });
  });

  // ── getWallet ──────────────────────────────────────────────────
  describe("getWalletRoute", () => {
    it("Given a valid walletId, When GET is called, Then dispatches GetWalletQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({
          id: "wallet-1",
          owner_id: "owner-1",
          platform_id: "platform-1",
          currency_code: "USD",
          balance_cents: 10000,
          available_balance_cents: 8000,
          status: "active",
          is_system: false,
          created_at: 1700000000000,
          updated_at: 1700000000000,
        }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = getWalletRoute(queryBus);
      app.get("/wallets/:walletId", ...handlers);

      const res = await app.request("/wallets/wallet-1");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe("wallet-1");
    });
  });

  // ── placeHold ──────────────────────────────────────────────────
  describe("placeHoldRoute", () => {
    it("Given a valid body, When POST is called, Then dispatches PlaceHoldCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ holdId: "hold-new" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = placeHoldRoute(commandBus);
      app.post("/holds", ...handlers);

      const res = await app.request("/holds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet_id: "wallet-1", amount_cents: 2000 }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ hold_id: "hold-new" });
    });
  });

  // ── transfer ───────────────────────────────────────────────────
  describe("transferRoute", () => {
    it("Given a valid body, When POST is called, Then dispatches TransferCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({
          sourceTransactionId: "txn-out",
          targetTransactionId: "txn-in",
          movementId: "mov-xfer",
        }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = transferRoute(commandBus);
      app.post("/transfers", ...handlers);

      const res = await app.request("/transfers", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
        body: JSON.stringify({
          source_wallet_id: "wallet-1",
          target_wallet_id: "wallet-2",
          amount_cents: 1000,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({
        source_transaction_id: "txn-out",
        target_transaction_id: "txn-in",
        movement_id: "mov-xfer",
      });
    });
  });

  // ── unfreezeWallet ─────────────────────────────────────────────
  describe("unfreezeWalletRoute", () => {
    it("Given a valid walletId, When POST is called, Then dispatches UnfreezeWalletCommand and returns 200", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue(undefined),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = unfreezeWalletRoute(commandBus);
      app.post("/wallets/:walletId/unfreeze", ...handlers);

      const res = await app.request("/wallets/wallet-1/unfreeze", { method: "POST" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "active" });
    });
  });

  // ── voidHold ───────────────────────────────────────────────────
  describe("voidHoldRoute", () => {
    it("Given a valid holdId, When POST is called, Then dispatches VoidHoldCommand and returns 200", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue(undefined),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = voidHoldRoute(commandBus);
      app.post("/holds/:holdId/void", ...handlers);

      const res = await app.request("/holds/hold-1/void", { method: "POST" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "voided" });
    });
  });

  // ── withdraw ───────────────────────────────────────────────────
  describe("withdrawRoute", () => {
    it("Given a valid walletId and body, When POST is called, Then dispatches WithdrawCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-wd", movementId: "mov-wd" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = withdrawRoute(commandBus);
      app.post("/wallets/:walletId/withdraw", ...handlers);

      const res = await app.request("/wallets/wallet-1/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
        body: JSON.stringify({ amount_cents: 3000 }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ transaction_id: "txn-wd", movement_id: "mov-wd" });
    });
  });
});
