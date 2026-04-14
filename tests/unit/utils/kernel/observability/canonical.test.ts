import { describe, it, expect } from "vitest";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";

describe("CanonicalAccumulator", () => {
  // ── add ──────────────────────────────────────────────────────────────

  describe("add", () => {
    it("Given a new accumulator, When adding a key-value pair, Then snapshot includes it", () => {
      const acc = new CanonicalAccumulator();
      acc.add("userId", "u-123");
      const { meta } = acc.snapshot();
      expect(meta.userId).toBe("u-123");
    });

    it("Given an existing key, When adding the same key, Then value is overwritten", () => {
      const acc = new CanonicalAccumulator();
      acc.add("status", "pending");
      acc.add("status", "done");
      const { meta } = acc.snapshot();
      expect(meta.status).toBe("done");
    });
  });

  // ── addMany ──────────────────────────────────────────────────────────

  describe("addMany", () => {
    it("Given multiple entries, When addMany is called, Then all entries appear in snapshot", () => {
      const acc = new CanonicalAccumulator();
      acc.addMany({ a: 1, b: "two", c: true });
      const { meta } = acc.snapshot();
      expect(meta).toEqual({ a: 1, b: "two", c: true });
    });

    it("Given existing keys, When addMany is called, Then existing keys are overwritten", () => {
      const acc = new CanonicalAccumulator();
      acc.add("a", "old");
      acc.addMany({ a: "new", b: "extra" });
      const { meta } = acc.snapshot();
      expect(meta.a).toBe("new");
      expect(meta.b).toBe("extra");
    });
  });

  // ── increment ────────────────────────────────────────────────────────

  describe("increment", () => {
    it("Given a new counter, When incremented, Then counter equals the delta", () => {
      const acc = new CanonicalAccumulator();
      acc.increment("dbCalls", 1);
      const { counters } = acc.snapshot();
      expect(counters.dbCalls).toBe(1);
    });

    it("Given an existing counter, When incremented again, Then counter accumulates", () => {
      const acc = new CanonicalAccumulator();
      acc.increment("dbCalls", 2);
      acc.increment("dbCalls", 3);
      const { counters } = acc.snapshot();
      expect(counters.dbCalls).toBe(5);
    });
  });

  // ── decrement ────────────────────────────────────────────────────────

  describe("decrement", () => {
    it("Given a counter at 10, When decremented by 3, Then counter equals 7", () => {
      const acc = new CanonicalAccumulator();
      acc.increment("tokens", 10);
      acc.decrement("tokens", 3);
      const { counters } = acc.snapshot();
      expect(counters.tokens).toBe(7);
    });

    it("Given no prior counter, When decremented, Then counter is negative", () => {
      const acc = new CanonicalAccumulator();
      acc.decrement("tokens", 5);
      const { counters } = acc.snapshot();
      expect(counters.tokens).toBe(-5);
    });
  });

  // ── snapshot ─────────────────────────────────────────────────────────

  describe("snapshot", () => {
    it("Given meta and counters, When snapshot is called, Then returns copies of both", () => {
      const acc = new CanonicalAccumulator();
      acc.add("key", "val");
      acc.increment("c", 1);
      const snap = acc.snapshot();

      // Mutating the snapshot should not affect the accumulator
      snap.meta.key = "mutated";
      snap.counters.c = 999;

      const snap2 = acc.snapshot();
      expect(snap2.meta.key).toBe("val");
      expect(snap2.counters.c).toBe(1);
    });

    it("Given an empty accumulator, When snapshot is called, Then returns empty objects", () => {
      const acc = new CanonicalAccumulator();
      const { meta, counters } = acc.snapshot();
      expect(meta).toEqual({});
      expect(counters).toEqual({});
    });
  });

  // ── clear ────────────────────────────────────────────────────────────

  describe("clear", () => {
    it("Given populated meta and counters, When clear is called, Then snapshot is empty", () => {
      const acc = new CanonicalAccumulator();
      acc.add("a", 1);
      acc.increment("c", 5);
      acc.clear();
      const { meta, counters } = acc.snapshot();
      expect(meta).toEqual({});
      expect(counters).toEqual({});
    });
  });
});
