import { AppError } from "../../../utils/kernel/appError.js";

export const ErrMovementNotFound = (movementId: string) =>
  AppError.notFound("MOVEMENT_NOT_FOUND", `movement ${movementId} not found`);

/**
 * Domain-level invariant: the lifecycle transitions are
 *   pending → processing → posted | failed
 *   posted → reversed (manual reversal)
 * Any other transition is a programming error and surfaces this code.
 * The same invariant is enforced at the DB level by the
 * `prevent_movement_modify` trigger (see prisma/immutable_ledger.sql).
 */
export const ErrInvalidMovementTransition = (movementId: string, from: string, to: string) =>
  AppError.domainRule(
    "INVALID_MOVEMENT_TRANSITION",
    `movement ${movementId} cannot transition from ${from} to ${to}`,
  );
