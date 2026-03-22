import type { ScheduledJob } from "../../../../../../utils/infrastructure/scheduler.js";
import { cleanupIdempotencyJob } from "./cleanupIdempotency.job.js";

export const idempotencyJobs: ScheduledJob[] = [
  cleanupIdempotencyJob,
];
