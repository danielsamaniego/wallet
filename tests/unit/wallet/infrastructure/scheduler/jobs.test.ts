import { describe, it, expect } from "vitest";
import { expireHoldsJob } from "@/wallet/infrastructure/adapters/inbound/scheduler/expireHolds.job.js";
import { walletJobs } from "@/wallet/infrastructure/adapters/inbound/scheduler/jobs.js";
import { ExpireHoldsCommand } from "@/wallet/application/command/expireHolds/command.js";

describe("Wallet scheduler jobs", () => {
  describe("expireHoldsJob", () => {
    it("Given the expireHoldsJob definition, When command() is called, Then it returns an ExpireHoldsCommand", () => {
      expect(expireHoldsJob.name).toBe("ExpireHolds");
      expect(expireHoldsJob.intervalMs).toBe(30_000);

      const cmd = expireHoldsJob.command();
      expect(cmd).toBeInstanceOf(ExpireHoldsCommand);
    });
  });

  describe("walletJobs", () => {
    it("Given the walletJobs array, Then it contains the expireHoldsJob", () => {
      expect(walletJobs).toContain(expireHoldsJob);
      expect(walletJobs).toHaveLength(1);
    });
  });
});
