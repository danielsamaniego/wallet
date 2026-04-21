import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";
import { getTestPrisma } from "@test/helpers/db.js";

describe("Wallet Lifecycle E2E", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  describe("Given a wallet with a non-zero balance", () => {
    describe("When attempting to close it", () => {
      it("Then it should reject with 422 WALLET_BALANCE_NOT_ZERO", async () => {
        // Create and fund a wallet
        const createRes = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "wl-close-balance-create" },
          body: JSON.stringify({ owner_id: "user-close-bal", currency_code: "USD" }),
        });
        expect(createRes.status).toBe(201);
        const { wallet_id: walletId } = await createRes.json();

        const depositRes = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "wl-close-balance-deposit" },
          body: JSON.stringify({ amount_minor: 5000 }),
        });
        expect(depositRes.status).toBe(201);

        // Attempt to close with balance
        const closeRes = await app.request(`/v1/wallets/${walletId}/close`, {
          method: "POST",
        });

        expect(closeRes.status).toBe(422);
        const body = await closeRes.json();
        expect(body.error).toBe("WALLET_BALANCE_NOT_ZERO");
      });
    });
  });

  describe("Given a system wallet", () => {
    let systemWalletId: string;

    beforeEach(async () => {
      // Creating a user wallet auto-creates a system wallet for that platform+currency
      const createRes = await app.request("/v1/wallets", {
        method: "POST",
        headers: { "Idempotency-Key": "wl-sys-setup-create" },
        body: JSON.stringify({ owner_id: "user-sys-trigger", currency_code: "USD" }),
      });
      expect(createRes.status).toBe(201);

      // Find shard 0 of the system wallet directly in the DB.
      // After sharding, there are N (default 32) shards per (platform, currency);
      // shard 0 is the original row preserved from the pre-sharding era and a
      // stable anchor for tests that just need "the system wallet" to probe.
      const prisma = getTestPrisma();
      const sysWallet = await prisma.wallet.findFirst({
        where: { ownerId: "SYSTEM", currencyCode: "USD", isSystem: true, shardIndex: 0 },
      });
      expect(sysWallet).not.toBeNull();
      systemWalletId = sysWallet!.id;
    });

    describe("When attempting to freeze the system wallet", () => {
      it("Then it should reject with 422 CANNOT_FREEZE_SYSTEM_WALLET", async () => {
        const res = await app.request(`/v1/wallets/${systemWalletId}/freeze`, {
          method: "POST",
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("CANNOT_FREEZE_SYSTEM_WALLET");
      });
    });

    describe("When attempting to close the system wallet", () => {
      it("Then it should reject with 422 CANNOT_CLOSE_SYSTEM_WALLET", async () => {
        const res = await app.request(`/v1/wallets/${systemWalletId}/close`, {
          method: "POST",
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("CANNOT_CLOSE_SYSTEM_WALLET");
      });
    });
  });

  describe("Given an active wallet", () => {
    let walletId: string;

    beforeEach(async () => {
      const createRes = await app.request("/v1/wallets", {
        method: "POST",
        headers: { "Idempotency-Key": "wl-freeze-setup-create" },
        body: JSON.stringify({ owner_id: "user-freeze", currency_code: "USD" }),
      });
      expect(createRes.status).toBe(201);
      const body = await createRes.json();
      walletId = body.wallet_id;
    });

    describe("When freezing the wallet twice", () => {
      it("Then the second freeze should reject with 422 WALLET_ALREADY_FROZEN", async () => {
        // First freeze succeeds
        const freeze1 = await app.request(`/v1/wallets/${walletId}/freeze`, {
          method: "POST",
        });
        expect(freeze1.status).toBe(200);

        // Second freeze fails
        const freeze2 = await app.request(`/v1/wallets/${walletId}/freeze`, {
          method: "POST",
        });

        expect(freeze2.status).toBe(422);
        const body = await freeze2.json();
        expect(body.error).toBe("WALLET_ALREADY_FROZEN");
      });
    });

    describe("When attempting to unfreeze a wallet that is not frozen", () => {
      it("Then it should reject with 422 WALLET_NOT_FROZEN", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/unfreeze`, {
          method: "POST",
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("WALLET_NOT_FROZEN");
      });
    });
  });

  describe("Given an existing wallet for a specific owner and currency", () => {
    describe("When creating a duplicate wallet with the same owner and currency", () => {
      it("Then it should reject with 409 WALLET_ALREADY_EXISTS", async () => {
        // Create the first wallet
        const res1 = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "wl-dup-create-1" },
          body: JSON.stringify({ owner_id: "user-dup", currency_code: "USD" }),
        });
        expect(res1.status).toBe(201);

        // Attempt duplicate
        const res2 = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "wl-dup-create-2" },
          body: JSON.stringify({ owner_id: "user-dup", currency_code: "USD" }),
        });

        expect(res2.status).toBe(409);
        const body = await res2.json();
        expect(body.error).toBe("WALLET_ALREADY_EXISTS");
      });
    });
  });

  describe("Given a fresh wallet", () => {
    describe("When performing the full lifecycle: create, deposit, withdraw, freeze, unfreeze, withdraw all, close", () => {
      it("Then each step should succeed and the wallet ends in closed state", async () => {
        // Step 1: Create wallet
        const createRes = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "wl-lifecycle-create" },
          body: JSON.stringify({ owner_id: "user-lifecycle", currency_code: "USD" }),
        });
        expect(createRes.status).toBe(201);
        const { wallet_id: walletId } = await createRes.json();

        // Verify initial state
        const getRes1 = await app.request(`/v1/wallets/${walletId}`);
        expect(getRes1.status).toBe(200);
        const wallet1 = await getRes1.json();
        expect(wallet1.status).toBe("active");
        expect(Number(wallet1.balance_minor)).toBe(0);

        // Step 2: Deposit $100
        const depositRes = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "wl-lifecycle-deposit" },
          body: JSON.stringify({ amount_minor: 10000 }),
        });
        expect(depositRes.status).toBe(201);
        const depositBody = await depositRes.json();
        expect(depositBody.transaction_id).toBeDefined();
        expect(depositBody.movement_id).toBeDefined();

        // Verify balance after deposit
        const getRes2 = await app.request(`/v1/wallets/${walletId}`);
        const wallet2 = await getRes2.json();
        expect(Number(wallet2.balance_minor)).toBe(10000);

        // Step 3: Withdraw $30
        const withdrawRes1 = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": "wl-lifecycle-withdraw-1" },
          body: JSON.stringify({ amount_minor: 3000 }),
        });
        expect(withdrawRes1.status).toBe(201);

        // Verify balance after partial withdrawal
        const getRes3 = await app.request(`/v1/wallets/${walletId}`);
        const wallet3 = await getRes3.json();
        expect(Number(wallet3.balance_minor)).toBe(7000);

        // Step 4: Freeze wallet
        const freezeRes = await app.request(`/v1/wallets/${walletId}/freeze`, {
          method: "POST",
        });
        expect(freezeRes.status).toBe(200);
        const freezeBody = await freezeRes.json();
        expect(freezeBody.status).toBe("frozen");

        // Verify frozen state
        const getRes4 = await app.request(`/v1/wallets/${walletId}`);
        const wallet4 = await getRes4.json();
        expect(wallet4.status).toBe("frozen");

        // Step 5: Unfreeze wallet
        const unfreezeRes = await app.request(`/v1/wallets/${walletId}/unfreeze`, {
          method: "POST",
        });
        expect(unfreezeRes.status).toBe(200);
        const unfreezeBody = await unfreezeRes.json();
        expect(unfreezeBody.status).toBe("active");

        // Verify active again
        const getRes5 = await app.request(`/v1/wallets/${walletId}`);
        const wallet5 = await getRes5.json();
        expect(wallet5.status).toBe("active");
        expect(Number(wallet5.balance_minor)).toBe(7000);

        // Step 6: Withdraw remaining balance ($70)
        const withdrawRes2 = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": "wl-lifecycle-withdraw-all" },
          body: JSON.stringify({ amount_minor: 7000 }),
        });
        expect(withdrawRes2.status).toBe(201);

        // Verify zero balance
        const getRes6 = await app.request(`/v1/wallets/${walletId}`);
        const wallet6 = await getRes6.json();
        expect(Number(wallet6.balance_minor)).toBe(0);

        // Step 7: Close wallet
        const closeRes = await app.request(`/v1/wallets/${walletId}/close`, {
          method: "POST",
        });
        expect(closeRes.status).toBe(200);
        const closeBody = await closeRes.json();
        expect(closeBody.status).toBe("closed");

        // Verify final closed state
        const getRes7 = await app.request(`/v1/wallets/${walletId}`);
        const wallet7 = await getRes7.json();
        expect(wallet7.status).toBe("closed");
      });
    });
  });
});
