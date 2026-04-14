import type { ScheduledJob } from "../../../../../../utils/infrastructure/scheduler.js";
import { CleanupIdempotencyCommand } from "../../../../application/command/cleanupIdempotency/command.js";

export const cleanupIdempotencyJob: ScheduledJob = {
  name: "CleanupIdempotency",
  intervalMs: 60_000,
  command: () => new CleanupIdempotencyCommand(),
};
