import { describe, it, expect, vi } from "vitest";
import { ErrorKind } from "@/utils/kernel/appError.js";
import { httpStatus, validationHook } from "@/utils/infrastructure/hono.error.js";

describe("hono error utilities", () => {
  // ── httpStatus ───────────────────────────────────────────────────────

  describe("httpStatus", () => {
    it("Given Validation kind, When httpStatus is called, Then returns 400", () => {
      expect(httpStatus(ErrorKind.Validation)).toBe(400);
    });

    it("Given Unauthorized kind, When httpStatus is called, Then returns 401", () => {
      expect(httpStatus(ErrorKind.Unauthorized)).toBe(401);
    });

    it("Given Forbidden kind, When httpStatus is called, Then returns 403", () => {
      expect(httpStatus(ErrorKind.Forbidden)).toBe(403);
    });

    it("Given NotFound kind, When httpStatus is called, Then returns 404", () => {
      expect(httpStatus(ErrorKind.NotFound)).toBe(404);
    });

    it("Given Conflict kind, When httpStatus is called, Then returns 409", () => {
      expect(httpStatus(ErrorKind.Conflict)).toBe(409);
    });

    it("Given DomainRule kind, When httpStatus is called, Then returns 422", () => {
      expect(httpStatus(ErrorKind.DomainRule)).toBe(422);
    });

    it("Given Internal kind, When httpStatus is called, Then returns 500", () => {
      expect(httpStatus(ErrorKind.Internal)).toBe(500);
    });

    it("Given an unknown kind, When httpStatus is called, Then falls back to 500", () => {
      expect(httpStatus("UNKNOWN_KIND" as ErrorKind)).toBe(500);
    });
  });

  // ── validationHook ───────────────────────────────────────────────────

  describe("validationHook", () => {
    function fakeContext() {
      const jsonFn = vi.fn((_body: unknown, _status: number) => new Response());
      return { json: jsonFn } as unknown as Parameters<typeof validationHook>[1];
    }

    it("Given a successful validation result, When validationHook is called, Then returns undefined", () => {
      const c = fakeContext();
      const result = validationHook({ success: true, data: {} }, c);
      expect(result).toBeUndefined();
    });

    it("Given a failed validation result, When validationHook is called, Then returns an error response", () => {
      const c = fakeContext();
      const result = validationHook(
        { success: false, error: { message: "field is required" } },
        c,
      );
      expect(result).toBeDefined();
      expect((c as any).json).toHaveBeenCalledWith(
        { error: "INVALID_REQUEST", message: "field is required" },
        400,
      );
    });
  });
});
