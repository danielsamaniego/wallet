import { describe, it, expect } from "vitest";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

describe("AppError", () => {
  // ── wrap() factory ─────────────────────────────────────────────
  describe("Given a cause error", () => {
    describe("When AppError.wrap() is called", () => {
      it("Then it creates an AppError with the cause attached and a composite message", () => {
        const cause = new Error("original failure");
        const err = AppError.wrap(ErrorKind.Internal, "DB_ERROR", "query failed", cause);

        expect(err).toBeInstanceOf(AppError);
        expect(err.kind).toBe(ErrorKind.Internal);
        expect(err.code).toBe("DB_ERROR");
        expect(err.msg).toBe("query failed");
        expect(err.cause).toBe(cause);
        expect(err.message).toBe("query failed: original failure");
      });
    });
  });

  // ── unauthorized() factory ─────────────────────────────────────
  describe("Given an unauthorized scenario", () => {
    describe("When AppError.unauthorized() is called", () => {
      it("Then it creates an AppError with Unauthorized kind", () => {
        const err = AppError.unauthorized("INVALID_TOKEN", "token expired");

        expect(err).toBeInstanceOf(AppError);
        expect(err.kind).toBe(ErrorKind.Unauthorized);
        expect(err.code).toBe("INVALID_TOKEN");
        expect(err.msg).toBe("token expired");
        expect(err.message).toBe("token expired");
      });
    });
  });

  // ── forbidden() factory ─────────────────────────────────────────
  describe("Given a forbidden scenario", () => {
    describe("When AppError.forbidden() is called", () => {
      it("Then it creates an AppError with Forbidden kind", () => {
        const err = AppError.forbidden("ACCESS_DENIED", "not allowed");

        expect(err).toBeInstanceOf(AppError);
        expect(err.kind).toBe(ErrorKind.Forbidden);
        expect(err.code).toBe("ACCESS_DENIED");
        expect(err.msg).toBe("not allowed");
      });
    });
  });

  // ── internal() factory with cause ───────────────────────────────
  describe("Given an internal error scenario with a cause", () => {
    describe("When AppError.internal() is called with a cause", () => {
      it("Then it creates an AppError with Internal kind and the cause attached", () => {
        const cause = new Error("db connection lost");
        const err = AppError.internal("DB_ERROR", "database unavailable", cause);

        expect(err).toBeInstanceOf(AppError);
        expect(err.kind).toBe(ErrorKind.Internal);
        expect(err.code).toBe("DB_ERROR");
        expect(err.msg).toBe("database unavailable");
        expect(err.cause).toBe(cause);
        expect(err.message).toBe("database unavailable: db connection lost");
      });
    });
  });

  // ── internal() factory without cause ──────────────────────────
  describe("Given an internal error scenario without a cause", () => {
    describe("When AppError.internal() is called without a cause", () => {
      it("Then it creates an AppError with Internal kind and no cause", () => {
        const err = AppError.internal("UNKNOWN", "something went wrong");

        expect(err).toBeInstanceOf(AppError);
        expect(err.kind).toBe(ErrorKind.Internal);
        expect(err.code).toBe("UNKNOWN");
        expect(err.cause).toBeUndefined();
      });
    });
  });

  // ── is() type guard ────────────────────────────────────────────
  describe("Given a non-AppError value", () => {
    describe("When AppError.is() is called with a plain object", () => {
      it("Then it returns false", () => {
        expect(AppError.is({ kind: "INTERNAL", code: "X" })).toBe(false);
      });
    });
  });

  describe("Given an AppError value", () => {
    describe("When AppError.is() is called", () => {
      it("Then it returns true", () => {
        const err = AppError.create(ErrorKind.Validation, "BAD", "bad input");
        expect(AppError.is(err)).toBe(true);
      });
    });
  });
});
