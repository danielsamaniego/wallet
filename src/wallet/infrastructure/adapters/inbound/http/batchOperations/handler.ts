import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import type { ICommandBus } from "../../../../../../utils/application/cqrs.js";
import {
  buildAuthenticatedAppContext,
  handlerFactory,
} from "../../../../../../utils/infrastructure/hono.context.js";
import {
  ErrorResponseSchema,
  validationHook,
} from "../../../../../../utils/infrastructure/hono.error.js";
import { ApplyBatchOperationsCommand } from "../../../../../application/command/applyBatchOperations/command.js";
import { BodySchema, ResponseSchema } from "./schemas.js";

export function batchOperationsRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Apply multiple wallet operations as a single atomic batch",
      responses: {
        201: {
          description: "Batch applied",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        400: {
          description: "Validation error",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        404: {
          description: "Wallet not found",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        409: {
          description:
            "Concurrency conflict (LOCK_CONTENDED / VERSION_CONFLICT). Retry with the same Idempotency-Key.",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        422: {
          description: "Insufficient funds or currency mismatch",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const data = c.req.valid("json");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await commandBus.dispatch(
        ctx,
        new ApplyBatchOperationsCommand(
          ctx.platformId,
          data.operations.map((op) => ({
            walletId: op.wallet_id,
            type: op.type,
            amountMinor: BigInt(op.amount_minor),
            reason: op.reason,
          })),
          c.req.header("idempotency-key") ?? "",
          c.get("systemWalletShardCount") ?? 0,
          c.get("allowNegativeBalance") ?? false,
          data.preserve_operation_order ?? false,
          data.reference,
          data.metadata,
        ),
      );

      return c.json(
        {
          operations: result.operations.map((o) => ({
            movement_id: o.movementId,
            transaction_id: o.transactionId,
          })),
        },
        201,
      );
    },
  );
}
