import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { IQueryBus } from "@/utils/application/cqrs.js";

import { getHoldRoute } from "@/wallet/infrastructure/adapters/inbound/http/getHold/handler.js";
import { getLedgerEntriesRoute } from "@/wallet/infrastructure/adapters/inbound/http/getLedgerEntries/handler.js";
import { getTransactionsRoute } from "@/wallet/infrastructure/adapters/inbound/http/getTransactions/handler.js";
import { listCurrenciesRoute } from "@/wallet/infrastructure/adapters/inbound/http/listCurrencies/handler.js";
import { listHoldsRoute } from "@/wallet/infrastructure/adapters/inbound/http/listHolds/handler.js";

/**
 * Builds a minimal Hono app with tracking context that mounts the given route handlers.
 */
function buildApp(
  mountPath: string,
  handlers: ReturnType<typeof getHoldRoute>,
) {
  const app = new Hono<{ Variables: HonoVariables }>();

  app.use("*", async (c, next) => {
    c.set("trackingId", "test-tracking");
    c.set("startTs", Date.now());
    c.set("canonical", new CanonicalAccumulator());
    c.set("platformId", "platform-1");
    await next();
  });

  app.get(mountPath, ...handlers);

  return app;
}

describe("Wallet query HTTP handlers", () => {
  // ── getHold ────────────────────────────────────────────────────
  describe("getHoldRoute", () => {
    it("Given a valid holdId param, When GET is called, Then it dispatches GetHoldQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({
          id: "hold-1",
          wallet_id: "wallet-1",
          amount_cents: 1000,
          status: "active",
          reference: null,
          expires_at: null,
          created_at: 1700000000000,
          updated_at: 1700000000000,
        }),
      };

      const handlers = getHoldRoute(queryBus);
      const app = buildApp("/holds/:holdId", handlers);

      const res = await app.request("/holds/hold-1");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe("hold-1");
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });
  });

  // ── getLedgerEntries ───────────────────────────────────────────
  describe("getLedgerEntriesRoute", () => {
    it("Given a valid walletId param, When GET is called, Then it dispatches GetLedgerEntriesQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({
          ledger_entries: [],
          next_cursor: null,
        }),
      };

      const handlers = getLedgerEntriesRoute(queryBus);
      const app = buildApp("/wallets/:walletId/ledger-entries", handlers);

      const res = await app.request("/wallets/wallet-1/ledger-entries");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ledger_entries).toEqual([]);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });
  });

  // ── getTransactions ───────────────────────────────────────────
  describe("getTransactionsRoute", () => {
    it("Given a valid walletId param, When GET is called, Then it dispatches GetTransactionsQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({
          transactions: [],
          next_cursor: null,
        }),
      };

      const handlers = getTransactionsRoute(queryBus);
      const app = buildApp("/wallets/:walletId/transactions", handlers);

      const res = await app.request("/wallets/wallet-1/transactions");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.transactions).toEqual([]);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });
  });

  // ── listCurrencies ─────────────────────────────────────────────
  describe("listCurrenciesRoute", () => {
    it("Given the currencies endpoint, When GET is called, Then it returns 200 with supported currencies", async () => {
      const handlers = listCurrenciesRoute();
      const app = buildApp("/currencies", handlers);

      const res = await app.request("/currencies");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.currencies).toEqual([
        { code: "USD", minor_unit: 2 },
        { code: "EUR", minor_unit: 2 },
        { code: "MXN", minor_unit: 2 },
        { code: "CLP", minor_unit: 0 },
        { code: "KWD", minor_unit: 3 },
      ]);
    });
  });

  // ── listHolds ─────────────────────────────────────────────────
  describe("listHoldsRoute", () => {
    it("Given a valid walletId param, When GET is called, Then it dispatches ListHoldsQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({
          holds: [],
          next_cursor: null,
        }),
      };

      const handlers = listHoldsRoute(queryBus);
      const app = buildApp("/wallets/:walletId/holds", handlers);

      const res = await app.request("/wallets/wallet-1/holds");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.holds).toEqual([]);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });
  });
});
