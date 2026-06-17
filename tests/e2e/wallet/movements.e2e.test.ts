import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Wallet Movements (statement) E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = (p = "mv") => `${p}-${++idempCounter}-${Date.now()}`;

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

  async function charge(walletId: string, amountMinor: number, reference?: string): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/charge`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("charge") },
      body: JSON.stringify({ amount_minor: amountMinor, reference }),
    });
    expect(res.status).toBe(201);
  }

  async function adjust(
    walletId: string,
    amountMinor: number,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("adjust") },
      body: JSON.stringify({ amount_minor: amountMinor, reason, metadata }),
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

  // ── Running balance (the core of R2) ──────────────────────────────────────

  describe("Given a wallet with a deposit then a charge", () => {
    it("Then each movement carries the correct previous/new balance, direction and type", async () => {
      const walletId = await createWallet("mv-balance-user");
      await deposit(walletId, 10000);
      await charge(walletId, 3000, "COMMISSION");

      const res = await app.request(`/v1/wallets/${walletId}/movements`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.movements).toHaveLength(2);
      // Newest first (created_at desc): charge before deposit.
      expect(body.movements[0].type).toBe("charge");
      expect(body.movements[1].type).toBe("deposit");

      const chargeMv = body.movements.find((m: { type: string }) => m.type === "charge");
      expect(chargeMv.direction).toBe("debit");
      expect(chargeMv.amount_minor).toBe(3000);
      expect(chargeMv.reference).toBe("COMMISSION");
      expect(chargeMv.balance_before_minor).toBe(10000);
      expect(chargeMv.balance_after_minor).toBe(7000);

      const depositMv = body.movements.find((m: { type: string }) => m.type === "deposit");
      expect(depositMv.direction).toBe("credit");
      expect(depositMv.amount_minor).toBe(10000);
      expect(depositMv.balance_before_minor).toBe(0);
      expect(depositMv.balance_after_minor).toBe(10000);

      expect(body.next_cursor).toBeNull();
    });
  });

  // ── reason + metadata (correlation id) surfaced ───────────────────────────

  describe("Given an adjustment carrying a reason and a correlation id in metadata", () => {
    it("Then the movement surfaces reason and metadata verbatim", async () => {
      const walletId = await createWallet("mv-meta-user");
      await deposit(walletId, 5000);
      await adjust(walletId, 2000, "Promotional credit", { order_id: "order-789" });

      const res = await app.request(`/v1/wallets/${walletId}/movements`);
      const body = await res.json();

      const adj = body.movements.find((m: { type: string }) => m.type === "adjustment_credit");
      expect(adj.direction).toBe("credit");
      expect(adj.amount_minor).toBe(2000);
      expect(adj.reason).toBe("Promotional credit");
      expect(adj.metadata).toEqual({ order_id: "order-789" });
      expect(adj.balance_before_minor).toBe(5000);
      expect(adj.balance_after_minor).toBe(7000);
    });
  });

  // ── Cursor pagination (consistent, no offset) ─────────────────────────────

  describe("Given a wallet with 3 movements", () => {
    it("Then cursor pagination returns all of them with no gaps or duplicates", async () => {
      const walletId = await createWallet("mv-page-user");
      await deposit(walletId, 1000);
      await deposit(walletId, 2000);
      await deposit(walletId, 3000);

      const first = await app.request(`/v1/wallets/${walletId}/movements?limit=2`);
      const firstBody = await first.json();
      expect(firstBody.movements).toHaveLength(2);
      expect(firstBody.next_cursor).toBeTruthy();

      const second = await app.request(
        `/v1/wallets/${walletId}/movements?limit=2&cursor=${encodeURIComponent(firstBody.next_cursor)}`,
      );
      const secondBody = await second.json();
      expect(secondBody.movements).toHaveLength(1);
      expect(secondBody.next_cursor).toBeNull();

      const ids = [...firstBody.movements, ...secondBody.movements].map(
        (m: { movement_id: string }) => m.movement_id,
      );
      expect(new Set(ids).size).toBe(3);
    });
  });

  // ── Type filter (R1 parity reused) ────────────────────────────────────────

  describe("Given a wallet with mixed movement types", () => {
    it("Then filtering by type=charge returns only charges", async () => {
      const walletId = await createWallet("mv-filter-user");
      await deposit(walletId, 10000);
      await charge(walletId, 1000);

      const res = await app.request(
        `/v1/wallets/${walletId}/movements?filter%5Btype%5D=charge`,
      );
      const body = await res.json();

      expect(body.movements.length).toBeGreaterThan(0);
      expect(body.movements.every((m: { type: string }) => m.type === "charge")).toBe(true);
    });
  });

  // ── Empty wallet ──────────────────────────────────────────────────────────

  describe("Given a wallet with no movements", () => {
    it("Then it returns an empty statement with no cursor", async () => {
      const walletId = await createWallet("mv-empty-user");

      const res = await app.request(`/v1/wallets/${walletId}/movements`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.movements).toEqual([]);
      expect(body.next_cursor).toBeNull();
    });
  });

  // ── Cross-tenant isolation ────────────────────────────────────────────────

  describe("Given a wallet owned by the victim platform", () => {
    it("Then the attacker platform cannot read its movements (404)", async () => {
      const victimWalletId = await createWallet("mv-victim-user");
      await deposit(victimWalletId, 5000);

      const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}/movements`);
      expect(res.status).toBe(404);
    });
  });

  // ── Authentication ────────────────────────────────────────────────────────

  describe("Given an unauthenticated client", () => {
    it("Then reading movements returns 401", async () => {
      const walletId = await createWallet("mv-auth-user");

      const res = await app.unauthenticatedRequest(`/v1/wallets/${walletId}/movements`);
      expect(res.status).toBe(401);
    });
  });

  // ── Non-existent wallet ───────────────────────────────────────────────────

  describe("Given a non-existent wallet id", () => {
    it("Then reading movements returns 404", async () => {
      const fakeId = "019560a0-0000-7000-8000-0000000000aa";
      const res = await app.request(`/v1/wallets/${fakeId}/movements`);
      expect(res.status).toBe(404);
    });
  });

  // ── Invalid cursor ────────────────────────────────────────────────────────

  describe("Given a garbage cursor", () => {
    it("Then it returns 400", async () => {
      const walletId = await createWallet("mv-badcursor-user");

      const res = await app.request(`/v1/wallets/${walletId}/movements?cursor=not-a-valid-cursor`);
      expect(res.status).toBe(400);
    });
  });

  // ── Get movement by id (R3) ───────────────────────────────────────────────

  describe("Given a wallet with an adjustment movement", () => {
    it("Then GET /movements/:movementId returns that single movement with balance, reason and metadata", async () => {
      const walletId = await createWallet("mv-byid-user");
      await deposit(walletId, 8000);
      await adjust(walletId, 2000, "bonus", { order_id: "ord-1" });

      const list = await app.request(`/v1/wallets/${walletId}/movements`);
      const target = (await list.json()).movements.find(
        (m: { type: string }) => m.type === "adjustment_credit",
      );
      expect(target).toBeDefined();

      const res = await app.request(`/v1/wallets/${walletId}/movements/${target.movement_id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.movement_id).toBe(target.movement_id);
      expect(body.type).toBe("adjustment_credit");
      expect(body.direction).toBe("credit");
      expect(body.amount_minor).toBe(2000);
      expect(body.reason).toBe("bonus");
      expect(body.metadata).toEqual({ order_id: "ord-1" });
      expect(body.balance_before_minor).toBe(8000);
      expect(body.balance_after_minor).toBe(10000);
    });
  });

  describe("Given a non-existent movement id", () => {
    it("Then GET /movements/:movementId returns 404", async () => {
      const walletId = await createWallet("mv-byid-404-user");
      await deposit(walletId, 1000);

      const fakeMovement = "019560a0-0000-7000-8000-0000000000bb";
      const res = await app.request(`/v1/wallets/${walletId}/movements/${fakeMovement}`);
      expect(res.status).toBe(404);
    });
  });

  describe("Given a movement in the victim platform's wallet", () => {
    it("Then the attacker platform cannot read it by id (404)", async () => {
      const victimWalletId = await createWallet("mv-byid-victim");
      await deposit(victimWalletId, 5000);
      const list = await app.request(`/v1/wallets/${victimWalletId}/movements`);
      const mvId = (await list.json()).movements[0].movement_id;

      const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}/movements/${mvId}`);
      expect(res.status).toBe(404);
    });
  });
});
