import { describe, expect, it } from "vitest";
import {
  LockBackendUnavailableError,
  LockContendedError,
} from "@/utils/application/distributed.lock.js";

describe("LockContendedError", () => {
  describe("Given a wallet lock key", () => {
    describe("When the error is instantiated", () => {
      it("Then it carries the key and a descriptive message", () => {
        const err = new LockContendedError("wallet-lock:abc-123");
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("LockContendedError");
        expect(err.key).toBe("wallet-lock:abc-123");
        expect(err.message).toContain("abc-123");
      });
    });
  });
});

describe("LockBackendUnavailableError", () => {
  describe("Given a wrapped cause error", () => {
    describe("When the error is instantiated with cause", () => {
      it("Then the message references the cause and cause is preserved", () => {
        const cause = new Error("connection refused");
        const err = new LockBackendUnavailableError(cause);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("LockBackendUnavailableError");
        expect(err.message).toContain("connection refused");
        expect(err.cause).toBe(cause);
      });
    });
  });

  describe("Given no cause", () => {
    describe("When the error is instantiated without cause", () => {
      it("Then the message is a generic default and cause is undefined", () => {
        const err = new LockBackendUnavailableError();
        expect(err.name).toBe("LockBackendUnavailableError");
        expect(err.message).toBe("lock backend unavailable");
        expect(err.cause).toBeUndefined();
      });
    });
  });
});
