import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import {
  buildAuthenticatedAppContext,
  handlerFactory,
} from "../../../../../../utils/infrastructure/hono.context.js";
import {
  ErrorResponseSchema,
  validationHook,
} from "../../../../../../utils/infrastructure/hono.error.js";
import { AppError } from "../../../../../../utils/kernel/appError.js";
import {
  TransferCommand,
  type TransferResult,
} from "../../../../../application/command/transfer/command.js";
import { asyncDispatch } from "../../../../../application/worker/asyncDispatch.js";
import type { MutationHandlerDeps } from "../types.js";
import { BodySchema, ResponseSchema } from "./schemas.js";

export function transferRoute(deps: MutationHandlerDeps) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Transfers"],
      summary: "Transfer funds between wallets",
      responses: {
        201: {
          description: "Transfer completed",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        202: {
          description:
            "Async pipeline accepted the transfer but the worker did not finish before the wait window. Poll GET /v1/movements/{id} for the terminal state.",
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
          description:
            "Insufficient funds, currency mismatch, or async pipeline returned a terminal failure (the reason is surfaced as the error message).",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const data = c.req.valid("json");
      const ctx = buildAuthenticatedAppContext(c);
      const idempotencyKey = c.req.header("idempotency-key") ?? "";

      if (deps.asyncDispatch) {
        const outcome = await asyncDispatch<TransferResult>(
          ctx,
          deps.commandBus,
          deps.asyncDispatch.resultSubscriber,
          deps.asyncDispatch.handlerWaitMs,
          {
            type: "transfer",
            platformId: ctx.platformId,
            idempotencyKey,
            queuePayload: {
              sourceWalletId: data.source_wallet_id,
              targetWalletId: data.target_wallet_id,
              amountMinor: String(data.amount_minor),
              idempotencyKey,
              ...(data.reference !== undefined ? { reference: data.reference } : {}),
              ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
            },
          },
        );
        if (outcome.kind === "completed") {
          return c.json(
            {
              source_transaction_id: outcome.body.sourceTransactionId,
              target_transaction_id: outcome.body.targetTransactionId,
              movement_id: outcome.movementId,
            },
            201,
          );
        }
        if (outcome.kind === "pending") {
          return c.json({ movement_id: outcome.movementId, status: "pending" as const }, 202);
        }
        throw AppError.domainRule("MOVEMENT_FAILED", outcome.failedReason);
      }

      const result = await deps.commandBus.dispatch(
        ctx,
        new TransferCommand(
          data.source_wallet_id,
          data.target_wallet_id,
          ctx.platformId,
          BigInt(data.amount_minor),
          idempotencyKey,
          data.reference,
          data.metadata,
        ),
      );

      return c.json(
        {
          source_transaction_id: result.sourceTransactionId,
          target_transaction_id: result.targetTransactionId,
          movement_id: result.movementId,
        },
        201,
      );
    },
  );
}
