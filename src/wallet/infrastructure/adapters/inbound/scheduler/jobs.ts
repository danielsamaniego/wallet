import type { ScheduledJob } from "../../../../../shared/infrastructure/adapters/inbound/scheduler/scheduler.js";
import { expireHoldsJob } from "./expireHolds.job.js";

export const walletJobs: ScheduledJob[] = [
  expireHoldsJob,
];
