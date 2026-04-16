import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";
import { getTestPrisma } from "@test/helpers/db.js";

describe("Charge E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = () => `charge-${++idempCounter}-${Date.now()}`;

  async function createWallet(ownerId: string, currency = "USD"): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).wallet_id;
  }

  async function deposit(walletId: string, amountMinor: number): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_minor: amountMinor }),
    });
    expect(res.status).toBe(201);
  }

  async function getBalance(walletId: string): Promise<number> {
    const res = await app.request(`/v1/wallets/${walletId}`);
    expect(res.status).toBe(200);
    return Number((await res.json()).balance_minor);
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  describe("Given a wallet with 10000 cents", () => {
    let walletId: string;

    beforeEach(async () => {
      walletId = await createWallet("charge-user");
      await deposit(walletId, 10000);
    });

    describe("When charging 3000 cents as a commission", () => {
      it("Then it returns 201 with transaction_id and movement_id", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 3000, reference: "COMMISSION" }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.transaction_id).toBeDefined();
        expect(body.movement_id).toBeDefined();
      });

      it("Then the wallet balance decreases by 3000", async () => {
        await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 3000 }),
        });

        expect(await getBalance(walletId)).toBe(7000);
      });
    });

    describe("When charging the exact balance (10000 cents)", () => {
      it("Then it succeeds and balance becomes 0", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 10000 }),
        });
        expect(res.status).toBe(201);

        expect(await getBalance(walletId)).toBe(0);
      });
    });

    describe("When charging more than the balance", () => {
      it("Then it rejects with 422 INSUFFICIENT_FUNDS", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 99999 }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("INSUFFICIENT_FUNDS");
      });
    });

    describe("When charging after exact balance drain, then 1 more cent", () => {
      it("Then the second charge fails with INSUFFICIENT_FUNDS", async () => {
        const res1 = await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 10000 }),
        });
        expect(res1.status).toBe(201);

        const res2 = await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 1 }),
        });
        expect(res2.status).toBe(422);
        expect((await res2.json()).error).toBe("INSUFFICIENT_FUNDS");
      });
    });

    describe("When charging the minimum amount of 1 cent", () => {
      it("Then it succeeds", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 1 }),
        });
        expect(res.status).toBe(201);
        expect(await getBalance(walletId)).toBe(9999);
      });
    });
  });

  // ── Ledger integrity ──────────────────────────────────────────────────

  describe("Given a wallet that receives a charge", () => {
    it("Then the ledger entries sum to zero for the movement", async () => {
      const walletId = await createWallet("charge-ledger-user");
      await deposit(walletId, 5000);

      const chargeRes = await app.request(`/v1/wallets/${walletId}/charge`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({ amount_minor: 2000, reference: "SERVICE_FEE" }),
      });
      expect(chargeRes.status).toBe(201);
      const { movement_id } = await chargeRes.json();

      const prisma = getTestPrisma();
      const entries = await prisma.ledgerEntry.findMany({
        where: { movementId: movement_id },
      });

      expect(entries).toHaveLength(2);
      const sum = entries.reduce((acc, e) => acc + e.amountMinor, 0n);
      expect(sum).toBe(0n);

      const debit = entries.find((e) => e.entryType === "DEBIT")!;
      const credit = entries.find((e) => e.entryType === "CREDIT")!;
      expect(debit.amountMinor).toBe(-2000n);
      expect(credit.amountMinor).toBe(2000n);
    });
  });

  describe("Given a wallet that receives a charge", () => {
    it("Then the transaction type is 'charge' and the movement type is 'charge'", async () => {
      const walletId = await createWallet("charge-type-user");
      await deposit(walletId, 5000);

      const chargeRes = await app.request(`/v1/wallets/${walletId}/charge`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({ amount_minor: 1000 }),
      });
      expect(chargeRes.status).toBe(201);
      const { transaction_id, movement_id } = await chargeRes.json();

      const prisma = getTestPrisma();
      const tx = await prisma.transaction.findUnique({ where: { id: transaction_id } });
      expect(tx!.type).toBe("charge");

      const movement = await prisma.movement.findUnique({ where: { id: movement_id } });
      expect(movement!.type).toBe("charge");
    });
  });

  describe("Given a wallet with cached balance after charge", () => {
    it("Then cached balance matches ledger sum", async () => {
      const walletId = await createWallet("charge-reconcile-user");
      await deposit(walletId, 8000);

      await app.request(`/v1/wallets/${walletId}/charge`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({ amount_minor: 3000 }),
      });

      const balance = await getBalance(walletId);

      const prisma = getTestPrisma();
      const entries = await prisma.ledgerEntry.findMany({
        where: { walletId },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      expect(BigInt(balance)).toBe(entries[0]!.balanceAfterMinor);
    });
  });

  // ── Frozen wallet ───────────────────────────────────────────────────────

  describe("Given a frozen wallet with funds", () => {
    it("Then charging should reject with 422 WALLET_NOT_ACTIVE", async () => {
      const walletId = await createWallet("charge-frozen-user");
      await deposit(walletId, 5000);
      await app.request(`/v1/wallets/${walletId}/freeze`, { method: "POST" });

      const res = await app.request(`/v1/wallets/${walletId}/charge`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({ amount_minor: 100 }),
      });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("WALLET_NOT_ACTIVE");
    });
  });

  // ── Closed wallet ──────────────────────────────────────────────────────

  describe("Given a closed wallet", () => {
    it("Then charging should reject with 422", async () => {
      const walletId = await createWallet("charge-closed-user");
      await app.request(`/v1/wallets/${walletId}/close`, { method: "POST" });

      const res = await app.request(`/v1/wallets/${walletId}/charge`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({ amount_minor: 100 }),
      });

      expect(res.status).toBe(422);
    });
  });

  // ── Non-existent wallet ────────────────────────────────────────────────

  describe("Given a non-existent wallet ID", () => {
    it("Then charging should return 404", async () => {
      const fakeId = "019560a0-0000-7000-8000-000000000099";
      const res = await app.request(`/v1/wallets/${fakeId}/charge`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({ amount_minor: 100 }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ── Sequential charges draining balance ────────────────────────────────

  describe("Given a wallet with 10000 cents", () => {
    it("Then three sequential charges totaling 10000 succeed and leave balance at 0", async () => {
      const walletId = await createWallet("charge-seq-user");
      await deposit(walletId, 10000);

      for (const amount of [3333, 3333, 3334]) {
        const res = await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: amount }),
        });
        expect(res.status).toBe(201);
      }

      expect(await getBalance(walletId)).toBe(0);
    });
  });

  // ── Deposit → charge → withdraw chain ──────────────────────────────────

  describe("Given a wallet with deposit, charge, and withdrawal operations", () => {
    it("Then the final balance reflects all three operations correctly", async () => {
      const walletId = await createWallet("charge-chain-user");
      await deposit(walletId, 50000);

      // Charge 5000 (commission)
      const chargeRes = await app.request(`/v1/wallets/${walletId}/charge`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({ amount_minor: 5000, reference: "PLATFORM_FEE" }),
      });
      expect(chargeRes.status).toBe(201);

      // Withdraw 20000
      const wdRes = await app.request(`/v1/wallets/${walletId}/withdraw`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({ amount_minor: 20000 }),
      });
      expect(wdRes.status).toBe(201);

      // Balance: 50000 - 5000 - 20000 = 25000
      expect(await getBalance(walletId)).toBe(25000);
    });
  });

  // ── Charge with metadata ───────────────────────────────────────────────

  describe("Given a wallet with funds", () => {
    it("Then a charge with metadata succeeds", async () => {
      const walletId = await createWallet("charge-meta-user");
      await deposit(walletId, 5000);

      const res = await app.request(`/v1/wallets/${walletId}/charge`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({
          amount_minor: 1000,
          reference: "MONTHLY_FEE",
          metadata: { period: "2026-04", type: "subscription" },
        }),
      });

      expect(res.status).toBe(201);
      expect(await getBalance(walletId)).toBe(4000);
    });
  });
});
