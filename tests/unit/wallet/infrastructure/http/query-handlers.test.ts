import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { IQueryBus } from "@/utils/application/cqrs.js";

import { getHoldRoute } from "@/wallet/infrastructure/adapters/inbound/http/getHold/handler.js";
import { getBalanceTimeseriesRoute } from "@/wallet/infrastructure/adapters/inbound/http/getBalanceTimeseries/handler.js";
import { getLedgerEntriesRoute } from "@/wallet/infrastructure/adapters/inbound/http/getLedgerEntries/handler.js";
import { getCashFlowRoute } from "@/wallet/infrastructure/adapters/inbound/http/getCashFlow/handler.js";
import { getStatementEntryRoute } from "@/wallet/infrastructure/adapters/inbound/http/getStatementEntry/handler.js";
import { getTransactionsRoute } from "@/wallet/infrastructure/adapters/inbound/http/getTransactions/handler.js";
import { getStatementRoute } from "@/wallet/infrastructure/adapters/inbound/http/getStatement/handler.js";
import { listCurrenciesRoute } from "@/wallet/infrastructure/adapters/inbound/http/listCurrencies/handler.js";
import { listHoldsRoute } from "@/wallet/infrastructure/adapters/inbound/http/listHolds/handler.js";
import { listWalletsRoute } from "@/wallet/infrastructure/adapters/inbound/http/listWallets/handler.js";
import { getWalletMovementBreakdownRoute } from "@/wallet/infrastructure/adapters/inbound/http/getWalletMovementBreakdown/handler.js";
import { getPlatformMovementBreakdownRoute } from "@/wallet/infrastructure/adapters/inbound/http/getPlatformMovementBreakdown/handler.js";

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
          amount_minor: 1000,
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

  // ── getStatement ─────────────────────────────────────────
  describe("getStatementRoute", () => {
    it("Given a valid walletId param, When GET is called, Then it dispatches GetStatementQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({
          entries: [],
          next_cursor: null,
        }),
      };

      const handlers = getStatementRoute(queryBus);
      const app = buildApp("/wallets/:walletId/statement", handlers);

      const res = await app.request("/wallets/wallet-1/statement");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries).toEqual([]);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });

    it("Given a valid free-text q, When GET is called, Then q is forwarded on the query", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({ entries: [], next_cursor: null }),
      };

      const handlers = getStatementRoute(queryBus);
      const app = buildApp("/wallets/:walletId/statement", handlers);

      const res = await app.request("/wallets/wallet-1/statement?q=rolex");

      expect(res.status).toBe(200);
      const dispatched = (queryBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(dispatched.q).toBe("rolex");
    });

    it("Given a q longer than the limit, When GET is called, Then it is rejected with 400", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({ entries: [], next_cursor: null }),
      };

      const handlers = getStatementRoute(queryBus);
      const app = buildApp("/wallets/:walletId/statement", handlers);

      const res = await app.request(`/wallets/wallet-1/statement?q=${"x".repeat(257)}`);

      expect(res.status).toBe(400);
      expect(queryBus.dispatch).not.toHaveBeenCalled();
    });

    it("Given direction and include_total, When GET is called, Then both are forwarded on the query", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({ entries: [], next_cursor: null, total: 0 }),
      };

      const handlers = getStatementRoute(queryBus);
      const app = buildApp("/wallets/:walletId/statement", handlers);

      const res = await app.request(
        "/wallets/wallet-1/statement?direction=credit&include_total=true",
      );

      expect(res.status).toBe(200);
      const dispatched = (queryBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(dispatched.direction).toBe("credit");
      expect(dispatched.includeTotal).toBe(true);
    });

    it("Given an invalid direction, When GET is called, Then it is rejected with 400", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({ entries: [], next_cursor: null }),
      };

      const handlers = getStatementRoute(queryBus);
      const app = buildApp("/wallets/:walletId/statement", handlers);

      const res = await app.request("/wallets/wallet-1/statement?direction=sideways");

      expect(res.status).toBe(400);
      expect(queryBus.dispatch).not.toHaveBeenCalled();
    });
  });

  // ── getStatementEntry ────────────────────────────────────────────────
  describe("getStatementEntryRoute", () => {
    it("Given valid walletId and movementId params, When GET is called, Then it dispatches GetStatementEntryQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({ movement_id: "mv-1", transaction_id: "tx-1" }),
      };

      const handlers = getStatementEntryRoute(queryBus);
      const app = buildApp("/wallets/:walletId/statement/:movementId", handlers);

      const res = await app.request("/wallets/wallet-1/statement/mv-1");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.movement_id).toBe("mv-1");
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });
  });

  // ── getCashFlow ───────────────────────────────────────────────
  describe("getCashFlowRoute", () => {
    it("Given a valid walletId and range, When GET is called, Then it dispatches GetCashFlowQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({
          income_minor: 0,
          expense_minor: 0,
          net_minor: 0,
          days: 1,
        }),
      };

      const handlers = getCashFlowRoute(queryBus);
      const app = buildApp("/wallets/:walletId/analytics/cash-flow", handlers);

      const res = await app.request(
        "/wallets/wallet-1/analytics/cash-flow?from=1700000000000&to=1700100000000",
      );

      expect(res.status).toBe(200);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });
  });

  // ── getBalanceTimeseries ───────────────────────────────────────
  describe("getBalanceTimeseriesRoute", () => {
    it("Given a valid walletId and range, When GET is called, Then it dispatches GetBalanceTimeseriesQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({ points: [] }),
      };

      const handlers = getBalanceTimeseriesRoute(queryBus);
      const app = buildApp("/wallets/:walletId/analytics/balance-timeseries", handlers);

      const res = await app.request(
        "/wallets/wallet-1/analytics/balance-timeseries?from=1700000000000&to=1700100000000",
      );

      expect(res.status).toBe(200);
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

  // ── listWallets ────────────────────────────────────────────────
  describe("listWalletsRoute", () => {
    it("Given no query params, When GET is called, Then it dispatches ListWalletsQuery and returns 200", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({
          wallets: [],
          next_cursor: null,
        }),
      };

      const handlers = listWalletsRoute(queryBus);
      const app = buildApp("/wallets", handlers);

      const res = await app.request("/wallets");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.wallets).toEqual([]);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });

    it("Given an owner_id filter, When GET is called, Then it dispatches ListWalletsQuery with the filter", async () => {
      const queryBus: IQueryBus = {
        dispatch: vi.fn().mockResolvedValue({
          wallets: [
            {
              id: "wallet-1",
              owner_id: "owner-1",
              platform_id: "platform-1",
              currency_code: "USD",
              balance_minor: 1000,
              available_balance_minor: 1000,
              status: "active",
              is_system: false,
              created_at: 1700000000000,
              updated_at: 1700000000000,
            },
          ],
          next_cursor: null,
        }),
      };

      const handlers = listWalletsRoute(queryBus);
      const app = buildApp("/wallets", handlers);

      const res = await app.request("/wallets?filter%5Bowner_id%5D=owner-1&filter%5Bcurrency_code%5D=USD");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.wallets).toHaveLength(1);
      expect(body.wallets[0].owner_id).toBe("owner-1");
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });
  });

  // ── getWalletMovementBreakdown ─────────────────────────────────
  describe("getWalletMovementBreakdownRoute", () => {
    const buckets = [
      { bucket: "deposit", sum_net_minor: 7000, sum_credits_minor: 10000, sum_debits_minor: -3000, count: 5 },
    ];

    it("Given a valid walletId, range and group_by, When GET is called, Then it dispatches and returns 200", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn().mockResolvedValue(buckets) };
      const app = buildApp(
        "/wallets/:walletId/analytics/movement-breakdown",
        getWalletMovementBreakdownRoute(queryBus),
      );

      const res = await app.request(
        "/wallets/wallet-1/analytics/movement-breakdown?from=1700000000000&to=1700100000000&group_by=type",
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(buckets);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });

    it("Given group_by=metadata with a metadata_key, When GET is called, Then it returns 200", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn().mockResolvedValue(buckets) };
      const app = buildApp(
        "/wallets/:walletId/analytics/movement-breakdown",
        getWalletMovementBreakdownRoute(queryBus),
      );

      const res = await app.request(
        "/wallets/wallet-1/analytics/movement-breakdown?from=1&to=2&group_by=metadata&metadata_key=reasonKey",
      );

      expect(res.status).toBe(200);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });

    it("Given to < from, When GET is called, Then it is rejected with 400", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn() };
      const app = buildApp(
        "/wallets/:walletId/analytics/movement-breakdown",
        getWalletMovementBreakdownRoute(queryBus),
      );

      const res = await app.request(
        "/wallets/wallet-1/analytics/movement-breakdown?from=2000&to=1000&group_by=type",
      );

      expect(res.status).toBe(400);
      expect(queryBus.dispatch).not.toHaveBeenCalled();
    });

    it("Given group_by=metadata without a metadata_key, When GET is called, Then it is rejected with 400", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn() };
      const app = buildApp(
        "/wallets/:walletId/analytics/movement-breakdown",
        getWalletMovementBreakdownRoute(queryBus),
      );

      const res = await app.request(
        "/wallets/wallet-1/analytics/movement-breakdown?from=1&to=2&group_by=metadata",
      );

      expect(res.status).toBe(400);
      expect(queryBus.dispatch).not.toHaveBeenCalled();
    });

    it("Given a metadata_filter_key and value, When GET is called, Then they are forwarded and it returns 200", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn().mockResolvedValue(buckets) };
      const app = buildApp(
        "/wallets/:walletId/analytics/movement-breakdown",
        getWalletMovementBreakdownRoute(queryBus),
      );

      const res = await app.request(
        "/wallets/wallet-1/analytics/movement-breakdown?from=1&to=2&group_by=month&metadata_filter_key=reasonKey&metadata_filter_value=_MovementReasonSettlementSales",
      );

      expect(res.status).toBe(200);
      const dispatched = (queryBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(dispatched.metadataFilterKey).toBe("reasonKey");
      expect(dispatched.metadataFilterValue).toBe("_MovementReasonSettlementSales");
    });

    it("Given a metadata_filter_key without a value, When GET is called, Then it is rejected with 400", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn() };
      const app = buildApp(
        "/wallets/:walletId/analytics/movement-breakdown",
        getWalletMovementBreakdownRoute(queryBus),
      );

      const res = await app.request(
        "/wallets/wallet-1/analytics/movement-breakdown?from=1&to=2&group_by=type&metadata_filter_key=reasonKey",
      );

      expect(res.status).toBe(400);
      expect(queryBus.dispatch).not.toHaveBeenCalled();
    });
  });

  // ── getPlatformMovementBreakdown ───────────────────────────────
  describe("getPlatformMovementBreakdownRoute", () => {
    const buckets = [
      { bucket: "owner-1", sum_net_minor: 5000, sum_credits_minor: 8000, sum_debits_minor: -3000, count: 9 },
    ];

    it("Given a valid range and group_by=owner, When GET is called, Then it dispatches and returns 200", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn().mockResolvedValue(buckets) };
      const app = buildApp("/analytics/movement-breakdown", getPlatformMovementBreakdownRoute(queryBus));

      const res = await app.request(
        "/analytics/movement-breakdown?from=1700000000000&to=1700100000000&group_by=owner",
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(buckets);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });

    it("Given group_by=metadata with key and owner_id, When GET is called, Then it returns 200", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn().mockResolvedValue(buckets) };
      const app = buildApp("/analytics/movement-breakdown", getPlatformMovementBreakdownRoute(queryBus));

      const res = await app.request(
        "/analytics/movement-breakdown?from=1&to=2&group_by=metadata&metadata_key=reasonKey&owner_id=owner-7",
      );

      expect(res.status).toBe(200);
      expect(queryBus.dispatch).toHaveBeenCalledOnce();
    });

    it("Given an unknown group_by, When GET is called, Then it is rejected with 400", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn() };
      const app = buildApp("/analytics/movement-breakdown", getPlatformMovementBreakdownRoute(queryBus));

      const res = await app.request("/analytics/movement-breakdown?from=1&to=2&group_by=nope");

      expect(res.status).toBe(400);
      expect(queryBus.dispatch).not.toHaveBeenCalled();
    });

    it("Given group_by=metadata without a metadata_key, When GET is called, Then it is rejected with 400", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn() };
      const app = buildApp("/analytics/movement-breakdown", getPlatformMovementBreakdownRoute(queryBus));

      const res = await app.request("/analytics/movement-breakdown?from=1&to=2&group_by=metadata");

      expect(res.status).toBe(400);
      expect(queryBus.dispatch).not.toHaveBeenCalled();
    });

    it("Given a metadata_filter_value without a key, When GET is called, Then it is rejected with 400", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn() };
      const app = buildApp("/analytics/movement-breakdown", getPlatformMovementBreakdownRoute(queryBus));

      const res = await app.request(
        "/analytics/movement-breakdown?from=1&to=2&group_by=owner&metadata_filter_value=orphan",
      );

      expect(res.status).toBe(400);
      expect(queryBus.dispatch).not.toHaveBeenCalled();
    });

    it("Given a metadata_filter_key and value, When GET is called, Then they are forwarded and it returns 200", async () => {
      const queryBus: IQueryBus = { dispatch: vi.fn().mockResolvedValue(buckets) };
      const app = buildApp("/analytics/movement-breakdown", getPlatformMovementBreakdownRoute(queryBus));

      const res = await app.request(
        "/analytics/movement-breakdown?from=1&to=2&group_by=month&metadata_filter_key=reasonKey&metadata_filter_value=_MovementReasonSettlementSales",
      );

      expect(res.status).toBe(200);
      const dispatched = (queryBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(dispatched.metadataFilterKey).toBe("reasonKey");
      expect(dispatched.metadataFilterValue).toBe("_MovementReasonSettlementSales");
    });
  });
});
