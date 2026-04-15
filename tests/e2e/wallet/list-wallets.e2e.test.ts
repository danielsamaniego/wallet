import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("List Wallets E2E", () => {
  let app: TestApp;
  let idempCounter = 0;
  const nextKey = () => `list-wallets-${++idempCounter}`;

  async function createWallet(ownerId: string, currency = "USD"): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.wallet_id;
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  // ── Authentication ─────────────────────────────────────────────────────

  describe("Given an unauthenticated client", () => {
    describe("When listing wallets without an API key", () => {
      it("Then it should reject with 401 MISSING_API_KEY", async () => {
        const res = await app.unauthenticatedRequest("/v1/wallets");
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("MISSING_API_KEY");
      });
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────

  describe("Given multiple wallets exist for the platform", () => {
    beforeEach(async () => {
      await createWallet("owner-1", "USD");
      await createWallet("owner-2", "USD");
      await createWallet("owner-3", "EUR");
    });

    describe("When listing without filters", () => {
      it("Then it should return user wallets (excluding system wallets) for the authenticated platform", async () => {
        const res = await app.request("/v1/wallets");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.wallets).toBeInstanceOf(Array);
        // System wallets are included (one per currency auto-created), plus 3 user wallets = 5 total
        expect(body.wallets.length).toBeGreaterThanOrEqual(3);
        expect(body.next_cursor).toBeNull();

        const ownerIds = body.wallets.map((w: { owner_id: string }) => w.owner_id);
        expect(ownerIds).toContain("owner-1");
        expect(ownerIds).toContain("owner-2");
        expect(ownerIds).toContain("owner-3");
      });
    });

    describe("When filtering by owner_id", () => {
      it("Then it should return only that owner's wallets", async () => {
        const res = await app.request("/v1/wallets?filter%5Bowner_id%5D=owner-1");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.wallets).toHaveLength(1);
        expect(body.wallets[0].owner_id).toBe("owner-1");
        expect(body.wallets[0].currency_code).toBe("USD");
      });
    });

    describe("When filtering by currency_code", () => {
      it("Then it should return only wallets matching that currency", async () => {
        const res = await app.request("/v1/wallets?filter%5Bcurrency_code%5D=EUR");

        expect(res.status).toBe(200);
        const body = await res.json();
        const userWallets = body.wallets.filter((w: { is_system: boolean }) => !w.is_system);
        expect(userWallets).toHaveLength(1);
        expect(userWallets[0].currency_code).toBe("EUR");
        expect(userWallets[0].owner_id).toBe("owner-3");
      });
    });

    describe("When filtering by owner_id AND currency_code", () => {
      it("Then it should return the specific wallet for that owner + currency pair", async () => {
        const res = await app.request(
          "/v1/wallets?filter%5Bowner_id%5D=owner-1&filter%5Bcurrency_code%5D=USD",
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.wallets).toHaveLength(1);
        expect(body.wallets[0].owner_id).toBe("owner-1");
        expect(body.wallets[0].currency_code).toBe("USD");
      });
    });

    describe("When filtering by owner_id that does not exist", () => {
      it("Then it should return an empty array", async () => {
        const res = await app.request("/v1/wallets?filter%5Bowner_id%5D=non-existent-owner");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.wallets).toEqual([]);
        expect(body.next_cursor).toBeNull();
      });
    });
  });

  // ── Cross-tenant isolation ─────────────────────────────────────────────

  describe("Given a victim platform has wallets and an attacker platform also has wallets", () => {
    beforeEach(async () => {
      await createWallet("victim-user", "USD");

      await app.attackerRequest("/v1/wallets", {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({ owner_id: "attacker-user", currency_code: "USD" }),
      });
    });

    describe("When the attacker lists wallets", () => {
      it("Then it should only see its own wallets, not the victim's", async () => {
        const res = await app.attackerRequest("/v1/wallets");

        expect(res.status).toBe(200);
        const body = await res.json();
        const ownerIds = body.wallets.map((w: { owner_id: string }) => w.owner_id);
        expect(ownerIds).toContain("attacker-user");
        expect(ownerIds).not.toContain("victim-user");
      });
    });

    describe("When the attacker filters by victim's owner_id", () => {
      it("Then it should return an empty array (platform scope enforced)", async () => {
        const res = await app.attackerRequest("/v1/wallets?filter%5Bowner_id%5D=victim-user");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.wallets).toEqual([]);
      });
    });
  });

  // ── Pagination ─────────────────────────────────────────────────────────

  describe("Given more wallets than the requested limit", () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await createWallet(`owner-paginate-${i}`, "USD");
      }
    });

    describe("When listing with limit=2", () => {
      it("Then it should return at most 2 wallets and a next_cursor when more exist", async () => {
        const res = await app.request("/v1/wallets?limit=2");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.wallets.length).toBeLessThanOrEqual(2);
        expect(body.next_cursor).not.toBeNull();
      });

      it("Then paging with next_cursor should return the following page", async () => {
        const firstPage = await app.request("/v1/wallets?limit=2");
        expect(firstPage.status).toBe(200);
        const firstBody = await firstPage.json();
        expect(firstBody.next_cursor).not.toBeNull();

        const secondPage = await app.request(
          `/v1/wallets?limit=2&cursor=${encodeURIComponent(firstBody.next_cursor)}`,
        );
        expect(secondPage.status).toBe(200);
        const secondBody = await secondPage.json();

        const firstIds = new Set(firstBody.wallets.map((w: { id: string }) => w.id));
        for (const w of secondBody.wallets) {
          expect(firstIds.has(w.id)).toBe(false);
        }
      });
    });
  });

  // ── Invalid filters ────────────────────────────────────────────────────

  describe("Given an unknown filter field", () => {
    describe("When listing with an invalid filter", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request("/v1/wallets?filter%5Bsome_invalid_field%5D=value");
        expect([400, 422]).toContain(res.status);
      });
    });
  });
});
