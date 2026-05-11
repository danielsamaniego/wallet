import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("GET /v1/movements/{id} E2E", () => {
  let app: TestApp;
  let walletId: string;
  let movementId: string;
  let idempCounter = 0;

  const nextKey = () => `get-movement-${++idempCounter}`;

  /** Helper: create a wallet, deposit funds, return the resulting movement_id. */
  async function setupMovement(): Promise<{ walletId: string; movementId: string }> {
    const createRes = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: "movement-test-owner", currency_code: "USD" }),
    });
    const { wallet_id } = await createRes.json();

    const depositRes = await app.request(`/v1/wallets/${wallet_id}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_minor: 5000 }),
    });
    const { movement_id } = await depositRes.json();

    return { walletId: wallet_id, movementId: movement_id };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    idempCounter = 0;
    const setup = await setupMovement();
    walletId = setup.walletId;
    movementId = setup.movementId;
  });

  // ── Happy path ─────────────────────────────────────────────────────

  describe("Given a posted deposit movement owned by the platform", () => {
    describe("When fetched by its id", () => {
      it("Then it returns 200 with the movement DTO", async () => {
        const res = await app.request(`/v1/movements/${movementId}`);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe(movementId);
        expect(body.type).toBe("deposit");
        expect(body.status).toBe("posted");
        expect(body.reason).toBeNull();
        expect(body.failed_reason).toBeNull();
        expect(typeof body.created_at).toBe("number");
        expect(body.created_at).toBeGreaterThan(0);
      });
    });
  });

  describe("Given a posted adjustment movement with a reason owned by the platform (negative-balance platform)", () => {
    describe("When fetched by its id", () => {
      it("Then it returns 200 and surfaces the reason text", async () => {
        // The adjustment endpoint requires `allow_negative_balance` for negative
        // deltas; use a positive delta so any platform can produce it.
        const adjustRes = await app.negativeBalanceRequest("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ owner_id: "adj-owner", currency_code: "USD" }),
        });
        const { wallet_id: adjustWalletId } = await adjustRes.json();

        const opRes = await app.negativeBalanceRequest(`/v1/wallets/${adjustWalletId}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 1000, reason: "manual top-up" }),
        });
        const { movement_id: adjMovementId } = await opRes.json();

        const res = await app.negativeBalanceRequest(`/v1/movements/${adjMovementId}`);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.type).toBe("adjustment");
        expect(body.status).toBe("posted");
        expect(body.reason).toBe("manual top-up");
      });
    });
  });

  // ── Authentication (category 1) ────────────────────────────────────

  describe("Given no API key", () => {
    describe("When fetching the movement", () => {
      it("Then it returns 401 MISSING_API_KEY", async () => {
        const res = await app.unauthenticatedRequest(`/v1/movements/${movementId}`);
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("MISSING_API_KEY");
      });
    });
  });

  describe("Given a malformed API key", () => {
    describe("When fetching the movement", () => {
      it("Then it returns 401", async () => {
        const res = await app.unauthenticatedRequest(`/v1/movements/${movementId}`, {
          headers: { "X-API-Key": "not-a-real-key" },
        });
        expect(res.status).toBe(401);
      });
    });
  });

  describe("Given a SQL-injection-shaped API key", () => {
    describe("When fetching the movement", () => {
      it("Then it returns 401 without executing the payload", async () => {
        const res = await app.unauthenticatedRequest(`/v1/movements/${movementId}`, {
          headers: { "X-API-Key": "wk_anything.' OR '1'='1" },
        });
        expect(res.status).toBe(401);
      });
    });
  });

  // ── Cross-tenant isolation (category 3) ────────────────────────────

  describe("Given a movement owned by another platform", () => {
    describe("When the attacker platform fetches it by id", () => {
      it("Then it returns 404 (not 403) so attackers cannot enumerate movement ids", async () => {
        const res = await app.attackerRequest(`/v1/movements/${movementId}`);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("MOVEMENT_NOT_FOUND");
      });
    });
  });

  // ── Edge cases (category 10) ───────────────────────────────────────

  describe("Given a non-existent but well-formed id", () => {
    describe("When fetching it", () => {
      it("Then it returns 404 MOVEMENT_NOT_FOUND", async () => {
        const res = await app.request("/v1/movements/019560a0-0000-7000-8000-ffffffffffff");
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("MOVEMENT_NOT_FOUND");
      });
    });
  });

  describe("Given a non-UUID arbitrary string id", () => {
    describe("When fetching it", () => {
      it("Then it returns 404 (no row matches; the column is text and accepts any string)", async () => {
        const res = await app.request("/v1/movements/not-a-uuid");
        expect(res.status).toBe(404);
      });
    });
  });

  describe("Given an oversized id (256 chars)", () => {
    describe("When fetching it", () => {
      it("Then it returns 400 from the param validator", async () => {
        const longId = "a".repeat(256);
        const res = await app.request(`/v1/movements/${longId}`);
        expect(res.status).toBe(400);
      });
    });
  });

  // ── Information disclosure (category 11) ───────────────────────────

  describe("Given any 404 response", () => {
    describe("When inspecting the body", () => {
      it("Then it does not leak a stack trace or internal details", async () => {
        const res = await app.request("/v1/movements/019560a0-0000-7000-8000-ffffffffffff");
        const body = await res.text();
        expect(body).not.toMatch(/at .+\(.+:\d+:\d+\)/); // node stack frame
        expect(body).not.toMatch(/PrismaClient/i);
        expect(body).not.toMatch(/postgres/i);
      });
    });
  });

  // ── Read-only contract ─────────────────────────────────────────────

  describe("Given the GET endpoint", () => {
    describe("When called without Idempotency-Key", () => {
      it("Then it returns 200 (idempotency middleware applies to mutations only)", async () => {
        const res = await app.request(`/v1/movements/${movementId}`);
        expect(res.status).toBe(200);
      });
    });

    describe("When called with HTTP method POST", () => {
      it("Then it returns 404 (route is GET-only)", async () => {
        const res = await app.request(`/v1/movements/${movementId}`, { method: "POST" });
        expect(res.status).toBe(404);
      });
    });
  });

  // ── Use walletId so it is not flagged as unused setup ──────────────

  describe("Given the setup wallet matches the deposit movement", () => {
    it("Then a follow-up read of the wallet observes the deposited balance (sanity check)", async () => {
      const res = await app.request(`/v1/wallets/${walletId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.balance_minor).toBe(5000);
    });
  });
});
