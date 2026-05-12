import { describe, it, expect } from "vitest";
import { Movement } from "@/wallet/domain/movement/movement.entity.js";

const NOW = 1700000000000;
const PLATFORM_ID = "platform-1";

describe("Movement Entity", () => {
  describe("create", () => {
    describe.each(["deposit", "withdrawal", "transfer", "hold_capture", "adjustment"] as const)(
      "Given type %s",
      (type) => {
        describe("When creating", () => {
          it("Then type and fields are set correctly", () => {
            const m = Movement.create({
              id: "mov-1",
              type,
              platformId: PLATFORM_ID,
              createdAt: NOW,
            });
            expect(m.id).toBe("mov-1");
            expect(m.type).toBe(type);
            expect(m.platformId).toBe(PLATFORM_ID);
            expect(m.reason).toBeNull();
            expect(m.createdAt).toBe(NOW);
          });
        });
      },
    );

    describe("Given type adjustment with a reason", () => {
      describe("When creating", () => {
        it("Then reason is set", () => {
          const m = Movement.create({
            id: "mov-1",
            type: "adjustment",
            platformId: PLATFORM_ID,
            reason: "Corrección de error",
            createdAt: NOW,
          });
          expect(m.reason).toBe("Corrección de error");
        });
      });
    });

    describe("Given no explicit status", () => {
      describe("When creating", () => {
        it("Then status defaults to posted and failedReason is null", () => {
          const m = Movement.create({
            id: "mov-1",
            type: "deposit",
            platformId: PLATFORM_ID,
            createdAt: NOW,
          });
          expect(m.status).toBe("posted");
          expect(m.failedReason).toBeNull();
        });
      });
    });

    describe.each(["pending", "processing", "posted", "failed", "reversed"] as const)(
      "Given explicit status %s",
      (status) => {
        describe("When creating", () => {
          it("Then status is set to the provided value", () => {
            const m = Movement.create({
              id: "mov-1",
              type: "deposit",
              platformId: PLATFORM_ID,
              status,
              createdAt: NOW,
            });
            expect(m.status).toBe(status);
          });
        });
      },
    );

    describe("Given a failedReason on a failed movement", () => {
      describe("When creating", () => {
        it("Then failedReason is set", () => {
          const m = Movement.create({
            id: "mov-1",
            type: "deposit",
            platformId: PLATFORM_ID,
            status: "failed",
            failedReason: "qstash_max_attempts_exceeded",
            createdAt: NOW,
          });
          expect(m.status).toBe("failed");
          expect(m.failedReason).toBe("qstash_max_attempts_exceeded");
        });
      });
    });

    describe("Given an explicit platformId", () => {
      describe("When creating", () => {
        it("Then platformId is exposed via the getter", () => {
          const m = Movement.create({
            id: "mov-1",
            type: "deposit",
            platformId: "platform-xyz",
            createdAt: NOW,
          });
          expect(m.platformId).toBe("platform-xyz");
        });
      });
    });
  });

  describe("reconstruct", () => {
    describe("Given arbitrary values with explicit posted status", () => {
      describe("When reconstructing", () => {
        it("Then all getters return the provided values", () => {
          const m = Movement.reconstruct({
            id: "mov-r",
            type: "transfer",
            status: "posted",
            platformId: PLATFORM_ID,
            reason: null,
            failedReason: null,
            createdAt: 999,
          });
          expect(m.id).toBe("mov-r");
          expect(m.type).toBe("transfer");
          expect(m.status).toBe("posted");
          expect(m.platformId).toBe(PLATFORM_ID);
          expect(m.reason).toBeNull();
          expect(m.failedReason).toBeNull();
          expect(m.createdAt).toBe(999);
        });
      });
    });

    describe("Given a movement with reason", () => {
      describe("When reconstructing", () => {
        it("Then reason is preserved", () => {
          const m = Movement.reconstruct({
            id: "mov-r",
            type: "adjustment",
            status: "posted",
            platformId: PLATFORM_ID,
            reason: "Admin correction",
            failedReason: null,
            createdAt: 999,
          });
          expect(m.reason).toBe("Admin correction");
        });
      });
    });

    describe.each(["pending", "processing", "posted", "failed", "reversed"] as const)(
      "Given status %s from the database",
      (status) => {
        describe("When reconstructing", () => {
          it("Then status is preserved", () => {
            const m = Movement.reconstruct({
              id: "mov-r",
              type: "deposit",
              status,
              platformId: PLATFORM_ID,
              reason: null,
              failedReason: null,
              createdAt: 999,
            });
            expect(m.status).toBe(status);
          });
        });
      },
    );

    describe("Given a failed movement with a failedReason", () => {
      describe("When reconstructing", () => {
        it("Then failedReason is preserved", () => {
          const m = Movement.reconstruct({
            id: "mov-r",
            type: "deposit",
            status: "failed",
            platformId: PLATFORM_ID,
            reason: null,
            failedReason: "worker_crashed",
            createdAt: 999,
          });
          expect(m.failedReason).toBe("worker_crashed");
        });
      });
    });

    describe("Given a pre-Phase-2B legacy row with null platformId", () => {
      describe("When reconstructing", () => {
        it("Then platformId is exposed as null (callers fall back to the transactional path)", () => {
          const m = Movement.reconstruct({
            id: "mov-legacy",
            type: "deposit",
            status: "posted",
            platformId: null,
            reason: null,
            failedReason: null,
            createdAt: 100,
          });
          expect(m.platformId).toBeNull();
        });
      });
    });
  });
});
