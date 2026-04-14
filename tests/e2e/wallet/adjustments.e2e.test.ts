import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Balance Adjustments E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = (prefix = "adjust") => `${prefix}-${++idempCounter}-${Date.now()}`;

  async function createWallet(ownerId: string, currency = "USD"): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("create-wallet") },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.wallet_id;
  }

  async function deposit(walletId: string, amountCents: number): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("deposit") },
      body: JSON.stringify({ amount_cents: amountCents }),
    });
    expect(res.status).toBe(201);
  }

  async function placeHold(walletId: string, amountCents: number): Promise<string> {
    const res = await app.request("/v1/holds", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("hold") },
      body: JSON.stringify({ wallet_id: walletId, amount_cents: amountCents }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.hold_id;
  }

  async function getWallet(walletId: string): Promise<{
    balance_cents: number;
    available_balance_cents: number;
    status: string;
  }> {
    const res = await app.request(`/v1/wallets/${walletId}`);
    expect(res.status).toBe(200);
    return res.json();
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    idempCounter = 0;
  });

  describe("Given an active wallet with funds", () => {
    describe("When applying a positive adjustment", () => {
      it("Then it should persist the adjustment as a zero-sum movement and update the balance", async () => {
        const walletId = await createWallet("adjust-credit-owner");
        await deposit(walletId, 5000);

        const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust-credit") },
          body: JSON.stringify({
            amount_cents: 1500,
            reason: "Promotional credit",
            reference: "promo-1",
            metadata: { source: "ops" },
          }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.transaction_id).toBeDefined();
        expect(body.movement_id).toBeDefined();

        const wallet = await getWallet(walletId);
        expect(wallet.balance_cents).toBe(6500);
        expect(wallet.available_balance_cents).toBe(6500);

        const movement = await app.prisma.movement.findUnique({
          where: { id: body.movement_id },
        });
        expect(movement?.type).toBe("adjustment");
        expect(movement?.reason).toBe("Promotional credit");

        const transactions = await app.prisma.transaction.findMany({
          where: { movementId: body.movement_id },
        });
        expect(transactions).toHaveLength(1);
        expect(transactions[0]?.type).toBe("adjustment_credit");
        expect(transactions[0]?.amountCents).toBe(1500n);
        expect(transactions[0]?.reference).toBe("promo-1");
        expect(transactions[0]?.metadata).toEqual({ source: "ops" });

        const entries = await app.prisma.ledgerEntry.findMany({
          where: { movementId: body.movement_id },
        });
        expect(entries).toHaveLength(2);
        const total = entries.reduce((sum, entry) => sum + Number(entry.amountCents), 0);
        expect(total).toBe(0);
        expect(entries.some((entry) => entry.walletId === walletId && entry.amountCents === 1500n)).toBe(
          true,
        );
        expect(
          entries.some((entry) => entry.walletId !== walletId && entry.amountCents === -1500n),
        ).toBe(true);
      });
    });
  });

  describe("Given a wallet with active holds reducing its available balance", () => {
    describe("When applying a negative adjustment larger than the available amount", () => {
      it("Then it should reject with 422 INSUFFICIENT_FUNDS and keep balances unchanged", async () => {
        const walletId = await createWallet("adjust-debit-insufficient-owner");
        await deposit(walletId, 10000);
        await placeHold(walletId, 4000);

        const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust-insufficient") },
          body: JSON.stringify({
            amount_cents: -7001,
            reason: "Manual correction",
          }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("INSUFFICIENT_FUNDS");

        const wallet = await getWallet(walletId);
        expect(wallet.balance_cents).toBe(10000);
        expect(wallet.available_balance_cents).toBe(6000);
      });
    });
  });

  describe("Given a frozen wallet", () => {
    describe("When applying a positive adjustment", () => {
      it("Then it should succeed and keep the wallet frozen", async () => {
        const walletId = await createWallet("adjust-frozen-owner");
        await deposit(walletId, 3000);

        const freezeRes = await app.request(`/v1/wallets/${walletId}/freeze`, {
          method: "POST",
        });
        expect(freezeRes.status).toBe(200);

        const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust-frozen") },
          body: JSON.stringify({
            amount_cents: 2000,
            reason: "Admin credit on frozen wallet",
          }),
        });

        expect(res.status).toBe(201);

        const wallet = await getWallet(walletId);
        expect(wallet.status).toBe("frozen");
        expect(wallet.balance_cents).toBe(5000);
      });
    });
  });

  describe("Given a closed wallet", () => {
    describe("When applying an adjustment", () => {
      it("Then it should reject with 422 WALLET_CLOSED", async () => {
        const walletId = await createWallet("adjust-closed-owner");

        const closeRes = await app.request(`/v1/wallets/${walletId}/close`, {
          method: "POST",
        });
        expect(closeRes.status).toBe(200);

        const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust-closed") },
          body: JSON.stringify({
            amount_cents: 1000,
            reason: "Should fail",
          }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("WALLET_CLOSED");
      });
    });
  });

  describe("Given a wallet owned by another platform", () => {
    describe("When the attacker platform tries to adjust it", () => {
      it("Then it should return 404", async () => {
        const victimWalletId = await createWallet("adjust-victim-owner");
        await deposit(victimWalletId, 5000);

        const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust-cross-tenant") },
          body: JSON.stringify({
            amount_cents: 1000,
            reason: "Attack attempt",
          }),
        });

        expect(res.status).toBe(404);
      });
    });
  });

  describe("Given a client calling the adjustment endpoint without authentication", () => {
    describe("When posting a valid adjustment body", () => {
      it("Then it should return 401", async () => {
        const walletId = await createWallet("adjust-auth-owner");

        const res = await app.unauthenticatedRequest(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust-unauth") },
          body: JSON.stringify({
            amount_cents: 1000,
            reason: "Unauthorized attempt",
          }),
        });

        expect(res.status).toBe(401);
      });
    });
  });

  describe("Given invalid adjustment payloads", () => {
    describe("When amount_cents is zero", () => {
      it("Then it should reject with 400 or 422", async () => {
        const walletId = await createWallet("adjust-zero-owner");

        const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust-zero") },
          body: JSON.stringify({
            amount_cents: 0,
            reason: "Zero should fail",
          }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When amount_cents is a float", () => {
      it("Then it should reject with 400 or 422", async () => {
        const walletId = await createWallet("adjust-float-owner");

        const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust-float") },
          body: JSON.stringify({
            amount_cents: 100.5,
            reason: "Float should fail",
          }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When reason is missing", () => {
      it("Then it should reject with 400 or 422", async () => {
        const walletId = await createWallet("adjust-no-reason-owner");

        const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust-no-reason") },
          body: JSON.stringify({
            amount_cents: 1000,
          }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });
  });

  describe("Given a successful adjustment with a specific idempotency key", () => {
    describe("When replaying the exact same request", () => {
      it("Then it should return the cached response and apply the adjustment only once", async () => {
        const walletId = await createWallet("adjust-idempotent-owner");
        const idempotencyKey = "adjust-replay-key";
        const body = JSON.stringify({
          amount_cents: 1200,
          reason: "Replay-safe credit",
        });

        const res1 = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body,
        });
        expect(res1.status).toBe(201);
        const payload1 = await res1.json();

        const res2 = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body,
        });
        expect(res2.status).toBe(201);
        const payload2 = await res2.json();

        expect(payload2.transaction_id).toBe(payload1.transaction_id);
        expect(payload2.movement_id).toBe(payload1.movement_id);

        const wallet = await getWallet(walletId);
        expect(wallet.balance_cents).toBe(1200);
      });
    });
  });

  describe("Given an adjustment completed with a specific idempotency key", () => {
    describe("When reusing the same key with a different payload", () => {
      it("Then it should reject with 422 IDEMPOTENCY_PAYLOAD_MISMATCH", async () => {
        const walletId = await createWallet("adjust-idempotent-mismatch-owner");
        const idempotencyKey = "adjust-mismatch-key";

        const res1 = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            amount_cents: 1000,
            reason: "Original adjustment",
          }),
        });
        expect(res1.status).toBe(201);

        const res2 = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            amount_cents: 2000,
            reason: "Different adjustment",
          }),
        });

        expect(res2.status).toBe(422);
        const body = await res2.json();
        expect(body.error).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
      });
    });
  });

  describe("Given the adjustment endpoint is called without an idempotency key", () => {
    describe("When posting a valid mutation body", () => {
      it("Then it should reject with 400 MISSING_IDEMPOTENCY_KEY", async () => {
        const walletId = await createWallet("adjust-no-idempotency-owner");

        const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
          method: "POST",
          body: JSON.stringify({
            amount_cents: 1000,
            reason: "Missing key",
          }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("MISSING_IDEMPOTENCY_KEY");
      });
    });
  });

  describe("Given a wallet receiving concurrent adjustments", () => {
    describe("When 10 positive adjustments of 1000 cents run simultaneously", () => {
      it("Then the final balance should match the number of successful adjustments", async () => {
        const walletId = await createWallet("adjust-concurrency-owner");

        const results = await Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            app.request(`/v1/wallets/${walletId}/adjust`, {
              method: "POST",
              headers: { "Idempotency-Key": `adjust-concurrency-${index}-${Date.now()}` },
              body: JSON.stringify({
                amount_cents: 1000,
                reason: `Concurrent adjustment ${index}`,
              }),
            }),
          ),
        );

        const statuses = results.map((result) => result.status);
        const successes = statuses.filter((status) => status === 201).length;
        const conflicts = statuses.filter((status) => status === 409).length;

        expect(successes + conflicts).toBe(10);
        expect(successes).toBeGreaterThan(0);

        const wallet = await getWallet(walletId);
        expect(wallet.balance_cents).toBe(successes * 1000);
      });
    });
  });
});
