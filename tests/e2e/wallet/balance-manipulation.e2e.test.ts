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
      body: JSON.stringify({ amount_cents: 10000 }),
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
          body: JSON.stringify({ amount_cents: 99999 }),
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
            amount_cents: 99999,
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
            amount_cents: 100,
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
          body: JSON.stringify({ amount_cents: 100 }),
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
          body: JSON.stringify({ amount_cents: 100 }),
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
            amount_cents: 100,
          }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("WALLET_NOT_ACTIVE");
      });
    });
  });
});
