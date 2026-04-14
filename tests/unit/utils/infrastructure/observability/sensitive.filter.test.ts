import { SensitiveKeysFilter } from "@/utils/infrastructure/observability/sensitive.filter.js";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import type { ILogger } from "@/utils/kernel/observability/logger.port.js";

// ── Tests ──────────────────────────────────────────────────────────

describe("SensitiveKeysFilter", () => {
  let inner: ILogger;
  let filter: SensitiveKeysFilter;
  const ctx = createTestContext();

  beforeEach(() => {
    inner = createMockLogger();
    filter = new SensitiveKeysFilter(inner, ["password", "secret", "token"]);
  });

  // ── Filtering extras ───────────────────────────────────────────

  describe("Given extras contain sensitive keys", () => {
    describe("When info is called with sensitive extras", () => {
      it("Then sensitive keys are stripped from the extras passed to inner", () => {
        filter.info(ctx, "test", { password: "s3cret", user: "alice" });

        expect(inner.info).toHaveBeenCalledWith(ctx, "test", { user: "alice" });
      });
    });

    describe("When debug is called with sensitive extras", () => {
      it("Then sensitive keys are stripped", () => {
        filter.debug(ctx, "test", { secret: "value", name: "bob" });

        expect(inner.debug).toHaveBeenCalledWith(ctx, "test", { name: "bob" });
      });
    });

    describe("When warn is called with sensitive extras", () => {
      it("Then sensitive keys are stripped", () => {
        filter.warn(ctx, "test", { token: "abc123", status: "ok" });

        expect(inner.warn).toHaveBeenCalledWith(ctx, "test", { status: "ok" });
      });
    });

    describe("When error is called with sensitive extras", () => {
      it("Then sensitive keys are stripped", () => {
        filter.error(ctx, "test", { password: "pass", error: "failure" });

        expect(inner.error).toHaveBeenCalledWith(ctx, "test", { error: "failure" });
      });
    });

    describe("When fatal is called with sensitive extras", () => {
      it("Then sensitive keys are stripped", () => {
        filter.fatal(ctx, "test", { secret: "x", code: 500 });

        expect(inner.fatal).toHaveBeenCalledWith(ctx, "test", { code: 500 });
      });
    });
  });

  // ── No extras ──────────────────────────────────────────────────

  describe("Given no extras are provided", () => {
    describe("When info is called without extras", () => {
      it("Then inner receives undefined extras", () => {
        filter.info(ctx, "no extras");

        expect(inner.info).toHaveBeenCalledWith(ctx, "no extras", undefined);
      });
    });
  });

  // ── Nested object filtering ────────────────────────────────────

  describe("Given extras with nested objects containing sensitive keys", () => {
    describe("When info is called with nested sensitive data", () => {
      it("Then sensitive keys are recursively stripped at all depths", () => {
        filter.info(ctx, "nested", {
          user: "alice",
          credentials: {
            password: "hidden",
            username: "alice",
          },
        });

        expect(inner.info).toHaveBeenCalledWith(ctx, "nested", {
          user: "alice",
          credentials: {
            username: "alice",
          },
        });
      });
    });
  });

  // ── Array filtering ────────────────────────────────────────────

  describe("Given extras with arrays containing objects with sensitive keys", () => {
    describe("When info is called", () => {
      it("Then sensitive keys inside array objects are stripped", () => {
        filter.info(ctx, "array", {
          items: [
            { name: "a", password: "p1" },
            { name: "b", secret: "s1" },
          ],
        });

        expect(inner.info).toHaveBeenCalledWith(ctx, "array", {
          items: [
            { name: "a" },
            { name: "b" },
          ],
        });
      });
    });
  });

  // ── Primitive and null values pass through ─────────────────────

  describe("Given extras with primitive values", () => {
    describe("When info is called with non-sensitive data", () => {
      it("Then all non-sensitive values pass through unchanged", () => {
        filter.info(ctx, "test", { count: 42, active: true, label: "test" });

        expect(inner.info).toHaveBeenCalledWith(ctx, "test", {
          count: 42,
          active: true,
          label: "test",
        });
      });
    });
  });

  describe("Given extras with null and undefined values", () => {
    describe("When info is called", () => {
      it("Then null and undefined values pass through", () => {
        filter.info(ctx, "test", { a: null, b: undefined });

        expect(inner.info).toHaveBeenCalledWith(ctx, "test", { a: null, b: undefined });
      });
    });
  });

  // ── with() ─────────────────────────────────────────────────────

  describe("Given with() is called", () => {
    describe("When the key is NOT sensitive", () => {
      it("Then it delegates to inner.with() and wraps in a new SensitiveKeysFilter", () => {
        const child = filter.with("service", "wallet");

        expect(inner.with).toHaveBeenCalledWith("service", "wallet");
        expect(child).not.toBe(filter);
        expect(child).toBeInstanceOf(SensitiveKeysFilter);
      });
    });

    describe("When the key IS sensitive", () => {
      it("Then it returns the same filter instance (does not delegate)", () => {
        const same = filter.with("password", "should-not-leak");

        expect(inner.with).not.toHaveBeenCalled();
        expect(same).toBe(filter);
      });
    });
  });

  // ── addCanonicalMeta ───────────────────────────────────────────

  describe("Given addCanonicalMeta is called", () => {
    describe("When entries contain sensitive keys", () => {
      it("Then sensitive keys are stripped before delegating to inner", () => {
        filter.addCanonicalMeta(ctx, { password: "x", op: "create" });

        expect(inner.addCanonicalMeta).toHaveBeenCalledWith(ctx, { op: "create" });
      });
    });

    describe("When entries is undefined", () => {
      it("Then inner.addCanonicalMeta is NOT called (filtered result is undefined)", () => {
        // addCanonicalMeta calls filterExtras; when it returns undefined the
        // `if (filtered)` guard on line 67 should prevent delegation.
        // We pass undefined-ish: the private method filterExtras returns undefined for undefined input.
        // Since addCanonicalMeta takes Record<string,unknown>, we cannot pass undefined directly.
        // Instead, test the edge case where ALL keys are sensitive (filterValue returns empty object which is truthy).
        // Actually, line 67 is: `if (filtered) this.inner.addCanonicalMeta(ctx, filtered);`
        // filterExtras returns undefined only when extras is falsy. Since the signature
        // requires Record<string,unknown>, the falsy path can only happen if someone passes
        // undefined via an explicit cast. Let's do that:
        filter.addCanonicalMeta(ctx, undefined as unknown as Record<string, unknown>);
        expect(inner.addCanonicalMeta).not.toHaveBeenCalled();
      });
    });
  });

  // ── incrementCanonical ─────────────────────────────────────────

  describe("Given incrementCanonical is called", () => {
    describe("When called with a key and delta", () => {
      it("Then it delegates directly to inner.incrementCanonical", () => {
        filter.incrementCanonical(ctx, "db_calls", 1);

        expect(inner.incrementCanonical).toHaveBeenCalledWith(ctx, "db_calls", 1);
      });
    });
  });

  // ── decrementCanonical ─────────────────────────────────────────

  describe("Given decrementCanonical is called", () => {
    describe("When called with a key and delta", () => {
      it("Then it delegates directly to inner.decrementCanonical", () => {
        filter.decrementCanonical(ctx, "retries", 2);

        expect(inner.decrementCanonical).toHaveBeenCalledWith(ctx, "retries", 2);
      });
    });
  });

  // ── dispatchCanonical methods ──────────────────────────────────

  describe("Given dispatchCanonical methods are called", () => {
    describe("When dispatchCanonicalDebug is called", () => {
      it("Then it delegates to inner.dispatchCanonicalDebug", () => {
        filter.dispatchCanonicalDebug(ctx, "done");

        expect(inner.dispatchCanonicalDebug).toHaveBeenCalledWith(ctx, "done");
      });
    });

    describe("When dispatchCanonicalInfo is called", () => {
      it("Then it delegates to inner.dispatchCanonicalInfo", () => {
        filter.dispatchCanonicalInfo(ctx, "done");

        expect(inner.dispatchCanonicalInfo).toHaveBeenCalledWith(ctx, "done");
      });
    });

    describe("When dispatchCanonicalWarn is called", () => {
      it("Then it delegates to inner.dispatchCanonicalWarn", () => {
        filter.dispatchCanonicalWarn(ctx, "done");

        expect(inner.dispatchCanonicalWarn).toHaveBeenCalledWith(ctx, "done");
      });
    });

    describe("When dispatchCanonicalError is called", () => {
      it("Then it delegates to inner.dispatchCanonicalError", () => {
        filter.dispatchCanonicalError(ctx, "done");

        expect(inner.dispatchCanonicalError).toHaveBeenCalledWith(ctx, "done");
      });
    });
  });

  // ── Empty sensitive keys list ──────────────────────────────────

  describe("Given sensitiveKeys contains empty strings", () => {
    describe("When the filter is constructed with ['', 'password']", () => {
      it("Then empty strings are ignored and only 'password' is filtered", () => {
        const f = new SensitiveKeysFilter(inner, ["", "password"]);
        f.info(ctx, "test", { password: "x", "": "empty-key-value", name: "ok" });

        expect(inner.info).toHaveBeenCalledWith(ctx, "test", { "": "empty-key-value", name: "ok" });
      });
    });
  });
});
