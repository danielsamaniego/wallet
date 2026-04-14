import { describe, it, expect } from "vitest";
import { UUIDV7Generator } from "@/utils/infrastructure/uuidV7.js";

describe("UUIDV7Generator", () => {
  describe("Given a UUIDV7Generator instance", () => {
    describe("When newId() is called", () => {
      it("Then it returns a valid UUID string", () => {
        const gen = new UUIDV7Generator();
        const id = gen.newId();

        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      });

      it("Then each call returns a unique ID", () => {
        const gen = new UUIDV7Generator();
        const id1 = gen.newId();
        const id2 = gen.newId();

        expect(id1).not.toBe(id2);
      });
    });
  });
});
