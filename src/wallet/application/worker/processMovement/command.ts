import { ICommand } from "../../../../utils/application/cqrs.js";

/**
 * Terminal outcome of a worker invocation. `noop` means the row was no
 * longer `pending` when the worker tried to claim it (another worker
 * already won the race, or the movement is already terminal). Always a
 * benign ack — never propagated to the queue as a retry signal.
 */
export type ProcessMovementOutcome = "posted" | "failed" | "noop";

export interface ProcessMovementResult {
  outcome: ProcessMovementOutcome;
  /** Populated when `outcome === "failed"`. Mirrored on `Movement.failed_reason`. */
  failedReason?: string;
}

/**
 * Inbound command for the QStash worker route. Carries only the
 * `movement_id` — the worker reloads the persisted Movement (which
 * carries `type`, `platform_id`, and `queue_payload`) so the queue
 * message is never a source of truth.
 */
export class ProcessMovementCommand extends ICommand<ProcessMovementResult> {
  static readonly TYPE = "ProcessMovement";
  constructor(public readonly movementId: string) {
    super(ProcessMovementCommand.TYPE);
  }
}
