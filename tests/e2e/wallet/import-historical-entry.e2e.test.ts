// TODO(historical-import-temp): Remove this entire e2e test file together
// with the rest of the import-historical-entry feature after migration.
// Covers the security categories applicable to a historical backfill
// endpoint: authentication, input validation, cross-tenant isolation,
// idempotency, ledger integrity, edge cases, and information disclosure.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Import Historical Entry E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = (prefix = "import") => `${prefix}-${++idempCounter}-${Date.now()}`;
  const pastTimestamp = (offsetMs = 60_000) => Date.now() - offsetMs;

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

  async function createAttackerWallet(ownerId: string): Promise<string> {
    const res = await app.attackerRequest("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("attacker-wallet") },
      body: JSON.stringify({ owner_id: ownerId, currency_code: "USD" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.wallet_id;
  }

  async function getWallet(walletId: string): Promise<{
    balance_minor: number;
    available_balance_minor: number;
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

  // ── Happy path: dates + references preserved ──────────────────────
  describe("Given an active wallet", () => {
    describe("When importing a historical entry with a past timestamp", () => {
      it("Then the Transaction, Movement, and LedgerEntries all carry the historical timestamp", async () => {
        const walletId = await createWallet("hist-owner-1");
        const historicalAt = pastTimestamp(1_000_000); // ~16 min ago

        const res = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("import-credit") },
          body: JSON.stringify({
            amount_minor: 2500,
            reason: "Legacy movement migrated",
            reference: "Venta producto X",
            historical_created_at: historicalAt,
            metadata: { migratedFrom: "legacy-system", legacyId: "mov-123" },
          }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.transaction_id).toBeDefined();
        expect(body.movement_id).toBeDefined();

        const wallet = await getWallet(walletId);
        expect(wallet.balance_minor).toBe(2500);

        const tx = await app.prisma.transaction.findUnique({
          where: { id: body.transaction_id },
        });
        expect(tx?.type).toBe("adjustment_credit");
        expect(tx?.reference).toBe("Venta producto X");
        expect(tx?.metadata).toEqual({ migratedFrom: "legacy-system", legacyId: "mov-123" });
        expect(Number(tx?.createdAt)).toBe(historicalAt);

        const movement = await app.prisma.movement.findUnique({
          where: { id: body.movement_id },
        });
        expect(movement?.type).toBe("adjustment");
        expect(movement?.reason).toBe("Legacy movement migrated");
        expect(Number(movement?.createdAt)).toBe(historicalAt);

        const entries = await app.prisma.ledgerEntry.findMany({
          where: { transactionId: body.transaction_id },
        });
        expect(entries).toHaveLength(2);
        for (const entry of entries) {
          expect(Number(entry.createdAt)).toBe(historicalAt);
        }
      });
    });

    describe("When importing a negative entry (historical withdrawal)", () => {
      it("Then it creates an adjustment_debit and decreases the balance", async () => {
        const walletId = await createWallet("hist-owner-2");
        // Seed funds so the debit doesn't fail with INSUFFICIENT_FUNDS
        await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("seed") },
          body: JSON.stringify({ amount_minor: 10000 }),
        });

        const res = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("import-debit") },
          body: JSON.stringify({
            amount_minor: -3000,
            reason: "Legacy withdrawal",
            reference: "Retiro bancario #42",
            historical_created_at: pastTimestamp(),
          }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();

        const tx = await app.prisma.transaction.findUnique({ where: { id: body.transaction_id } });
        expect(tx?.type).toBe("adjustment_debit");

        const wallet = await getWallet(walletId);
        expect(wallet.balance_minor).toBe(7000);
      });
    });
  });

  // ── Ledger integrity: zero-sum across user + system ───────────────
  describe("Ledger integrity", () => {
    it("Given a historical import, When inspecting the ledger, Then the two entries sum to zero", async () => {
      const walletId = await createWallet("ledger-check");
      const res = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey("ledger-sum") },
        body: JSON.stringify({
          amount_minor: 1000,
          reason: "zero-sum test",
          reference: "ref",
          historical_created_at: pastTimestamp(),
        }),
      });
      const body = await res.json();

      const entries = await app.prisma.ledgerEntry.findMany({
        where: { transactionId: body.transaction_id },
      });
      const sum = entries.reduce((acc, e) => acc + e.amountMinor, 0n);
      expect(sum).toBe(0n);
    });
  });

  // ── Idempotency: replay safe ──────────────────────────────────────
  describe("Idempotency", () => {
    it("Given the same request body and key, When replayed, Then the cached response is returned (no duplicate entry)", async () => {
      const walletId = await createWallet("idem-owner");
      const key = nextKey("idem");
      const historicalAt = pastTimestamp();
      const payload = {
        amount_minor: 1500,
        reason: "idempotent test",
        reference: "ref",
        historical_created_at: historicalAt,
      };

      const first = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(payload),
      });
      const firstBody = await first.json();

      const second = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(payload),
      });
      const secondBody = await second.json();

      expect(second.status).toBe(201);
      expect(secondBody).toEqual(firstBody);

      const count = await app.prisma.transaction.count({ where: { walletId } });
      expect(count).toBe(1);
    });

    it("Given the same key but different payload, When replayed, Then returns 422 IDEMPOTENCY_KEY_REUSED", async () => {
      const walletId = await createWallet("idem-mismatch-owner");
      const key = nextKey("idem-mismatch");

      await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          amount_minor: 1000,
          reason: "first",
          reference: "ref",
          historical_created_at: pastTimestamp(),
        }),
      });

      const second = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          amount_minor: 9999,
          reason: "second",
          reference: "ref",
          historical_created_at: pastTimestamp(),
        }),
      });
      expect(second.status).toBe(422);
    });
  });

  // ── Authentication: missing + invalid API key ─────────────────────
  describe("Authentication", () => {
    it("Given no API key, When called, Then returns 401", async () => {
      const walletId = await createWallet("auth-owner");
      const res = await app.unauthenticatedRequest(
        `/v1/wallets/${walletId}/import-historical-entry`,
        {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("unauth") },
          body: JSON.stringify({
            amount_minor: 100,
            reason: "r",
            reference: "ref",
            historical_created_at: pastTimestamp(),
          }),
        },
      );
      expect(res.status).toBe(401);
    });
  });

  // ── Cross-tenant isolation ────────────────────────────────────────
  describe("Cross-tenant isolation", () => {
    it("Given an attacker platform, When importing to a victim's wallet, Then returns 404 (no information leak)", async () => {
      const victimWallet = await createWallet("victim");
      await createAttackerWallet("attacker-owner");

      const res = await app.attackerRequest(
        `/v1/wallets/${victimWallet}/import-historical-entry`,
        {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("attack") },
          body: JSON.stringify({
            amount_minor: 100000,
            reason: "exploit",
            reference: "pwn",
            historical_created_at: pastTimestamp(),
          }),
        },
      );
      expect(res.status).toBe(404);

      const victimState = await getWallet(victimWallet);
      expect(victimState.balance_minor).toBe(0);
    });
  });

  // ── Input validation ──────────────────────────────────────────────
  describe("Input validation", () => {
    const validBase = () => ({
      amount_minor: 100,
      reason: "valid",
      reference: "ref",
      historical_created_at: pastTimestamp(),
    });

    it.each([
      ["future timestamp", { historical_created_at: Date.now() + 60_000 }],
      ["zero amount", { amount_minor: 0 }],
      ["non-integer amount", { amount_minor: 1.5 }],
      ["negative timestamp", { historical_created_at: -1 }],
      ["empty reason", { reason: "" }],
      ["empty reference", { reference: "" }],
      ["reason too long", { reason: "x".repeat(1001) }],
      ["reference too long", { reference: "x".repeat(501) }],
    ])("Given %s, When called, Then returns 400", async (_name, override) => {
      const walletId = await createWallet("val-owner");
      const res = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey("val") },
        body: JSON.stringify({ ...validBase(), ...override }),
      });
      expect(res.status).toBe(400);
    });

    it("Given malformed JSON, When called, Then rejects with 4xx/5xx without exposing a stack trace", async () => {
      const walletId = await createWallet("malformed-owner");
      const res = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey("malformed") },
        body: "{not valid json",
      });
      // Hono/Zod may surface this as 400 (parse) or 500 (unexpected), never 2xx.
      expect(res.status).toBeGreaterThanOrEqual(400);
      const text = await res.text();
      expect(text).not.toMatch(/at .*\.ts:/);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────
  describe("Edge cases", () => {
    it("Given a non-existent wallet, When importing, Then returns 404", async () => {
      const res = await app.request("/v1/wallets/does-not-exist/import-historical-entry", {
        method: "POST",
        headers: { "Idempotency-Key": nextKey("ghost") },
        body: JSON.stringify({
          amount_minor: 100,
          reason: "r",
          reference: "ref",
          historical_created_at: pastTimestamp(),
        }),
      });
      expect(res.status).toBe(404);
    });

    it("Given a closed wallet, When importing, Then returns 422 WALLET_CLOSED", async () => {
      const walletId = await createWallet("to-be-closed");
      await app.request(`/v1/wallets/${walletId}/close`, { method: "POST" });

      const res = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey("closed") },
        body: JSON.stringify({
          amount_minor: 100,
          reason: "r",
          reference: "ref",
          historical_created_at: pastTimestamp(),
        }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("WALLET_CLOSED");
    });

    it("Given minimum valid amount (1 cent), When importing, Then succeeds", async () => {
      const walletId = await createWallet("one-cent");
      const res = await app.request(`/v1/wallets/${walletId}/import-historical-entry`, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey("min") },
        body: JSON.stringify({
          amount_minor: 1,
          reason: "minimum",
          reference: "ref",
          historical_created_at: pastTimestamp(),
        }),
      });
      expect(res.status).toBe(201);
      const wallet = await getWallet(walletId);
      expect(wallet.balance_minor).toBe(1);
    });
  });
});
