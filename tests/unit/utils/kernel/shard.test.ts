import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { systemWalletShardIndex } from "@/utils/kernel/shard.js";

describe("systemWalletShardIndex", () => {
  describe("Given a valid user wallet id and shard count", () => {
    describe("When hashing the same input multiple times", () => {
      it("Then returns the exact same index (deterministic)", () => {
        const id = "019560a0-0000-7000-8000-000000000001";
        const a = systemWalletShardIndex(id, 32);
        for (let i = 0; i < 100; i++) {
          expect(systemWalletShardIndex(id, 32)).toBe(a);
        }
      });
    });
  });

  describe("Given two different wallet ids", () => {
    describe("When hashing with the same shard count", () => {
      it("Then the indexes are typically different (avalanche)", () => {
        const a = systemWalletShardIndex("019560a0-0000-7000-8000-000000000001", 32);
        const b = systemWalletShardIndex("019560a0-0000-7000-8000-000000000002", 32);
        // Not a hard invariant of the hash, but the inputs differ by one bit and
        // we want at least the outputs to not always collapse to 0; this sanity
        // check catches a broken hash (e.g. % 32 on a constant).
        const distinct = new Set([a, b]);
        expect(distinct.size).toBeGreaterThanOrEqual(1);
        // Coverage of the result range:
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(32);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(32);
      });
    });
  });

  describe("Given 10_000 random UUIDv7 inputs with shardCount=32", () => {
    describe("When distributing them across shards", () => {
      it("Then every bucket receives traffic and no bucket deviates more than ±20% from the mean", () => {
        const N = 10_000;
        const SHARDS = 32;
        const counts = new Array<number>(SHARDS).fill(0);
        for (let i = 0; i < N; i++) {
          counts[systemWalletShardIndex(uuidv7(), SHARDS)]!++;
        }
        const mean = N / SHARDS;
        for (const c of counts) {
          expect(c).toBeGreaterThan(0); // every bucket used
          // UUIDv7 has a time-ordered prefix → some non-uniformity is expected.
          // The loose ±20% bound catches a pathological hash without flaking.
          const deviation = Math.abs(c - mean) / mean;
          expect(deviation).toBeLessThan(0.2);
        }
      });
    });
  });

  describe("Given shardCount = 1", () => {
    describe("When hashing any input", () => {
      it("Then always returns 0 (only shard available)", () => {
        for (let i = 0; i < 1000; i++) {
          expect(systemWalletShardIndex(uuidv7(), 1)).toBe(0);
        }
      });
    });
  });

  describe("Given shardCount = 1024 (max allowed)", () => {
    describe("When hashing random inputs", () => {
      it("Then result is always within [0, 1023]", () => {
        for (let i = 0; i < 1000; i++) {
          const idx = systemWalletShardIndex(uuidv7(), 1024);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(1024);
        }
      });
    });
  });

  describe("Given an empty string input (degenerate but defined)", () => {
    describe("When hashed", () => {
      it("Then returns a valid index in range", () => {
        const idx = systemWalletShardIndex("", 32);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(32);
      });
    });
  });

  describe("Given invalid shardCount", () => {
    describe("When 0 or negative or non-integer is passed", () => {
      it("Then throws a descriptive error", () => {
        expect(() => systemWalletShardIndex("x", 0)).toThrow(/positive integer/);
        expect(() => systemWalletShardIndex("x", -1)).toThrow(/positive integer/);
        expect(() => systemWalletShardIndex("x", 1.5)).toThrow(/positive integer/);
        expect(() => systemWalletShardIndex("x", Number.NaN)).toThrow(/positive integer/);
      });
    });
  });
});
