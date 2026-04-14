import { PinoAdapter } from "@/utils/infrastructure/observability/pino.adapter.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";

// ── Tests ──────────────────────────────────────────────────────────

describe("PinoAdapter", () => {
  let adapter: PinoAdapter;

  beforeEach(() => {
    // Use "silent" level so tests don't produce output
    adapter = new PinoAdapter("silent");
  });

  // ── Log levels ─────────────────────────────────────────────────

  describe("Given a PinoAdapter with silent level", () => {
    describe("When debug is called", () => {
      it("Then it does not throw", () => {
        const ctx = createTestContext();
        expect(() => adapter.debug(ctx, "debug message")).not.toThrow();
      });
    });

    describe("When info is called", () => {
      it("Then it does not throw", () => {
        const ctx = createTestContext();
        expect(() => adapter.info(ctx, "info message")).not.toThrow();
      });
    });

    describe("When warn is called", () => {
      it("Then it does not throw", () => {
        const ctx = createTestContext();
        expect(() => adapter.warn(ctx, "warn message")).not.toThrow();
      });
    });

    describe("When error is called", () => {
      it("Then it does not throw", () => {
        const ctx = createTestContext();
        expect(() => adapter.error(ctx, "error message")).not.toThrow();
      });
    });

    describe("When fatal is called", () => {
      it("Then it does not throw", () => {
        const ctx = createTestContext();
        expect(() => adapter.fatal(ctx, "fatal message")).not.toThrow();
      });
    });
  });

  // ── Extras passed to log methods ───────────────────────────────

  describe("Given extras are provided", () => {
    describe("When info is called with extras", () => {
      it("Then it does not throw", () => {
        const ctx = createTestContext();
        expect(() => adapter.info(ctx, "with extras", { foo: "bar" })).not.toThrow();
      });
    });
  });

  // ── Context with platformId ────────────────────────────────────

  describe("Given a context with platformId", () => {
    describe("When info is called", () => {
      it("Then it does not throw (platformId is included in fields)", () => {
        const ctx = createTestContext({ platformId: "plat-1" });
        expect(() => adapter.info(ctx, "with platform")).not.toThrow();
      });
    });
  });

  // ── with() creates a child logger ─────────────────────────────

  describe("Given the adapter", () => {
    describe("When with() is called", () => {
      it("Then it returns a new ILogger instance", () => {
        const child = adapter.with("service", "wallet");

        expect(child).not.toBe(adapter);
        expect(child).toBeDefined();
      });

      it("Then the child logger can log without throwing", () => {
        const child = adapter.with("service", "wallet");
        const ctx = createTestContext();

        expect(() => child.info(ctx, "from child")).not.toThrow();
      });
    });
  });

  // ── Canonical meta ─────────────────────────────────────────────

  describe("Given canonical meta methods", () => {
    describe("When addCanonicalMeta is called", () => {
      it("Then it adds entries to the canonical accumulator", () => {
        const ctx = createTestContext();
        adapter.addCanonicalMeta(ctx, { key1: "value1", key2: 42 });

        const { meta } = ctx.canonical.snapshot();
        expect(meta).toEqual({ key1: "value1", key2: 42 });
      });
    });

    describe("When incrementCanonical is called", () => {
      it("Then it increments the counter", () => {
        const ctx = createTestContext();
        adapter.incrementCanonical(ctx, "db_queries", 1);
        adapter.incrementCanonical(ctx, "db_queries", 2);

        const { counters } = ctx.canonical.snapshot();
        expect(counters.db_queries).toBe(3);
      });
    });

    describe("When decrementCanonical is called", () => {
      it("Then it decrements the counter", () => {
        const ctx = createTestContext();
        adapter.incrementCanonical(ctx, "retries", 5);
        adapter.decrementCanonical(ctx, "retries", 2);

        const { counters } = ctx.canonical.snapshot();
        expect(counters.retries).toBe(3);
      });
    });
  });

  // ── dispatchCanonical ──────────────────────────────────────────

  describe("Given canonical data has been accumulated", () => {
    describe("When dispatchCanonicalDebug is called", () => {
      it("Then it does not throw and clears the accumulator", () => {
        const ctx = createTestContext();
        adapter.addCanonicalMeta(ctx, { op: "test" });
        adapter.incrementCanonical(ctx, "count", 1);

        expect(() => adapter.dispatchCanonicalDebug(ctx, "canonical debug")).not.toThrow();

        // Canonical should be cleared after dispatch
        const { meta, counters } = ctx.canonical.snapshot();
        expect(meta).toEqual({});
        expect(counters).toEqual({});
      });
    });

    describe("When dispatchCanonicalInfo is called", () => {
      it("Then it does not throw and clears the accumulator", () => {
        const ctx = createTestContext();
        adapter.addCanonicalMeta(ctx, { op: "test" });

        expect(() => adapter.dispatchCanonicalInfo(ctx, "canonical info")).not.toThrow();

        const { meta } = ctx.canonical.snapshot();
        expect(meta).toEqual({});
      });
    });

    describe("When dispatchCanonicalWarn is called", () => {
      it("Then it does not throw and clears the accumulator", () => {
        const ctx = createTestContext();
        adapter.incrementCanonical(ctx, "warnings", 1);

        expect(() => adapter.dispatchCanonicalWarn(ctx, "canonical warn")).not.toThrow();

        const { counters } = ctx.canonical.snapshot();
        expect(counters).toEqual({});
      });
    });

    describe("When dispatchCanonicalError is called", () => {
      it("Then it does not throw and clears the accumulator", () => {
        const ctx = createTestContext();

        expect(() => adapter.dispatchCanonicalError(ctx, "canonical error")).not.toThrow();

        const { meta, counters } = ctx.canonical.snapshot();
        expect(meta).toEqual({});
        expect(counters).toEqual({});
      });
    });
  });

  // ── dispatchCanonical with empty meta/counters ─────────────────

  describe("Given no canonical data has been accumulated", () => {
    describe("When dispatchCanonicalInfo is called", () => {
      it("Then it dispatches without meta or counters fields", () => {
        const ctx = createTestContext();

        // Should not throw even with empty canonical
        expect(() => adapter.dispatchCanonicalInfo(ctx, "empty canonical")).not.toThrow();
      });
    });
  });
});
