import { CleanupIdempotencyCommand } from "../../../../application/command/cleanupIdempotency/command.js";
import type { ScheduledJob } from "../../../../../../utils/infrastructure/adapters/inbound/scheduler/scheduler.js";

export const cleanupIdempotencyJob: ScheduledJob = {
  name: "CleanupIdempotency",
  intervalMs: 60_000,
  command: () => new CleanupIdempotencyCommand(),
};
