import { describe, it, expect } from "vitest";
import { Movement } from "@/wallet/domain/movement/movement.entity.js";

const NOW = 1700000000000;

describe("Movement Entity", () => {
  describe("create", () => {
    describe.each(["deposit", "withdrawal", "transfer", "hold_capture", "adjustment"] as const)(
      "Given type %s",
      (type) => {
        describe("When creating", () => {
          it("Then type and fields are set correctly", () => {
            const m = Movement.create({ id: "mov-1", type, createdAt: NOW });
            expect(m.id).toBe("mov-1");
            expect(m.type).toBe(type);
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
            reason: "Corrección de error",
            createdAt: NOW,
          });
          expect(m.reason).toBe("Corrección de error");
        });
      });
    });
  });

  describe("reconstruct", () => {
    describe("Given arbitrary values", () => {
      describe("When reconstructing", () => {
        it("Then all getters return the provided values", () => {
          const m = Movement.reconstruct({
            id: "mov-r",
            type: "transfer",
            reason: null,
            createdAt: 999,
          });
          expect(m.id).toBe("mov-r");
          expect(m.type).toBe("transfer");
          expect(m.reason).toBeNull();
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
            reason: "Admin correction",
            createdAt: 999,
          });
          expect(m.reason).toBe("Admin correction");
        });
      });
    });
  });
});
