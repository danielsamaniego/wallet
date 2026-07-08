import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Wallet Statement E2E", () => {
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

  async function transfer(
    sourceWalletId: string,
    targetWalletId: string,
    amountMinor: number,
  ): Promise<void> {
    const res = await app.request("/v1/transfers", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("transfer") },
      body: JSON.stringify({
        source_wallet_id: sourceWalletId,
        target_wallet_id: targetWalletId,
        amount_minor: amountMinor,
      }),
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

      const res = await app.request(`/v1/wallets/${walletId}/statement`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.entries).toHaveLength(2);
      // Newest first (created_at desc): charge before deposit.
      expect(body.entries[0].type).toBe("charge");
      expect(body.entries[1].type).toBe("deposit");

      const chargeMv = body.entries.find((m: { type: string }) => m.type === "charge");
      expect(chargeMv.direction).toBe("debit");
      expect(chargeMv.amount_minor).toBe(3000);
      expect(chargeMv.reference).toBe("COMMISSION");
      expect(chargeMv.balance_before_minor).toBe(10000);
      expect(chargeMv.balance_after_minor).toBe(7000);

      const depositMv = body.entries.find((m: { type: string }) => m.type === "deposit");
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

      const res = await app.request(`/v1/wallets/${walletId}/statement`);
      const body = await res.json();

      const adj = body.entries.find((m: { type: string }) => m.type === "adjustment_credit");
      expect(adj.direction).toBe("credit");
      expect(adj.amount_minor).toBe(2000);
      expect(adj.reason).toBe("Promotional credit");
      expect(adj.metadata).toEqual({ order_id: "order-789" });
      expect(adj.balance_before_minor).toBe(5000);
      expect(adj.balance_after_minor).toBe(7000);
    });
  });

  // ── Cursor pagination (consistent, no offset) ─────────────────────────────

  describe("Given a wallet with 3 entries", () => {
    it("Then cursor pagination returns all of them with no gaps or duplicates", async () => {
      const walletId = await createWallet("mv-page-user");
      await deposit(walletId, 1000);
      await deposit(walletId, 2000);
      await deposit(walletId, 3000);

      const first = await app.request(`/v1/wallets/${walletId}/statement?limit=2`);
      const firstBody = await first.json();
      expect(firstBody.entries).toHaveLength(2);
      expect(firstBody.next_cursor).toBeTruthy();

      const second = await app.request(
        `/v1/wallets/${walletId}/statement?limit=2&cursor=${encodeURIComponent(firstBody.next_cursor)}`,
      );
      const secondBody = await second.json();
      expect(secondBody.entries).toHaveLength(1);
      expect(secondBody.next_cursor).toBeNull();

      const ids = [...firstBody.entries, ...secondBody.entries].map(
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
        `/v1/wallets/${walletId}/statement?filter%5Btype%5D=charge`,
      );
      const body = await res.json();

      expect(body.entries.length).toBeGreaterThan(0);
      expect(body.entries.every((m: { type: string }) => m.type === "charge")).toBe(true);
    });
  });

  // ── Direction filter (credit/debit) ───────────────────────────────────────

  describe("Given a wallet with both credit and debit movements", () => {
    it("Then direction=credit returns only credit lines and direction=debit only debits", async () => {
      const walletId = await createWallet("mv-dir-user");
      await deposit(walletId, 10000); // credit
      await charge(walletId, 3000); // debit

      const credits = await (
        await app.request(`/v1/wallets/${walletId}/statement?direction=credit`)
      ).json();
      expect(credits.entries.every((m: { direction: string }) => m.direction === "credit")).toBe(
        true,
      );
      expect(credits.entries).toHaveLength(1);
      expect(credits.entries[0].type).toBe("deposit");

      const debits = await (
        await app.request(`/v1/wallets/${walletId}/statement?direction=debit`)
      ).json();
      expect(debits.entries.every((m: { direction: string }) => m.direction === "debit")).toBe(
        true,
      );
      expect(debits.entries).toHaveLength(1);
      expect(debits.entries[0].type).toBe("charge");
    });

    it("Then an invalid direction returns 400", async () => {
      const walletId = await createWallet("mv-dir-bad-user");
      const res = await app.request(`/v1/wallets/${walletId}/statement?direction=sideways`);
      expect(res.status).toBe(400);
    });
  });

  // ── Total count (opt-in) ──────────────────────────────────────────────────

  describe("Given a wallet with more entries than the page limit", () => {
    it("Then include_total=true returns the full match count across pages; absent by default", async () => {
      const walletId = await createWallet("mv-total-user");
      await deposit(walletId, 1000);
      await deposit(walletId, 2000);
      await deposit(walletId, 3000);

      const withTotal = await (
        await app.request(`/v1/wallets/${walletId}/statement?limit=2&include_total=true`)
      ).json();
      expect(withTotal.entries).toHaveLength(2);
      expect(withTotal.next_cursor).toBeTruthy();
      expect(withTotal.total).toBe(3); // counts all pages, not just this one

      const withoutTotal = await (
        await app.request(`/v1/wallets/${walletId}/statement?limit=2`)
      ).json();
      expect(withoutTotal.total).toBeUndefined();
    });

    it("Then include_total respects active filters (e.g. direction)", async () => {
      const walletId = await createWallet("mv-total-filter-user");
      await deposit(walletId, 1000);
      await deposit(walletId, 2000);
      await charge(walletId, 500);

      const res = await app.request(
        `/v1/wallets/${walletId}/statement?direction=credit&include_total=true`,
      );
      const body = await res.json();
      expect(body.total).toBe(2); // two deposits; the charge is excluded
    });
  });

  // ── Empty wallet ──────────────────────────────────────────────────────────

  describe("Given a wallet with no entries", () => {
    it("Then it returns an empty statement with no cursor", async () => {
      const walletId = await createWallet("mv-empty-user");

      const res = await app.request(`/v1/wallets/${walletId}/statement`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries).toEqual([]);
      expect(body.next_cursor).toBeNull();
    });
  });

  // ── Cross-tenant isolation ────────────────────────────────────────────────

  describe("Given a wallet owned by the victim platform", () => {
    it("Then the attacker platform cannot read its entries (404)", async () => {
      const victimWalletId = await createWallet("mv-victim-user");
      await deposit(victimWalletId, 5000);

      const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}/statement`);
      expect(res.status).toBe(404);
    });
  });

  // ── Authentication ────────────────────────────────────────────────────────

  describe("Given an unauthenticated client", () => {
    it("Then reading entries returns 401", async () => {
      const walletId = await createWallet("mv-auth-user");

      const res = await app.unauthenticatedRequest(`/v1/wallets/${walletId}/statement`);
      expect(res.status).toBe(401);
    });
  });

  // ── Non-existent wallet ───────────────────────────────────────────────────

  describe("Given a non-existent wallet id", () => {
    it("Then reading entries returns 404", async () => {
      const fakeId = "019560a0-0000-7000-8000-0000000000aa";
      const res = await app.request(`/v1/wallets/${fakeId}/statement`);
      expect(res.status).toBe(404);
    });
  });

  // ── Invalid cursor ────────────────────────────────────────────────────────

  describe("Given a garbage cursor", () => {
    it("Then it returns 400", async () => {
      const walletId = await createWallet("mv-badcursor-user");

      const res = await app.request(`/v1/wallets/${walletId}/statement?cursor=not-a-valid-cursor`);
      expect(res.status).toBe(400);
    });
  });

  // ── Get movement by id (R3) ───────────────────────────────────────────────

  describe("Given a wallet with an adjustment movement", () => {
    it("Then GET /statement/:movementId returns that single movement with balance, reason and metadata", async () => {
      const walletId = await createWallet("mv-byid-user");
      await deposit(walletId, 8000);
      await adjust(walletId, 2000, "bonus", { order_id: "ord-1" });

      const list = await app.request(`/v1/wallets/${walletId}/statement`);
      const target = (await list.json()).entries.find(
        (m: { type: string }) => m.type === "adjustment_credit",
      );
      expect(target).toBeDefined();

      const res = await app.request(`/v1/wallets/${walletId}/statement/${target.movement_id}`);
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
    it("Then GET /statement/:movementId returns 404", async () => {
      const walletId = await createWallet("mv-byid-404-user");
      await deposit(walletId, 1000);

      const fakeMovement = "019560a0-0000-7000-8000-0000000000bb";
      const res = await app.request(`/v1/wallets/${walletId}/statement/${fakeMovement}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Platform-wide statement by movement id (no walletId) ──────────────────

  describe("Given a normal movement, when looked up platform-wide by id", () => {
    it("Then GET /v1/statement/:movementId returns the single user face with wallet_id + owner_id", async () => {
      const walletId = await createWallet("mv-global-deposit");
      await deposit(walletId, 8000);
      const list = await (await app.request(`/v1/wallets/${walletId}/statement`)).json();
      const movementId = list.entries[0].movement_id;

      const res = await app.request(`/v1/statement/${movementId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].movement_id).toBe(movementId);
      expect(body.entries[0].wallet_id).toBe(walletId);
      expect(body.entries[0].owner_id).toBe("mv-global-deposit");
      expect(body.entries[0].direction).toBe("credit");
    });
  });

  describe("Given a transfer, when looked up platform-wide by id", () => {
    it("Then it returns BOTH user faces (sender debit + receiver credit)", async () => {
      const sender = await createWallet("mv-global-sender");
      const receiver = await createWallet("mv-global-receiver");
      await deposit(sender, 10000);
      await transfer(sender, receiver, 4000);

      const list = await (
        await app.request(`/v1/wallets/${sender}/statement?filter%5Btype%5D=transfer_out`)
      ).json();
      const movementId = list.entries[0].movement_id;

      const res = await app.request(`/v1/statement/${movementId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries).toHaveLength(2);
      expect(body.entries.map((e: { owner_id: string }) => e.owner_id).sort()).toEqual([
        "mv-global-receiver",
        "mv-global-sender",
      ]);
      expect(body.entries.map((e: { direction: string }) => e.direction).sort()).toEqual([
        "credit",
        "debit",
      ]);
    });
  });

  describe("Given a non-existent / foreign movement id (platform-wide)", () => {
    it("Then GET /v1/statement/:movementId returns 404", async () => {
      const res = await app.request("/v1/statement/019560a0-0000-7000-8000-0000000000ff");
      expect(res.status).toBe(404);
    });

    it("Then an unauthenticated client returns 401", async () => {
      const res = await app.unauthenticatedRequest(
        "/v1/statement/019560a0-0000-7000-8000-0000000000ff",
      );
      expect(res.status).toBe(401);
    });

    it("Then the attacker platform cannot read the victim's movement (404)", async () => {
      const walletId = await createWallet("mv-global-victim");
      await deposit(walletId, 5000);
      const list = await (await app.request(`/v1/wallets/${walletId}/statement`)).json();
      const movementId = list.entries[0].movement_id;

      const res = await app.attackerRequest(`/v1/statement/${movementId}`);
      expect(res.status).toBe(404);
    });
  });

  describe("Given a movement in the victim platform's wallet", () => {
    it("Then the attacker platform cannot read it by id (404)", async () => {
      const victimWalletId = await createWallet("mv-byid-victim");
      await deposit(victimWalletId, 5000);
      const list = await app.request(`/v1/wallets/${victimWalletId}/statement`);
      const mvId = (await list.json()).entries[0].movement_id;

      const res = await app.attackerRequest(`/v1/wallets/${victimWalletId}/statement/${mvId}`);
      expect(res.status).toBe(404);
    });
  });

  // ── R5: per-wallet free-text search ───────────────────────────────────────

  describe("Given a wallet with charges carrying references", () => {
    it("Then ?q= matches a reference case-insensitively, scoped to the wallet", async () => {
      const walletId = await createWallet("mv-q-user");
      await deposit(walletId, 10000);
      await charge(walletId, 1000, "ALPHACOMMISSION");
      await charge(walletId, 1000, "BETAFEE");

      const res = await app.request(`/v1/wallets/${walletId}/statement?q=alpha`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].reference).toBe("ALPHACOMMISSION");
    });

    it("Then ?q= also matches the platform-provided statementSearchText metadata", async () => {
      const walletId = await createWallet("mv-q-meta-user");
      await deposit(walletId, 10000);
      await adjust(walletId, 1000, "internal settlement", {
        statementSearchText: "transferencia enviada a tomas fuentes sanchez tomas",
      });

      const res = await app.request(`/v1/wallets/${walletId}/statement?q=fuentes`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].metadata.statementSearchText).toBe(
        "transferencia enviada a tomas fuentes sanchez tomas",
      );
    });

    it("Then ?q= can match statementSearchTextByWallet only for the listed wallet face", async () => {
      const walletId = await createWallet("mv-q-face-user");
      await deposit(walletId, 10000);
      await adjust(walletId, 1000, "internal settlement", {
        statementSearchTextByWallet: {
          [walletId]: "transferencia enviada a piedra",
          "other-wallet": "transferencia enviada a tomas",
        },
      });

      const ownFace = await app.request(`/v1/wallets/${walletId}/statement?q=piedra`);
      expect(ownFace.status).toBe(200);
      expect((await ownFace.json()).entries).toHaveLength(1);

      const otherFace = await app.request(`/v1/wallets/${walletId}/statement?q=tomas`);
      expect(otherFace.status).toBe(200);
      expect((await otherFace.json()).entries).toEqual([]);
    });

    it("Then a non-matching q returns no entries", async () => {
      const walletId = await createWallet("mv-q-empty-user");
      await deposit(walletId, 5000);
      await charge(walletId, 1000, "ONLYTHIS");

      const res = await app.request(`/v1/wallets/${walletId}/statement?q=NOTHINGMATCHES`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries).toEqual([]);
    });
  });
});
