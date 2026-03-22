import { ExpireHoldsCommand } from "../../../../application/command/expireHolds/command.js";
import type { ScheduledJob } from "../../../../../shared/infrastructure/adapters/inbound/scheduler/scheduler.js";

export const expireHoldsJob: ScheduledJob = {
  name: "ExpireHolds",
  intervalMs: 30_000,
  command: () => new ExpireHoldsCommand(),
};
