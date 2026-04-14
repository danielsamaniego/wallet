import { describe, it, expect } from "vitest";
import { cleanupIdempotencyJob } from "@/common/idempotency/infrastructure/adapters/inbound/scheduler/cleanupIdempotency.job.js";
import { idempotencyJobs } from "@/common/idempotency/infrastructure/adapters/inbound/scheduler/jobs.js";
import { CleanupIdempotencyCommand } from "@/common/idempotency/application/command/cleanupIdempotency/command.js";

describe("Idempotency scheduler jobs", () => {
  describe("cleanupIdempotencyJob", () => {
    it("Given the cleanupIdempotencyJob definition, When command() is called, Then it returns a CleanupIdempotencyCommand", () => {
      expect(cleanupIdempotencyJob.name).toBe("CleanupIdempotency");
      expect(cleanupIdempotencyJob.intervalMs).toBe(60_000);

      const cmd = cleanupIdempotencyJob.command();
      expect(cmd).toBeInstanceOf(CleanupIdempotencyCommand);
    });
  });

  describe("idempotencyJobs", () => {
    it("Given the idempotencyJobs array, Then it contains the cleanupIdempotencyJob", () => {
      expect(idempotencyJobs).toContain(cleanupIdempotencyJob);
      expect(idempotencyJobs).toHaveLength(1);
    });
  });
});
