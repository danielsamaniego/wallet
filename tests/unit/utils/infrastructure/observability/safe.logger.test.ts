import { describe, it, expect, vi, beforeEach } from "vitest";
import { SafeLogger } from "@/utils/infrastructure/observability/safe.logger.js";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import type { ILogger } from "@/utils/kernel/observability/logger.port.js";

describe("SafeLogger", () => {
  let inner: ILogger;
  let safe: SafeLogger;
  const ctx = createTestContext();

  beforeEach(() => {
    inner = createMockLogger();
    safe = new SafeLogger(inner);
  });

  // ── fatal() ────────────────────────────────────────────────────
  describe("Given the fatal method is called", () => {
    describe("When inner.fatal succeeds", () => {
      it("Then it delegates to inner.fatal and then throws a FATAL error", () => {
        expect(() => safe.fatal(ctx, "crash")).toThrow("FATAL: crash");
        expect(inner.fatal).toHaveBeenCalledWith(ctx, "crash", undefined);
      });
    });
  });

  // ── with() ─────────────────────────────────────────────────────
  describe("Given the with() method is called", () => {
    describe("When inner.with succeeds", () => {
      it("Then it returns a new SafeLogger wrapping the child logger", () => {
        const child = safe.with("service", "wallet");

        expect(inner.with).toHaveBeenCalledWith("service", "wallet");
        expect(child).toBeInstanceOf(SafeLogger);
        expect(child).not.toBe(safe);
      });
    });

    describe("When inner.with throws", () => {
      it("Then it returns the same SafeLogger instance (swallows error)", () => {
        (inner.with as ReturnType<typeof vi.fn>).mockImplementation(() => {
          throw new Error("with failed");
        });

        const result = safe.with("key", "val");

        expect(result).toBe(safe);
      });
    });
  });

  // ── addCanonicalMeta ───────────────────────────────────────────
  describe("Given addCanonicalMeta is called", () => {
    it("Then it delegates to inner.addCanonicalMeta", () => {
      safe.addCanonicalMeta(ctx, { key: "value" });
      expect(inner.addCanonicalMeta).toHaveBeenCalledWith(ctx, { key: "value" });
    });
  });

  // ── incrementCanonical ─────────────────────────────────────────
  describe("Given incrementCanonical is called", () => {
    it("Then it delegates to inner.incrementCanonical", () => {
      safe.incrementCanonical(ctx, "counter", 1);
      expect(inner.incrementCanonical).toHaveBeenCalledWith(ctx, "counter", 1);
    });
  });

  // ── decrementCanonical ─────────────────────────────────────────
  describe("Given decrementCanonical is called", () => {
    it("Then it delegates to inner.decrementCanonical", () => {
      safe.decrementCanonical(ctx, "counter", 2);
      expect(inner.decrementCanonical).toHaveBeenCalledWith(ctx, "counter", 2);
    });
  });

  // ── dispatchCanonicalDebug ─────────────────────────────────────
  describe("Given dispatchCanonicalDebug is called", () => {
    it("Then it delegates to inner.dispatchCanonicalDebug", () => {
      safe.dispatchCanonicalDebug(ctx, "debug msg");
      expect(inner.dispatchCanonicalDebug).toHaveBeenCalledWith(ctx, "debug msg");
    });
  });

  // ── dispatchCanonicalInfo ──────────────────────────────────────
  describe("Given dispatchCanonicalInfo is called", () => {
    it("Then it delegates to inner.dispatchCanonicalInfo", () => {
      safe.dispatchCanonicalInfo(ctx, "info msg");
      expect(inner.dispatchCanonicalInfo).toHaveBeenCalledWith(ctx, "info msg");
    });
  });

  // ── dispatchCanonicalWarn ──────────────────────────────────────
  describe("Given dispatchCanonicalWarn is called", () => {
    it("Then it delegates to inner.dispatchCanonicalWarn", () => {
      safe.dispatchCanonicalWarn(ctx, "warn msg");
      expect(inner.dispatchCanonicalWarn).toHaveBeenCalledWith(ctx, "warn msg");
    });
  });

  // ── dispatchCanonicalError ─────────────────────────────────────
  describe("Given dispatchCanonicalError is called", () => {
    it("Then it delegates to inner.dispatchCanonicalError", () => {
      safe.dispatchCanonicalError(ctx, "error msg");
      expect(inner.dispatchCanonicalError).toHaveBeenCalledWith(ctx, "error msg");
    });
  });

  // ── Swallowing errors ──────────────────────────────────────────
  describe("Given the inner logger throws on any method", () => {
    it("Then safe logger swallows the error for debug", () => {
      (inner.debug as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.debug(ctx, "msg")).not.toThrow();
    });

    it("Then safe logger swallows the error for info", () => {
      (inner.info as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.info(ctx, "msg")).not.toThrow();
    });

    it("Then safe logger swallows the error for warn", () => {
      (inner.warn as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.warn(ctx, "msg")).not.toThrow();
    });

    it("Then safe logger swallows the error for error", () => {
      (inner.error as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.error(ctx, "msg")).not.toThrow();
    });

    it("Then safe logger swallows errors for addCanonicalMeta", () => {
      (inner.addCanonicalMeta as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.addCanonicalMeta(ctx, { k: "v" })).not.toThrow();
    });

    it("Then safe logger swallows errors for incrementCanonical", () => {
      (inner.incrementCanonical as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.incrementCanonical(ctx, "k", 1)).not.toThrow();
    });

    it("Then safe logger swallows errors for decrementCanonical", () => {
      (inner.decrementCanonical as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.decrementCanonical(ctx, "k", 1)).not.toThrow();
    });

    it("Then safe logger swallows errors for dispatchCanonicalDebug", () => {
      (inner.dispatchCanonicalDebug as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.dispatchCanonicalDebug(ctx, "msg")).not.toThrow();
    });

    it("Then safe logger swallows errors for dispatchCanonicalInfo", () => {
      (inner.dispatchCanonicalInfo as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.dispatchCanonicalInfo(ctx, "msg")).not.toThrow();
    });

    it("Then safe logger swallows errors for dispatchCanonicalWarn", () => {
      (inner.dispatchCanonicalWarn as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.dispatchCanonicalWarn(ctx, "msg")).not.toThrow();
    });

    it("Then safe logger swallows errors for dispatchCanonicalError", () => {
      (inner.dispatchCanonicalError as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("boom"); });
      expect(() => safe.dispatchCanonicalError(ctx, "msg")).not.toThrow();
    });
  });
});
