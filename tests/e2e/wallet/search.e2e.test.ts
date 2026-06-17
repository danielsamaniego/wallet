import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Movements Search E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = (p = "se") => `${p}-${++idempCounter}-${Date.now()}`;

  async function createWallet(ownerId: string): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("create") },
      body: JSON.stringify({ owner_id: ownerId, currency_code: "USD" }),
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

  async function charge(walletId: string, amountMinor: number, reference: string): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/charge`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("charge") },
      body: JSON.stringify({ amount_minor: amountMinor, reference }),
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

  describe("Given charges with distinct references", () => {
    it("Then free-text q matches case-insensitively across the platform", async () => {
      const w = await createWallet("se-user");
      await deposit(w, 10000);
      await charge(w, 1000, "ALPHACOMMISSION");
      await charge(w, 1000, "BETAFEE");

      const res = await app.request("/v1/movements/search?q=alpha");
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.movements).toHaveLength(1);
      expect(body.movements[0].reference).toBe("ALPHACOMMISSION");
      expect(body.movements[0].type).toBe("charge");
    });
  });

  describe("Given a type filter combined with the query", () => {
    it("Then only matching types are returned", async () => {
      const w = await createWallet("se-type-user");
      await deposit(w, 10000);
      await charge(w, 1000, "MATCHME");

      const res = await app.request(
        "/v1/movements/search?q=MATCHME&filter%5Btype%5D=charge",
      );
      const body = await res.json();

      expect(body.movements.length).toBeGreaterThanOrEqual(1);
      expect(body.movements.every((m: { type: string }) => m.type === "charge")).toBe(true);
    });
  });

  describe("Given no query (filters only)", () => {
    it("Then it returns platform-wide movements by filter", async () => {
      const w = await createWallet("se-nofilter-user");
      await deposit(w, 5000);
      await charge(w, 1000, "X");

      const res = await app.request("/v1/movements/search?filter%5Btype%5D=charge");
      const body = await res.json();

      expect(body.movements.length).toBeGreaterThanOrEqual(1);
      expect(body.movements.every((m: { type: string }) => m.type === "charge")).toBe(true);
    });
  });

  describe("Given the victim platform has a movement", () => {
    it("Then the attacker platform's search cannot see it (cross-tenant isolation)", async () => {
      const victim = await createWallet("se-victim");
      await deposit(victim, 5000);
      await charge(victim, 1000, "VICTIMSECRET");

      const res = await app.attackerRequest("/v1/movements/search?q=VICTIMSECRET");
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.movements).toEqual([]);
    });
  });

  describe("Given an unauthenticated client", () => {
    it("Then search returns 401", async () => {
      const res = await app.unauthenticatedRequest("/v1/movements/search?q=x");
      expect(res.status).toBe(401);
    });
  });
});
