import { describe, it, expect } from "vitest";
import { Movement } from "@/wallet/domain/movement/movement.entity.js";

const NOW = 1700000000000;

describe("Movement Entity", () => {
  describe("create", () => {
    describe.each(["deposit", "withdrawal", "transfer", "hold_capture"] as const)(
      "Given type %s",
      (type) => {
        describe("When creating", () => {
          it("Then type and fields are set correctly", () => {
            const m = Movement.create({ id: "mov-1", type, createdAt: NOW });
            expect(m.id).toBe("mov-1");
            expect(m.type).toBe(type);
            expect(m.createdAt).toBe(NOW);
          });
        });
      },
    );
  });

  describe("reconstruct", () => {
    describe("Given arbitrary values", () => {
      describe("When reconstructing", () => {
        it("Then all getters return the provided values", () => {
          const m = Movement.reconstruct({ id: "mov-r", type: "transfer", createdAt: 999 });
          expect(m.id).toBe("mov-r");
          expect(m.type).toBe("transfer");
          expect(m.createdAt).toBe(999);
        });
      });
    });
  });
});
