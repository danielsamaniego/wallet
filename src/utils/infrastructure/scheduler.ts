import type { ICommandBus, ICommand } from "../application/cqrs.js";
import type { IIDGenerator } from "../application/id.generator.js";
import type { ILogger } from "../kernel/observability/logger.port.js";
import { createAppContext } from "../kernel/context.js";

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  command: () => ICommand<unknown>;
}

/**
 * Inbound adapter that dispatches a command via the bus on a recurring interval.
 * Analogous to an HTTP route: the timer is the trigger, the bus is the inbound port.
 */
function startJob(
  job: ScheduledJob,
  commandBus: ICommandBus,
  idGen: IIDGenerator,
  logger: ILogger,
): NodeJS.Timeout {
  const run = async () => {
    const ctx = createAppContext(idGen);
    try {
      await commandBus.dispatch(ctx, job.command());
    } catch (err) {
      logger.error(ctx, `Scheduler | ${job.name} failed`, {
        error: (err as Error).message,
      });
    }
  };

  run();
  return setInterval(run, job.intervalMs);
}

/** Start all scheduled jobs. Call once at boot, like route mounting. */
export function startScheduledJobs(
  jobs: ScheduledJob[],
  commandBus: ICommandBus,
  idGen: IIDGenerator,
  logger: ILogger,
): NodeJS.Timeout[] {
  return jobs.map((job) => startJob(job, commandBus, idGen, logger));
}
