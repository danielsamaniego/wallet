import { describe, it, expect, vi, afterEach } from "vitest";
import { startScheduledJobs } from "@/utils/infrastructure/scheduler.js";
import type { ScheduledJob } from "@/utils/infrastructure/scheduler.js";
import { createMockLogger, createMockIDGenerator } from "@test/helpers/mocks/index.js";

describe("startScheduledJobs", () => {
  const timers: NodeJS.Timeout[] = [];

  afterEach(() => {
    for (const t of timers) clearInterval(t);
    timers.length = 0;
  });

  describe("Given a list of scheduled jobs", () => {
    describe("When startScheduledJobs is called", () => {
      it("Then it dispatches each job command immediately and returns interval handles", async () => {
        const commandBus = { dispatch: vi.fn().mockResolvedValue({}) };
        const idGen = createMockIDGenerator();
        const logger = createMockLogger();

        const job: ScheduledJob = {
          name: "TestJob",
          intervalMs: 60_000,
          command: () => ({ type: "TestCommand" }) as any,
        };

        const handles = startScheduledJobs([job], commandBus as any, idGen, logger);
        timers.push(...handles);

        expect(handles).toHaveLength(1);

        // The job fires immediately (run() is called synchronously then awaited)
        // Allow the async run() to settle
        await new Promise((r) => setTimeout(r, 10));

        expect(commandBus.dispatch).toHaveBeenCalledOnce();
      });
    });
  });

  describe("Given a job that throws", () => {
    describe("When the job callback fails", () => {
      it("Then it logs the error and does not crash", async () => {
        const commandBus = {
          dispatch: vi.fn().mockRejectedValue(new Error("job boom")),
        };
        const idGen = createMockIDGenerator();
        const logger = createMockLogger();

        const job: ScheduledJob = {
          name: "FailingJob",
          intervalMs: 60_000,
          command: () => ({ type: "FailCommand" }) as any,
        };

        const handles = startScheduledJobs([job], commandBus as any, idGen, logger);
        timers.push(...handles);

        // Wait for async error to be caught
        await new Promise((r) => setTimeout(r, 10));

        expect(logger.error).toHaveBeenCalled();
      });
    });
  });
});
