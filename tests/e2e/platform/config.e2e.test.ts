import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";
import { TEST_PLATFORM_ID } from "@test/helpers/db.js";

// Platform config routes are temporarily disabled in platforms.routes.ts until
// proper admin authentication is implemented. Re-enable once the route is back.
describe.skip("Platform Config E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = (prefix = "cfg") => `${prefix}-${++idempCounter}-${Date.now()}`;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    idempCounter = 0;
  });

  // ── Happy path ──────────────────────────────────────────────────────

  describe("Given an authenticated platform", () => {
    describe("When PATCH /v1/platforms/config with allow_negative_balance=true", () => {
      it("Then returns 200 with the platform_id", async () => {
        const res = await app.request("/v1/platforms/config", {
          method: "PATCH",
          body: JSON.stringify({ allow_negative_balance: true }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.platform_id).toBe(TEST_PLATFORM_ID);
      });

      it("Then subsequent adjust with negative amount beyond balance succeeds", async () => {
        await app.request("/v1/platforms/config", {
          method: "PATCH",
          body: JSON.stringify({ allow_negative_balance: true }),
        });

        const createRes = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("create") },
          body: JSON.stringify({ owner_id: "cfg-owner-1", currency_code: "USD" }),
        });
        expect(createRes.status).toBe(201);
        const { wallet_id } = await createRes.json();

        const adjustRes = await app.request(`/v1/wallets/${wallet_id}/adjust`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey("adjust") },
          body: JSON.stringify({ amount_minor: -500, reason: "Debt after config change" }),
        });

        expect(adjustRes.status).toBe(201);
        const walletRes = await app.request(`/v1/wallets/${wallet_id}`);
        const wallet = await walletRes.json();
        expect(wallet.balance_minor).toBe(-500);
      });
    });

    describe("When PATCH /v1/platforms/config with allow_negative_balance=false", () => {
      it("Then returns 200 and the flag is reverted", async () => {
        // First enable
        await app.request("/v1/platforms/config", {
          method: "PATCH",
          body: JSON.stringify({ allow_negative_balance: true }),
        });

        // Then disable
        const res = await app.request("/v1/platforms/config", {
          method: "PATCH",
          body: JSON.stringify({ allow_negative_balance: false }),
        });

        expect(res.status).toBe(200);
      });
    });
  });

  // ── Authentication ──────────────────────────────────────────────────

  describe("Given no API key", () => {
    describe("When PATCH /v1/platforms/config", () => {
      it("Then returns 401 MISSING_API_KEY", async () => {
        const res = await app.unauthenticatedRequest("/v1/platforms/config", {
          method: "PATCH",
          body: JSON.stringify({ allow_negative_balance: true }),
        });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("MISSING_API_KEY");
      });
    });
  });

  // ── Validation ──────────────────────────────────────────────────────

  describe("Given an authenticated platform", () => {
    describe("When PATCH /v1/platforms/config with invalid body (missing field)", () => {
      it("Then returns 400", async () => {
        const res = await app.request("/v1/platforms/config", {
          method: "PATCH",
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(400);
      });
    });

    describe("When PATCH /v1/platforms/config with non-boolean value", () => {
      it("Then returns 400", async () => {
        const res = await app.request("/v1/platforms/config", {
          method: "PATCH",
          body: JSON.stringify({ allow_negative_balance: "yes" }),
        });

        expect(res.status).toBe(400);
      });
    });
  });
});
