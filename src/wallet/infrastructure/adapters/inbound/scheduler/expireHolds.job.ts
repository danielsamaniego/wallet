import { ExpireHoldsCommand } from "../../../../application/command/expireHolds/command.js";
import type { ScheduledJob } from "../../../../../utils/infrastructure/scheduler.js";

export const expireHoldsJob: ScheduledJob = {
  name: "ExpireHolds",
  intervalMs: 30_000,
  command: () => new ExpireHoldsCommand(),
};
