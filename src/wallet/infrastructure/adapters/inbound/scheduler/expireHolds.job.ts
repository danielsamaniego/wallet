import type { ScheduledJob } from "../../../../../utils/infrastructure/scheduler.js";
import { ExpireHoldsCommand } from "../../../../application/command/expireHolds/command.js";

export const expireHoldsJob: ScheduledJob = {
  name: "ExpireHolds",
  intervalMs: 30_000,
  command: () => new ExpireHoldsCommand(),
};
