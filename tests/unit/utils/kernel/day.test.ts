import { DAY_MS, dayCountInclusive, startOfDayMs, toISODate } from "@/utils/kernel/day.js";

describe("day kernel helpers", () => {
  describe("DAY_MS", () => {
    it("Then it equals 86_400_000", () => {
      expect(DAY_MS).toBe(86_400_000);
    });
  });

  describe("startOfDayMs", () => {
    it("Given a mid-day timestamp, Then it returns UTC midnight of that day", () => {
      // 2024-01-02T13:45:30Z
      const ms = Date.parse("2024-01-02T13:45:30.000Z");
      expect(startOfDayMs(ms)).toBe(Date.parse("2024-01-02T00:00:00.000Z"));
    });

    it("Given an exact UTC midnight, Then it returns the same instant", () => {
      const ms = Date.parse("2024-01-02T00:00:00.000Z");
      expect(startOfDayMs(ms)).toBe(ms);
    });
  });

  describe("dayCountInclusive", () => {
    it("Given the same day for from and to, Then it returns 1", () => {
      const from = Date.parse("2024-01-02T01:00:00.000Z");
      const to = Date.parse("2024-01-02T23:00:00.000Z");
      expect(dayCountInclusive(from, to)).toBe(1);
    });

    it("Given a 3-day span, Then it returns 3", () => {
      const from = Date.parse("2024-01-01T10:00:00.000Z");
      const to = Date.parse("2024-01-03T05:00:00.000Z");
      expect(dayCountInclusive(from, to)).toBe(3);
    });
  });

  describe("toISODate", () => {
    it("Given a timestamp, Then it returns the UTC date portion", () => {
      const ms = Date.parse("2024-01-02T13:45:30.000Z");
      expect(toISODate(ms)).toBe("2024-01-02");
    });
  });
});
