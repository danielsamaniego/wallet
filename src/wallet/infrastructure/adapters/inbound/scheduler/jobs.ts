import type { ScheduledJob } from "../../../../../utils/infrastructure/scheduler.js";
import { expireHoldsJob } from "./expireHolds.job.js";

export const walletJobs: ScheduledJob[] = [
  expireHoldsJob,
];
