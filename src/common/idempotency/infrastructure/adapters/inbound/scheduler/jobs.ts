import type { ScheduledJob } from "../../../../../../utils/infrastructure/adapters/inbound/scheduler/scheduler.js";
import { cleanupIdempotencyJob } from "./cleanupIdempotency.job.js";

export const idempotencyJobs: ScheduledJob[] = [
  cleanupIdempotencyJob,
];
