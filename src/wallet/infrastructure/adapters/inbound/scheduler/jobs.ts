import type { ScheduledJob } from "../../../../../utils/infrastructure/adapters/inbound/scheduler/scheduler.js";
import { expireHoldsJob } from "./expireHolds.job.js";

export const walletJobs: ScheduledJob[] = [
  expireHoldsJob,
];
