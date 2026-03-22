import type { ScheduledJob } from "./scheduler.js";
import { cleanupIdempotencyJob } from "./cleanupIdempotency.job.js";

export const sharedJobs: ScheduledJob[] = [
  cleanupIdempotencyJob,
];
