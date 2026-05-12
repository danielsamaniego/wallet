import type { Movement, MovementQueuePayload } from "../../../domain/movement/movement.entity.js";
import { AdjustBalanceCommand } from "../../command/adjustBalance/command.js";
import { CaptureHoldCommand } from "../../command/captureHold/command.js";
import { ChargeCommand } from "../../command/charge/command.js";
import { DepositCommand } from "../../command/deposit/command.js";
import { TransferCommand } from "../../command/transfer/command.js";
import { WithdrawCommand } from "../../command/withdraw/command.js";

/**
 * Marker error raised when `Movement.queuePayload` is missing, malformed,
 * or inconsistent with `Movement.type`. The use case catches it and
 * routes the movement to `failed`, so a single bad enqueue cannot block
 * the queue.
 */
export class InvalidQueuePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQueuePayloadError";
  }
}

/**
 * Lock-key + command pair returned by hydration. The use case wraps the
 * service call with `lockRunner.run(lockKeys, ...)`, so the keys must
 * cover every wallet the service is about to write to — same rule as
 * the sync use cases. For `transfer` the runner sorts + dedupes the
 * pair to prevent A↔B deadlocks.
 */
export interface HydratedDispatch<C> {
  command: C;
  lockKeys: string[];
}

type Payload = MovementQueuePayload;

function requireString(p: Payload, field: string): string {
  const v = p[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new InvalidQueuePayloadError(`queue_payload.${field} must be a non-empty string`);
  }
  return v;
}

function requireBigIntString(p: Payload, field: string): bigint {
  const v = p[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new InvalidQueuePayloadError(
      `queue_payload.${field} must be a non-empty string (BigInt-encoded)`,
    );
  }
  try {
    return BigInt(v);
  } catch {
    throw new InvalidQueuePayloadError(`queue_payload.${field} is not a parseable BigInt string`);
  }
}

function requireInt(p: Payload, field: string): number {
  const v = p[field];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new InvalidQueuePayloadError(`queue_payload.${field} must be an integer`);
  }
  return v;
}

function requireBool(p: Payload, field: string): boolean {
  const v = p[field];
  if (typeof v !== "boolean") {
    throw new InvalidQueuePayloadError(`queue_payload.${field} must be a boolean`);
  }
  return v;
}

function optionalString(p: Payload, field: string): string | undefined {
  const v = p[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new InvalidQueuePayloadError(`queue_payload.${field} must be a string when present`);
  }
  return v;
}

function optionalMetadata(p: Payload, field: string): Record<string, unknown> | undefined {
  const v = p[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new InvalidQueuePayloadError(
      `queue_payload.${field} must be a plain object when present`,
    );
  }
  return v as Record<string, unknown>;
}

function payloadOrThrow(movement: Movement): Payload {
  if (movement.queuePayload === null) {
    throw new InvalidQueuePayloadError("queue_payload is null");
  }
  return movement.queuePayload;
}

function platformOrThrow(movement: Movement): string {
  if (movement.platformId === null) {
    throw new InvalidQueuePayloadError("platform_id is null");
  }
  return movement.platformId;
}

/**
 * Per-type hydration. Each entry validates the payload, builds the
 * service command, and returns the lock keys the orchestrator must
 * acquire before calling the service.
 *
 * The shapes mirror what the Phase 2B.7 HTTP handler refactor will
 * write into `queue_payload`. Amounts travel as BigInt-encoded strings
 * because `queue_payload` is JSON (no native BigInt).
 */

export function hydrateDeposit(movement: Movement): HydratedDispatch<DepositCommand> {
  const p = payloadOrThrow(movement);
  const walletId = requireString(p, "walletId");
  const command = new DepositCommand(
    walletId,
    platformOrThrow(movement),
    requireBigIntString(p, "amountMinor"),
    requireString(p, "idempotencyKey"),
    requireInt(p, "systemWalletShardCount"),
    optionalString(p, "reference"),
    optionalMetadata(p, "metadata"),
  );
  return { command, lockKeys: [`wallet-lock:${walletId}`] };
}

export function hydrateWithdraw(movement: Movement): HydratedDispatch<WithdrawCommand> {
  const p = payloadOrThrow(movement);
  const walletId = requireString(p, "walletId");
  const command = new WithdrawCommand(
    walletId,
    platformOrThrow(movement),
    requireBigIntString(p, "amountMinor"),
    requireString(p, "idempotencyKey"),
    requireInt(p, "systemWalletShardCount"),
    optionalString(p, "reference"),
    optionalMetadata(p, "metadata"),
  );
  return { command, lockKeys: [`wallet-lock:${walletId}`] };
}

export function hydrateCharge(movement: Movement): HydratedDispatch<ChargeCommand> {
  const p = payloadOrThrow(movement);
  const walletId = requireString(p, "walletId");
  const command = new ChargeCommand(
    walletId,
    platformOrThrow(movement),
    requireBigIntString(p, "amountMinor"),
    requireString(p, "idempotencyKey"),
    requireInt(p, "systemWalletShardCount"),
    optionalString(p, "reference"),
    optionalMetadata(p, "metadata"),
  );
  return { command, lockKeys: [`wallet-lock:${walletId}`] };
}

export function hydrateAdjustment(movement: Movement): HydratedDispatch<AdjustBalanceCommand> {
  const p = payloadOrThrow(movement);
  const walletId = requireString(p, "walletId");
  const command = new AdjustBalanceCommand(
    walletId,
    platformOrThrow(movement),
    requireBigIntString(p, "amountMinor"),
    requireString(p, "reason"),
    requireString(p, "idempotencyKey"),
    requireBool(p, "allowNegativeBalance"),
    requireInt(p, "systemWalletShardCount"),
    optionalString(p, "reference"),
    optionalMetadata(p, "metadata"),
  );
  return { command, lockKeys: [`wallet-lock:${walletId}`] };
}

export function hydrateTransfer(movement: Movement): HydratedDispatch<TransferCommand> {
  const p = payloadOrThrow(movement);
  const sourceWalletId = requireString(p, "sourceWalletId");
  const targetWalletId = requireString(p, "targetWalletId");
  if (sourceWalletId === targetWalletId) {
    throw new InvalidQueuePayloadError("transfer source and target wallet ids must differ");
  }
  const command = new TransferCommand(
    sourceWalletId,
    targetWalletId,
    platformOrThrow(movement),
    requireBigIntString(p, "amountMinor"),
    requireString(p, "idempotencyKey"),
    optionalString(p, "reference"),
    optionalMetadata(p, "metadata"),
  );
  return {
    command,
    lockKeys: [`wallet-lock:${sourceWalletId}`, `wallet-lock:${targetWalletId}`],
  };
}

export function hydrateCaptureHold(movement: Movement): HydratedDispatch<CaptureHoldCommand> {
  const p = payloadOrThrow(movement);
  // walletId is pre-resolved by the HTTP handler (it owns the cross-tenant
  // guard) and stored alongside holdId so the worker derives the lock key
  // without a synchronous DB lookup on every queued message.
  const walletId = requireString(p, "walletId");
  const command = new CaptureHoldCommand(
    requireString(p, "holdId"),
    platformOrThrow(movement),
    requireString(p, "idempotencyKey"),
    requireInt(p, "systemWalletShardCount"),
  );
  return { command, lockKeys: [`wallet-lock:${walletId}`] };
}
