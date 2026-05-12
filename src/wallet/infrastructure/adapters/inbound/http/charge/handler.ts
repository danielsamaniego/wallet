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
  ChargeCommand,
  type ChargeResult,
} from "../../../../../application/command/charge/command.js";
import { asyncDispatch } from "../../../../../application/worker/asyncDispatch.js";
import type { MutationHandlerDeps } from "../types.js";
import { BodySchema, ParamSchema, ResponseSchema } from "./schemas.js";

export function chargeRoute(deps: MutationHandlerDeps) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Charge fees to a wallet",
      responses: {
        201: {
          description: "Charge completed",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        202: {
          description:
            "Async pipeline accepted the charge but the worker did not finish before the wait window. Poll GET /v1/movements/{id} for the terminal state.",
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
            "Insufficient funds, or async pipeline returned a terminal failure (the reason is surfaced as the error message).",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const data = c.req.valid("json");
      const ctx = buildAuthenticatedAppContext(c);
      const idempotencyKey = c.req.header("idempotency-key") ?? "";
      const systemWalletShardCount = c.get("systemWalletShardCount") ?? 0;

      if (deps.asyncDispatch) {
        const outcome = await asyncDispatch<ChargeResult>(
          ctx,
          deps.commandBus,
          deps.asyncDispatch.resultSubscriber,
          deps.asyncDispatch.handlerWaitMs,
          {
            type: "charge",
            platformId: ctx.platformId,
            idempotencyKey,
            queuePayload: {
              walletId,
              amountMinor: String(data.amount_minor),
              idempotencyKey,
              systemWalletShardCount,
              ...(data.reference !== undefined ? { reference: data.reference } : {}),
              ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
            },
          },
        );
        if (outcome.kind === "completed") {
          return c.json(
            { transaction_id: outcome.body.transactionId, movement_id: outcome.movementId },
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
        new ChargeCommand(
          walletId,
          ctx.platformId,
          BigInt(data.amount_minor),
          idempotencyKey,
          systemWalletShardCount,
          data.reference,
          data.metadata,
        ),
      );

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
