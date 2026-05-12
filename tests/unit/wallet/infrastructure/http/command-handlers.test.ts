import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { ICommandBus, IQueryBus } from "@/utils/application/cqrs.js";
import type { MutationHandlerDeps } from "@/wallet/infrastructure/adapters/inbound/http/types.js";

/** Builds a sync-only MutationHandlerDeps (no asyncDispatch). queryBus stub
 * suffices for the five wallet-scoped handlers; captureHold tests that
 * exercise the async pre-resolve path override it. */
function mutDeps(commandBus: ICommandBus, queryBus?: IQueryBus): MutationHandlerDeps {
  return {
    commandBus,
    queryBus: queryBus ?? { dispatch: vi.fn() },
  };
}

import { adjustBalanceRoute } from "@/wallet/infrastructure/adapters/inbound/http/adjustBalance/handler.js";
// TODO(historical-import-temp): Remove these imports together with the tests
// below once the import-historical-entry feature is removed.
import { importHistoricalEntryRoute } from "@/wallet/infrastructure/adapters/inbound/http/importHistoricalEntry/handler.js";
import { historicalImportGate } from "@/wallet/infrastructure/adapters/inbound/http/wallets.routes.js";
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
import { chargeRoute } from "@/wallet/infrastructure/adapters/inbound/http/charge/handler.js";
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
  // ── adjustBalance ──────────────────────────────────────────────
  describe("adjustBalanceRoute", () => {
    it("Given a valid walletId and body, When POST is called, Then dispatches AdjustBalanceCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-adj", movementId: "mov-adj" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = adjustBalanceRoute(mutDeps(commandBus));
      app.post("/wallets/:walletId/adjust", ...handlers);

      const res = await app.request("/wallets/wallet-1/adjust", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
        body: JSON.stringify({ amount_minor: 5000, reason: "Promotional credit" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ transaction_id: "txn-adj", movement_id: "mov-adj" });
    });
  });

  // ── historicalImportGate ───────────────────────────────────────
  // TODO(historical-import-temp): Remove this describe block together with
  // the rest of the import-historical-entry feature after migration.
  describe("historicalImportGate", () => {
    const originalEnv = process.env.HISTORICAL_IMPORT_ENABLED;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.HISTORICAL_IMPORT_ENABLED;
      } else {
        process.env.HISTORICAL_IMPORT_ENABLED = originalEnv;
      }
    });

    it("Given HISTORICAL_IMPORT_ENABLED is unset, When the gate runs, Then returns 404", async () => {
      delete process.env.HISTORICAL_IMPORT_ENABLED;
      const app = new Hono<{ Variables: HonoVariables }>();
      app.use("*", historicalImportGate);
      app.post("/guarded", (c) => c.json({ ok: true }));

      const res = await app.request("/guarded", { method: "POST" });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: "NOT_FOUND", message: "resource not found" });
    });

    it("Given HISTORICAL_IMPORT_ENABLED = 'false', When the gate runs, Then returns 404", async () => {
      process.env.HISTORICAL_IMPORT_ENABLED = "false";
      const app = new Hono<{ Variables: HonoVariables }>();
      app.use("*", historicalImportGate);
      app.post("/guarded", (c) => c.json({ ok: true }));

      const res = await app.request("/guarded", { method: "POST" });

      expect(res.status).toBe(404);
    });

    it("Given HISTORICAL_IMPORT_ENABLED = 'true', When the gate runs, Then calls next()", async () => {
      process.env.HISTORICAL_IMPORT_ENABLED = "true";
      const app = new Hono<{ Variables: HonoVariables }>();
      app.use("*", historicalImportGate);
      app.post("/guarded", (c) => c.json({ ok: true }));

      const res = await app.request("/guarded", { method: "POST" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });

  // ── importHistoricalEntry ──────────────────────────────────────
  // TODO(historical-import-temp): Remove this describe block together with
  // the rest of the import-historical-entry feature after migration.
  describe("importHistoricalEntryRoute", () => {
    it("Given a valid walletId and body, When POST is called, Then dispatches ImportHistoricalEntryCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-hist", movementId: "mov-hist" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = importHistoricalEntryRoute(commandBus);
      app.post("/wallets/:walletId/import-historical-entry", ...handlers);

      const res = await app.request("/wallets/wallet-1/import-historical-entry", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-hist" },
        body: JSON.stringify({
          amount_minor: 5000,
          reason: "Legacy promotional credit",
          reference: "Venta producto X",
          historical_created_at: Date.now() - 60_000,
          metadata: { migratedFrom: "legacy-system" },
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ transaction_id: "txn-hist", movement_id: "mov-hist" });
    });

    it("Given no idempotency-key header, When POST is called, Then the command is dispatched with empty idempotencyKey", async () => {
      const dispatch = vi
        .fn()
        .mockResolvedValue({ transactionId: "txn-hist", movementId: "mov-hist" });
      const commandBus: ICommandBus = { dispatch };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = importHistoricalEntryRoute(commandBus);
      app.post("/wallets/:walletId/import-historical-entry", ...handlers);

      await app.request("/wallets/wallet-1/import-historical-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_minor: 100,
          reason: "reason",
          reference: "ref",
          historical_created_at: Date.now() - 1000,
        }),
      });

      const dispatchedCommand = dispatch.mock.calls[0]![1];
      expect(dispatchedCommand.idempotencyKey).toBe("");
    });

    it("Given a future historical_created_at, When POST is called, Then returns 400 INVALID_REQUEST", async () => {
      const commandBus: ICommandBus = { dispatch: vi.fn() };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = importHistoricalEntryRoute(commandBus);
      app.post("/wallets/:walletId/import-historical-entry", ...handlers);

      const res = await app.request("/wallets/wallet-1/import-historical-entry", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-hist" },
        body: JSON.stringify({
          amount_minor: 5000,
          reason: "future",
          reference: "ref",
          historical_created_at: Date.now() + 60_000,
        }),
      });

      expect(res.status).toBe(400);
      expect(commandBus.dispatch).not.toHaveBeenCalled();
    });

    it("Given amount_minor = 0, When POST is called, Then returns 400 INVALID_REQUEST", async () => {
      const commandBus: ICommandBus = { dispatch: vi.fn() };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = importHistoricalEntryRoute(commandBus);
      app.post("/wallets/:walletId/import-historical-entry", ...handlers);

      const res = await app.request("/wallets/wallet-1/import-historical-entry", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-hist" },
        body: JSON.stringify({
          amount_minor: 0,
          reason: "zero",
          reference: "ref",
          historical_created_at: Date.now() - 1000,
        }),
      });

      expect(res.status).toBe(400);
      expect(commandBus.dispatch).not.toHaveBeenCalled();
    });
  });

  // ── captureHold ────────────────────────────────────────────────
  describe("captureHoldRoute", () => {
    it("Given a valid holdId, When POST is called, Then dispatches CaptureHoldCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-1", movementId: "mov-1" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = captureHoldRoute(mutDeps(commandBus));
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
      const handlers = depositRoute(mutDeps(commandBus));
      app.post("/wallets/:walletId/deposit", ...handlers);

      const res = await app.request("/wallets/wallet-1/deposit", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
        body: JSON.stringify({ amount_minor: 5000 }),
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
          balance_minor: 10000,
          available_balance_minor: 8000,
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
        body: JSON.stringify({ wallet_id: "wallet-1", amount_minor: 2000 }),
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
      const handlers = transferRoute(mutDeps(commandBus));
      app.post("/transfers", ...handlers);

      const res = await app.request("/transfers", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
        body: JSON.stringify({
          source_wallet_id: "wallet-1",
          target_wallet_id: "wallet-2",
          amount_minor: 1000,
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

  // ── charge ─────────────────────────────────────────────────────
  describe("chargeRoute", () => {
    it("Given a valid walletId and body, When POST is called, Then dispatches ChargeCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-ch", movementId: "mov-ch" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = chargeRoute(mutDeps(commandBus));
      app.post("/wallets/:walletId/charge", ...handlers);

      const res = await app.request("/wallets/wallet-1/charge", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
        body: JSON.stringify({ amount_minor: 3000, reference: "COMMISSION" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ transaction_id: "txn-ch", movement_id: "mov-ch" });
    });
  });

  // ── withdraw ───────────────────────────────────────────────────
  describe("withdrawRoute", () => {
    it("Given a valid walletId and body, When POST is called, Then dispatches WithdrawCommand and returns 201", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-wd", movementId: "mov-wd" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      const handlers = withdrawRoute(mutDeps(commandBus));
      app.post("/wallets/:walletId/withdraw", ...handlers);

      const res = await app.request("/wallets/wallet-1/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
        body: JSON.stringify({ amount_minor: 3000 }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ transaction_id: "txn-wd", movement_id: "mov-wd" });
    });
  });

  // ── Missing idempotency-key header (?? "" branch) ─────────────
  describe("Handlers without idempotency-key header", () => {
    it("Given adjustBalance called without idempotency-key header, When POST is called, Then dispatches command with empty string idempotency key", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-1", movementId: "mov-1" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      app.post("/wallets/:walletId/adjust", ...adjustBalanceRoute(mutDeps(commandBus)));

      const res = await app.request("/wallets/wallet-1/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_minor: 1000, reason: "test" }),
      });

      expect(res.status).toBe(201);
      expect(commandBus.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: "" }),
      );
    });

    it("Given captureHold called without idempotency-key header, When POST is called, Then dispatches command with empty string idempotency key", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-1", movementId: "mov-1" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      app.post("/holds/:holdId/capture", ...captureHoldRoute(mutDeps(commandBus)));

      const res = await app.request("/holds/hold-1/capture", { method: "POST" });

      expect(res.status).toBe(201);
      expect(commandBus.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: "" }),
      );
    });

    it("Given deposit called without idempotency-key header, When POST is called, Then dispatches command with empty string idempotency key", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-1", movementId: "mov-1" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      app.post("/wallets/:walletId/deposit", ...depositRoute(mutDeps(commandBus)));

      const res = await app.request("/wallets/wallet-1/deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_minor: 5000 }),
      });

      expect(res.status).toBe(201);
      expect(commandBus.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: "" }),
      );
    });

    it("Given transfer called without idempotency-key header, When POST is called, Then dispatches command with empty string idempotency key", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({
          sourceTransactionId: "txn-out",
          targetTransactionId: "txn-in",
          movementId: "mov-xfer",
        }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      app.post("/transfers", ...transferRoute(mutDeps(commandBus)));

      const res = await app.request("/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_wallet_id: "wallet-1",
          target_wallet_id: "wallet-2",
          amount_minor: 1000,
        }),
      });

      expect(res.status).toBe(201);
      expect(commandBus.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: "" }),
      );
    });

    it("Given charge called without idempotency-key header, When POST is called, Then dispatches command with empty string idempotency key", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-ch", movementId: "mov-ch" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      app.post("/wallets/:walletId/charge", ...chargeRoute(mutDeps(commandBus)));

      const res = await app.request("/wallets/wallet-1/charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_minor: 3000 }),
      });

      expect(res.status).toBe(201);
      expect(commandBus.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: "" }),
      );
    });

    it("Given withdraw called without idempotency-key header, When POST is called, Then dispatches command with empty string idempotency key", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ transactionId: "txn-wd", movementId: "mov-wd" }),
      };
      const app = withContext(new Hono<{ Variables: HonoVariables }>());
      app.post("/wallets/:walletId/withdraw", ...withdrawRoute(mutDeps(commandBus)));

      const res = await app.request("/wallets/wallet-1/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_minor: 3000 }),
      });

      expect(res.status).toBe(201);
      expect(commandBus.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: "" }),
      );
    });
  });

  // ── Missing platformId (buildAuthenticatedAppContext throws) ───
  describe("Handler without platformId in context", () => {
    /** Injects tracking context but omits platformId (simulating missing apiKeyAuth). */
    function withContextNoPlatform(app: Hono<{ Variables: HonoVariables }>) {
      app.use("*", async (c, next) => {
        c.set("trackingId", "test-tracking");
        c.set("startTs", Date.now());
        c.set("canonical", new CanonicalAccumulator());
        // platformId deliberately NOT set
        await next();
      });
      return app;
    }

    it("Given platformId is not set in context, When captureHold POST is called, Then returns 500 error", async () => {
      const commandBus: ICommandBus = { dispatch: vi.fn() };
      const app = withContextNoPlatform(new Hono<{ Variables: HonoVariables }>());
      app.post("/holds/:holdId/capture", ...captureHoldRoute(mutDeps(commandBus)));

      const res = await app.request("/holds/hold-1/capture", { method: "POST" });

      expect(res.status).toBe(500);
    });
  });

  // ── Async-path branches (WALLET_ASYNC_PROCESSING_ENABLED + subscriber wired) ──
  describe("Async-path mutating handlers", () => {
    function withAsyncDispatch(commandBus: ICommandBus, observed: unknown, opts?: { queryBus?: IQueryBus }): MutationHandlerDeps {
      const subscriber = { waitFor: vi.fn().mockResolvedValue(observed) };
      return {
        commandBus,
        queryBus: opts?.queryBus ?? { dispatch: vi.fn() },
        asyncDispatch: {
          resultSubscriber: subscriber as unknown as MutationHandlerDeps["asyncDispatch"] extends { resultSubscriber: infer S } ? S : never,
          handlerWaitMs: 100,
        },
      };
    }

    describe("Given asyncDispatch is wired and the worker publishes a posted result for a deposit", () => {
      it("Then the handler dispatches EnqueueMovementCommand with type='deposit' + the operation queue_payload, then returns 201 with the body the sync path would have returned", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-d1" }),
        };
        const deps = withAsyncDispatch(commandBus, {
          movementId: "mov-d1",
          status: "posted",
          body: { transactionId: "tx-d1", movementId: "mov-d1" },
        });

        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/wallets/:walletId/deposit", ...depositRoute(deps));

        const res = await app.request("/wallets/wallet-1/deposit", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "idem-d" },
          body: JSON.stringify({ amount_minor: 1500, reference: "ref-1", metadata: { x: 1 } }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body).toEqual({ transaction_id: "tx-d1", movement_id: "mov-d1" });

        // The bus saw EnqueueMovementCommand (not DepositCommand).
        const [, cmd] = (commandBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(cmd.movementType).toBe("deposit");
        expect(cmd.idempotencyKey).toBe("idem-d");
        expect(cmd.queuePayload).toMatchObject({
          walletId: "wallet-1",
          amountMinor: "1500",
          idempotencyKey: "idem-d",
          reference: "ref-1",
        });
      });
    });

    describe("Given the wait window expires before a result arrives (deposit slow path)", () => {
      it("Then the handler returns 202 with the movement_id so the client can poll GET /v1/movements/{id}", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-pending" }),
        };
        const deps = withAsyncDispatch(commandBus, null);

        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/wallets/:walletId/deposit", ...depositRoute(deps));

        const res = await app.request("/wallets/wallet-1/deposit", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "idem-d" },
          body: JSON.stringify({ amount_minor: 1500 }),
        });

        expect(res.status).toBe(202);
        const body = await res.json();
        expect(body).toEqual({ movement_id: "mov-pending", status: "pending" });
      });
    });

    describe("Given the worker publishes a failed result", () => {
      it("Then the handler throws an AppError(domainRule, MOVEMENT_FAILED) carrying the worker's failedReason — the global onError maps it to 422 in production", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-failed" }),
        };
        const deps = withAsyncDispatch(commandBus, {
          movementId: "mov-failed",
          status: "failed",
          failedReason: "insufficient funds",
        });

        // Minimal app.onError mimicking the production handler so the
        // 422 mapping is exercised end-to-end (kind=DomainRule → 422).
        const { AppError } = await import("@/utils/kernel/appError.js");
        const { httpStatus, errorResponse } = await import(
          "@/utils/infrastructure/hono.error.js"
        );
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.onError((err, c) => {
          if (AppError.is(err)) {
            return errorResponse(c, err.code, err.msg, httpStatus(err.kind));
          }
          throw err;
        });
        app.post("/wallets/:walletId/withdraw", ...withdrawRoute(deps));

        const res = await app.request("/wallets/wallet-1/withdraw", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "idem-w" },
          body: JSON.stringify({ amount_minor: 100_000 }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body).toEqual({ error: "MOVEMENT_FAILED", message: "insufficient funds" });
      });
    });

    describe("Given the async path is on for charge", () => {
      it("Then the handler dispatches EnqueueMovementCommand with type='charge' + reference + metadata in the queue_payload", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-c" }),
        };
        const deps = withAsyncDispatch(commandBus, {
          movementId: "mov-c",
          status: "posted",
          body: { transactionId: "tx-c", movementId: "mov-c" },
        });
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/wallets/:walletId/charge", ...chargeRoute(deps));

        const res = await app.request("/wallets/wallet-1/charge", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "idem-c" },
          body: JSON.stringify({ amount_minor: 250, reference: "subscription", metadata: { plan: "pro" } }),
        });

        expect(res.status).toBe(201);
        const [, cmd] = (commandBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(cmd.movementType).toBe("charge");
        expect(cmd.queuePayload.reference).toBe("subscription");
        expect(cmd.queuePayload.metadata).toEqual({ plan: "pro" });
      });
    });

    describe("Given the async path is on for adjustBalance", () => {
      it("Then the queue_payload carries reason + allowNegativeBalance (the boolean flag the sync use case reads from context)", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-a" }),
        };
        const deps = withAsyncDispatch(commandBus, {
          movementId: "mov-a",
          status: "posted",
          body: { transactionId: "tx-a", movementId: "mov-a" },
        });
        const app = new Hono<{ Variables: HonoVariables }>();
        app.use("*", async (c, next) => {
          c.set("trackingId", "test-tracking");
          c.set("startTs", Date.now());
          c.set("canonical", new CanonicalAccumulator());
          c.set("platformId", "platform-1");
          c.set("allowNegativeBalance", true);
          await next();
        });
        app.post("/wallets/:walletId/adjust", ...adjustBalanceRoute(deps));

        const res = await app.request("/wallets/wallet-1/adjust", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "idem-a" },
          body: JSON.stringify({
            amount_minor: -500,
            reason: "manual fee",
            reference: "ref-a",
            metadata: { promo: true },
          }),
        });

        expect(res.status).toBe(201);
        const [, cmd] = (commandBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(cmd.movementType).toBe("adjustment");
        expect(cmd.queuePayload.reason).toBe("manual fee");
        expect(cmd.queuePayload.allowNegativeBalance).toBe(true);
        expect(cmd.queuePayload.amountMinor).toBe("-500");
        expect(cmd.reason).toBe("manual fee");
      });
    });

    describe("Given the async path is on for transfer", () => {
      it("Then the queue_payload carries source + target wallet ids and the response reshapes outcome.body into the sync transfer JSON", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-t" }),
        };
        const deps = withAsyncDispatch(commandBus, {
          movementId: "mov-t",
          status: "posted",
          body: {
            sourceTransactionId: "tx-src",
            targetTransactionId: "tx-tgt",
            movementId: "mov-t",
          },
        });
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/transfers", ...transferRoute(deps));

        const res = await app.request("/transfers", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "idem-t" },
          body: JSON.stringify({
            source_wallet_id: "wallet-a",
            target_wallet_id: "wallet-b",
            amount_minor: 1000,
            reference: "p2p",
            metadata: { tag: "social" },
          }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body).toEqual({
          source_transaction_id: "tx-src",
          target_transaction_id: "tx-tgt",
          movement_id: "mov-t",
        });
        const [, cmd] = (commandBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(cmd.queuePayload.sourceWalletId).toBe("wallet-a");
        expect(cmd.queuePayload.targetWalletId).toBe("wallet-b");
      });
    });

    describe("Given the async path is on for captureHold", () => {
      it("Then the handler pre-resolves walletId via GetHoldQuery and forwards it in queue_payload so the worker's hydrator never re-queries", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-ch" }),
        };
        const queryBus: IQueryBus = {
          dispatch: vi
            .fn()
            .mockResolvedValue({ id: "hold-1", wallet_id: "w-of-hold", status: "active" }),
        };
        const deps = withAsyncDispatch(
          commandBus,
          {
            movementId: "mov-ch",
            status: "posted",
            body: { transactionId: "tx-ch", movementId: "mov-ch" },
          },
          { queryBus },
        );
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/holds/:holdId/capture", ...captureHoldRoute(deps));

        const res = await app.request("/holds/hold-1/capture", {
          method: "POST",
          headers: { "idempotency-key": "idem-ch" },
        });

        expect(res.status).toBe(201);
        // queryBus.dispatch was called with a GetHoldQuery
        expect(queryBus.dispatch).toHaveBeenCalledOnce();
        // commandBus saw EnqueueMovementCommand with pre-resolved walletId
        const [, cmd] = (commandBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(cmd.movementType).toBe("hold_capture");
        expect(cmd.queuePayload).toEqual({
          holdId: "hold-1",
          walletId: "w-of-hold",
          idempotencyKey: "idem-ch",
          systemWalletShardCount: 0,
        });
      });

      it("Given the pre-resolve query throws (hold not found or cross-tenant), Then the handler short-circuits BEFORE enqueueing — the worker never sees a wasted message", async () => {
        const commandBus: ICommandBus = { dispatch: vi.fn() };
        const queryBus: IQueryBus = {
          dispatch: vi.fn().mockRejectedValue(new Error("hold not found")),
        };
        const deps = withAsyncDispatch(
          commandBus,
          {
            movementId: "mov-ch",
            status: "posted",
            body: {},
          },
          { queryBus },
        );
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/holds/:holdId/capture", ...captureHoldRoute(deps));

        const res = await app.request("/holds/unknown-hold/capture", {
          method: "POST",
          headers: { "idempotency-key": "idem-ch" },
        });

        expect(res.status).toBe(500); // the AppError-from-query would normally map; the test stub throws plain Error → 500
        expect(commandBus.dispatch).not.toHaveBeenCalled();
      });
    });

    // ── Cover every remaining branch (pending + failed) per handler ──
    //
    // The async logic is identical across handlers but each handler has
    // its own copy of the if/else block (line-coverage requires hitting
    // each one). These cases are minimal — just enough to exercise the
    // pending and failed code paths in the five non-deposit/withdraw
    // handlers tested above.
    describe("Remaining per-handler async branches", () => {
      function pendingDeps(commandBus: ICommandBus, opts?: { queryBus?: IQueryBus }): MutationHandlerDeps {
        return withAsyncDispatch(commandBus, null, opts);
      }
      function failedDeps(commandBus: ICommandBus, opts?: { queryBus?: IQueryBus }): MutationHandlerDeps {
        return withAsyncDispatch(
          commandBus,
          { movementId: "mov-f", status: "failed", failedReason: "domain rejection" },
          opts,
        );
      }

      async function buildAppWithOnError() {
        const { AppError } = await import("@/utils/kernel/appError.js");
        const { httpStatus, errorResponse } = await import("@/utils/infrastructure/hono.error.js");
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.onError((err, c) => {
          if (AppError.is(err)) return errorResponse(c, err.code, err.msg, httpStatus(err.kind));
          throw err;
        });
        return app;
      }

      it("deposit: failed branch → 422 MOVEMENT_FAILED", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-f" }),
        };
        const app = await buildAppWithOnError();
        app.post("/wallets/:walletId/deposit", ...depositRoute(failedDeps(commandBus)));
        const res = await app.request("/wallets/wallet-1/deposit", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "i" },
          body: JSON.stringify({ amount_minor: 100 }),
        });
        expect(res.status).toBe(422);
      });

      it("withdraw: pending branch → 202", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-p" }),
        };
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/wallets/:walletId/withdraw", ...withdrawRoute(pendingDeps(commandBus)));
        const res = await app.request("/wallets/wallet-1/withdraw", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "i" },
          body: JSON.stringify({ amount_minor: 50 }),
        });
        expect(res.status).toBe(202);
      });

      it("withdraw: completed branch with reference + metadata covers both queue_payload spread branches", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-w" }),
        };
        const deps = withAsyncDispatch(commandBus, {
          movementId: "mov-w",
          status: "posted",
          body: { transactionId: "tx-w", movementId: "mov-w" },
        });
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/wallets/:walletId/withdraw", ...withdrawRoute(deps));
        const res = await app.request("/wallets/wallet-1/withdraw", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "i" },
          body: JSON.stringify({ amount_minor: 50, reference: "atm", metadata: { source: "card" } }),
        });
        expect(res.status).toBe(201);
        const [, cmd] = (commandBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(cmd.queuePayload.reference).toBe("atm");
        expect(cmd.queuePayload.metadata).toEqual({ source: "card" });
      });

      it("charge: pending branch → 202", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-pc" }),
        };
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/wallets/:walletId/charge", ...chargeRoute(pendingDeps(commandBus)));
        const res = await app.request("/wallets/wallet-1/charge", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "i" },
          body: JSON.stringify({ amount_minor: 50 }),
        });
        expect(res.status).toBe(202);
      });

      it("charge: failed branch → 422", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-fc" }),
        };
        const app = await buildAppWithOnError();
        app.post("/wallets/:walletId/charge", ...chargeRoute(failedDeps(commandBus)));
        const res = await app.request("/wallets/wallet-1/charge", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "i" },
          body: JSON.stringify({ amount_minor: 50 }),
        });
        expect(res.status).toBe(422);
      });

      it("adjustBalance: pending branch → 202", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-pa" }),
        };
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/wallets/:walletId/adjust", ...adjustBalanceRoute(pendingDeps(commandBus)));
        const res = await app.request("/wallets/wallet-1/adjust", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "i" },
          body: JSON.stringify({ amount_minor: 50, reason: "test" }),
        });
        expect(res.status).toBe(202);
      });

      it("adjustBalance: failed branch → 422", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-fa" }),
        };
        const app = await buildAppWithOnError();
        app.post("/wallets/:walletId/adjust", ...adjustBalanceRoute(failedDeps(commandBus)));
        const res = await app.request("/wallets/wallet-1/adjust", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "i" },
          body: JSON.stringify({ amount_minor: 50, reason: "test" }),
        });
        expect(res.status).toBe(422);
      });

      it("transfer: pending branch → 202", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-pt" }),
        };
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/transfers", ...transferRoute(pendingDeps(commandBus)));
        const res = await app.request("/transfers", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "i" },
          body: JSON.stringify({
            source_wallet_id: "a",
            target_wallet_id: "b",
            amount_minor: 10,
          }),
        });
        expect(res.status).toBe(202);
      });

      it("transfer: failed branch → 422", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-ft" }),
        };
        const app = await buildAppWithOnError();
        app.post("/transfers", ...transferRoute(failedDeps(commandBus)));
        const res = await app.request("/transfers", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "i" },
          body: JSON.stringify({
            source_wallet_id: "a",
            target_wallet_id: "b",
            amount_minor: 10,
          }),
        });
        expect(res.status).toBe(422);
      });

      it("captureHold: pending branch → 202", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-pch" }),
        };
        const queryBus: IQueryBus = {
          dispatch: vi.fn().mockResolvedValue({ id: "h", wallet_id: "w", status: "active" }),
        };
        const app = withContext(new Hono<{ Variables: HonoVariables }>());
        app.post("/holds/:holdId/capture", ...captureHoldRoute(pendingDeps(commandBus, { queryBus })));
        const res = await app.request("/holds/h/capture", {
          method: "POST",
          headers: { "idempotency-key": "i" },
        });
        expect(res.status).toBe(202);
      });

      it("captureHold: failed branch → 422", async () => {
        const commandBus: ICommandBus = {
          dispatch: vi.fn().mockResolvedValue({ movementId: "mov-fch" }),
        };
        const queryBus: IQueryBus = {
          dispatch: vi.fn().mockResolvedValue({ id: "h", wallet_id: "w", status: "active" }),
        };
        const app = await buildAppWithOnError();
        app.post("/holds/:holdId/capture", ...captureHoldRoute(failedDeps(commandBus, { queryBus })));
        const res = await app.request("/holds/h/capture", {
          method: "POST",
          headers: { "idempotency-key": "i" },
        });
        expect(res.status).toBe(422);
      });
    });
  });
});
