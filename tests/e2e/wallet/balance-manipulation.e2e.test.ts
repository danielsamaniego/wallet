import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Balance Manipulation E2E", () => {
  let app: TestApp;
  let walletId: string;
  let secondWalletId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();

    // Create a wallet and deposit 10000 cents ($100)
    const createRes = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": "bm-setup-create-wallet" },
      body: JSON.stringify({ owner_id: "user-balance", currency_code: "USD" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    walletId = createBody.wallet_id;

    const depositRes = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": "bm-setup-deposit" },
      body: JSON.stringify({ amount_minor: 10000 }),
    });
    expect(depositRes.status).toBe(201);

    // Create a second wallet for transfer tests
    const create2Res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": "bm-setup-create-wallet-2" },
      body: JSON.stringify({ owner_id: "user-balance-target", currency_code: "USD" }),
    });
    expect(create2Res.status).toBe(201);
    const create2Body = await create2Res.json();
    secondWalletId = create2Body.wallet_id;
  });

  describe("Given a wallet with 10000 cents balance", () => {
    describe("When attempting to withdraw more than the balance", () => {
      it("Then it should reject with 422 INSUFFICIENT_FUNDS", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-overdraft-withdraw-1" },
          body: JSON.stringify({ amount_minor: 99999 }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("INSUFFICIENT_FUNDS");
      });
    });

    describe("When attempting to charge more than the balance", () => {
      it("Then it should reject with 422 INSUFFICIENT_FUNDS", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-overdraft-charge-1" },
          body: JSON.stringify({ amount_minor: 99999 }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("INSUFFICIENT_FUNDS");
      });
    });

    describe("When attempting to transfer more than the balance to another wallet", () => {
      it("Then it should reject with 422 INSUFFICIENT_FUNDS", async () => {
        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": "bm-overdraft-transfer-1" },
          body: JSON.stringify({
            source_wallet_id: walletId,
            target_wallet_id: secondWalletId,
            amount_minor: 99999,
          }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("INSUFFICIENT_FUNDS");
      });
    });

    describe("When attempting a self-transfer (source equals target)", () => {
      it("Then it should reject with 400 SAME_WALLET", async () => {
        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": "bm-self-transfer-1" },
          body: JSON.stringify({
            source_wallet_id: walletId,
            target_wallet_id: walletId,
            amount_minor: 100,
          }),
        });

        // SAME_WALLET is a validation error -> 400
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("SAME_WALLET");
      });
    });
  });

  describe("Given a frozen wallet with funds", () => {
    beforeEach(async () => {
      // Freeze the wallet that already has 10000 cents
      const freezeRes = await app.request(`/v1/wallets/${walletId}/freeze`, {
        method: "POST",
      });
      expect(freezeRes.status).toBe(200);
    });

    describe("When attempting to withdraw from the frozen wallet", () => {
      it("Then it should reject with 422 WALLET_NOT_ACTIVE", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-frozen-withdraw-1" },
          body: JSON.stringify({ amount_minor: 100 }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("WALLET_NOT_ACTIVE");
      });
    });

    describe("When attempting to charge the frozen wallet", () => {
      it("Then it should reject with 422 WALLET_NOT_ACTIVE", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/charge`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-frozen-charge-1" },
          body: JSON.stringify({ amount_minor: 100 }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("WALLET_NOT_ACTIVE");
      });
    });

    describe("When attempting to deposit to the frozen wallet", () => {
      it("Then it should reject with 422 WALLET_NOT_ACTIVE", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-frozen-deposit-1" },
          body: JSON.stringify({ amount_minor: 100 }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("WALLET_NOT_ACTIVE");
      });
    });

    describe("When attempting to transfer from the frozen wallet", () => {
      it("Then it should reject with 422 WALLET_NOT_ACTIVE", async () => {
        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": "bm-frozen-transfer-1" },
          body: JSON.stringify({
            source_wallet_id: walletId,
            target_wallet_id: secondWalletId,
            amount_minor: 100,
          }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("WALLET_NOT_ACTIVE");
      });
    });
  });

  // ── Transfer TO a frozen wallet ─────────────────────────────────────────

  describe("Given a funded source wallet and a frozen target wallet", () => {
    describe("When attempting to transfer to the frozen wallet", () => {
      it("Then it should reject with 422 WALLET_NOT_ACTIVE", async () => {
        // Reset to unfrozen state — create fresh wallets
        const freshSource = walletId; // already has 10000

        // Create and freeze a new target
        const freezeTargetRes = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "bm-frozen-target-create" },
          body: JSON.stringify({ owner_id: "frozen-target", currency_code: "USD" }),
        });
        const { wallet_id: frozenTarget } = await freezeTargetRes.json();
        await app.request(`/v1/wallets/${frozenTarget}/freeze`, { method: "POST" });

        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": "bm-xfr-to-frozen-1" },
          body: JSON.stringify({
            source_wallet_id: freshSource,
            target_wallet_id: frozenTarget,
            amount_minor: 100,
          }),
        });

        expect(res.status).toBe(422);
      });
    });
  });

  // ── Sequential withdrawals until exact zero ─────────────────────────────

  describe("Given a wallet with 10000 cents", () => {
    describe("When withdrawing 3333, 3333, 3334 cents sequentially (totaling exactly 10000)", () => {
      it("Then all three withdrawals should succeed and final balance should be 0", async () => {
        const res1 = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-seq-wd-1" },
          body: JSON.stringify({ amount_minor: 3333 }),
        });
        expect(res1.status).toBe(201);

        const res2 = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-seq-wd-2" },
          body: JSON.stringify({ amount_minor: 3333 }),
        });
        expect(res2.status).toBe(201);

        const res3 = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-seq-wd-3" },
          body: JSON.stringify({ amount_minor: 3334 }),
        });
        expect(res3.status).toBe(201);

        const walletRes = await app.request(`/v1/wallets/${walletId}`);
        expect(Number((await walletRes.json()).balance_minor)).toBe(0);
      });
    });
  });

  // ── Deposit → transfer → withdraw chain ─────────────────────────────────

  describe("Given wallet A deposits 50000 and transfers 20000 to wallet B", () => {
    describe("When wallet B withdraws 15000", () => {
      it("Then wallet A should have 30000 and wallet B should have 5000", async () => {
        // walletId already has 10000 from beforeEach deposit
        await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-chain-dep-extra" },
          body: JSON.stringify({ amount_minor: 40000 }),
        });
        // walletId now has 50000

        await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": "bm-chain-xfr" },
          body: JSON.stringify({
            source_wallet_id: walletId,
            target_wallet_id: secondWalletId,
            amount_minor: 20000,
          }),
        });

        const wdRes = await app.request(`/v1/wallets/${secondWalletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": "bm-chain-wd" },
          body: JSON.stringify({ amount_minor: 15000 }),
        });
        expect(wdRes.status).toBe(201);

        const aRes = await app.request(`/v1/wallets/${walletId}`);
        expect(Number((await aRes.json()).balance_minor)).toBe(30000);

        const bRes = await app.request(`/v1/wallets/${secondWalletId}`);
        expect(Number((await bRes.json()).balance_minor)).toBe(5000);
      });
    });
  });
});
