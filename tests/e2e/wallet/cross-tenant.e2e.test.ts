import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Cross-Tenant Isolation E2E", () => {
  let app: TestApp;
  let victimWalletId: string;
  let attackerWalletId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();

    // Create a wallet owned by the victim (test platform)
    const victimRes = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": `tenant-victim-setup-${Date.now()}` },
      body: JSON.stringify({ owner_id: "victim-user", currency_code: "USD" }),
    });
    expect(victimRes.status).toBe(201);
    const victimBody = await victimRes.json();
    victimWalletId = victimBody.wallet_id;

    // Fund the victim wallet
    const depositRes = await app.request(`/v1/wallets/${victimWalletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": `tenant-victim-deposit-${Date.now()}` },
      body: JSON.stringify({ amount_cents: 500000 }),
    });
    expect(depositRes.status).toBe(201);

    // Create a wallet owned by the attacker platform
    const attackerRes = await app.attackerRequest("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": `tenant-attacker-setup-${Date.now()}` },
      body: JSON.stringify({ owner_id: "attacker-user", currency_code: "USD" }),
    });
    expect(attackerRes.status).toBe(201);
    const attackerBody = await attackerRes.json();
    attackerWalletId = attackerBody.wallet_id;
  });

  // ── Read isolation ─────────────────────────────────────────────────────

  describe("Given a wallet owned by the victim platform", () => {
    describe("When the attacker tries to read the victim wallet", () => {
      it("Then it should return 404 as if the wallet does not exist", async () => {
        const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}`);

        expect(res.status).toBe(404);
        const body = await res.json();
        // Must not leak any wallet data
        expect(body).not.toHaveProperty("balance");
        expect(body).not.toHaveProperty("owner_id");
      });
    });
  });

  // ── Deposit isolation ──────────────────────────────────────────────────

  describe("Given a wallet owned by the victim platform", () => {
    describe("When the attacker tries to deposit into the victim wallet", () => {
      it("Then it should return 404", async () => {
        const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "tenant-attack-deposit-1" },
          body: JSON.stringify({ amount_cents: 99999 }),
        });

        expect(res.status).toBe(404);
      });
    });
  });

  // ── Withdrawal isolation ───────────────────────────────────────────────

  describe("Given a wallet owned by the victim platform", () => {
    describe("When the attacker tries to withdraw from the victim wallet", () => {
      it("Then it should return 404", async () => {
        const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": "tenant-attack-withdraw-1" },
          body: JSON.stringify({ amount_cents: 1000 }),
        });

        expect(res.status).toBe(404);
      });
    });
  });

  // ── Transfer isolation ─────────────────────────────────────────────────

  describe("Given wallets on different platforms", () => {
    describe("When the attacker tries to transfer from victim wallet to attacker wallet", () => {
      it("Then it should return 404", async () => {
        const res = await app.attackerRequest("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": "tenant-attack-transfer-1" },
          body: JSON.stringify({
            source_wallet_id: victimWalletId,
            target_wallet_id: attackerWalletId,
            amount_cents: 1000,
          }),
        });

        expect(res.status).toBe(404);
      });
    });
  });

  // ── Hold isolation ─────────────────────────────────────────────────────

  describe("Given a wallet owned by the victim platform", () => {
    describe("When the attacker tries to place a hold on the victim wallet", () => {
      it("Then it should return 404", async () => {
        const res = await app.attackerRequest("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": "tenant-attack-hold-1" },
          body: JSON.stringify({
            wallet_id: victimWalletId,
            amount_cents: 1000,
          }),
        });

        expect(res.status).toBe(404);
      });
    });
  });

  // ── Freeze isolation ──────────────────────────────────────────────────

  describe("Given a wallet owned by the victim platform", () => {
    describe("When the attacker tries to freeze the victim wallet", () => {
      it("Then it should return 404", async () => {
        const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}/freeze`, {
          method: "POST",
        });

        expect(res.status).toBe(404);
      });
    });
  });

  // ── Close isolation ────────────────────────────────────────────────────

  describe("Given a wallet owned by the victim platform", () => {
    describe("When the attacker tries to close the victim wallet", () => {
      it("Then it should return 404", async () => {
        const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}/close`, {
          method: "POST",
        });

        expect(res.status).toBe(404);
      });
    });
  });
});
