import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

const DAY = 86_400_000;

describe("Wallet Analytics E2E (cash-flow + balance-timeseries)", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = (p = "an") => `${p}-${++idempCounter}-${Date.now()}`;

  async function createWallet(ownerId: string, currency = "USD"): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("create") },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).wallet_id;
  }

  async function deposit(walletId: string, amountMinor: number): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("deposit") },
      body: JSON.stringify({ amount_minor: amountMinor }),
    });
    expect(res.status).toBe(201);
  }

  async function charge(walletId: string, amountMinor: number): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/charge`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("charge") },
      body: JSON.stringify({ amount_minor: amountMinor }),
    });
    expect(res.status).toBe(201);
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    idempCounter = 0;
  });

  // ── money-flow ────────────────────────────────────────────────────────────

  describe("Given a wallet with a deposit and a charge", () => {
    it("Then money-flow reports income, expense and net from the wallet's ledger", async () => {
      const walletId = await createWallet("an-flow-user");
      await deposit(walletId, 10000);
      await charge(walletId, 3000);

      const now = Date.now();
      const from = now - DAY;
      const to = now + DAY;

      const res = await app.request(`/v1/wallets/${walletId}/analytics/cash-flow?from=${from}&to=${to}`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.income_minor).toBe(10000);
      expect(body.expense_minor).toBe(3000);
      expect(body.net_minor).toBe(7000);
      expect(body.days).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Given an invalid range where to < from", () => {
    it("Then money-flow returns 400", async () => {
      const walletId = await createWallet("an-badrange-user");
      const res = await app.request(`/v1/wallets/${walletId}/analytics/cash-flow?from=2000&to=1000`);
      expect(res.status).toBe(400);
    });
  });

  describe("Given an unauthenticated client", () => {
    it("Then money-flow returns 401", async () => {
      const walletId = await createWallet("an-auth-user");
      const res = await app.unauthenticatedRequest(
        `/v1/wallets/${walletId}/analytics/cash-flow?from=1&to=2`,
      );
      expect(res.status).toBe(401);
    });
  });

  // ── balance-timeseries ──────────────────────────────────────────────────────

  describe("Given a wallet that received a deposit today", () => {
    it("Then the balance timeseries ends at the deposited balance with one point per day", async () => {
      const walletId = await createWallet("an-series-user");
      await deposit(walletId, 5000);

      const now = Date.now();
      const from = now - DAY; // yesterday + today
      const today = new Date(now).toISOString().slice(0, 10);

      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/balance-timeseries?from=${from}&to=${now}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.points.length).toBeGreaterThanOrEqual(1);
      const last = body.points[body.points.length - 1];
      expect(last.date).toBe(today);
      expect(last.balance_minor).toBe(5000);
    });
  });

  describe("Given a range longer than the maximum", () => {
    it("Then balance-timeseries returns 400 RANGE_TOO_LARGE", async () => {
      const walletId = await createWallet("an-range-user");
      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/balance-timeseries?from=0&to=${Date.now()}`,
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("RANGE_TOO_LARGE");
    });
  });

  describe("Given a non-existent wallet", () => {
    it("Then balance-timeseries returns 404", async () => {
      const fakeId = "019560a0-0000-7000-8000-0000000000cc";
      const res = await app.request(
        `/v1/wallets/${fakeId}/analytics/balance-timeseries?from=1&to=2`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("Given a wallet owned by the victim platform", () => {
    it("Then the attacker platform cannot read its analytics (404)", async () => {
      const victimWalletId = await createWallet("an-victim-user");
      await deposit(victimWalletId, 5000);

      const now = Date.now();
      const res = await app.attackerRequest(
        `/v1/wallets/${victimWalletId}/analytics/cash-flow?from=${now - DAY}&to=${now}`,
      );
      expect(res.status).toBe(404);
    });
  });
});
