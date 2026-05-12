import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import {
  buildAuthenticatedAppContext,
  handlerFactory,
} from "../../../../../../utils/infrastructure/hono.context.js";
import {
  ErrorResponseSchema,
  validationHook,
} from "../../../../../../utils/infrastructure/hono.error.js";
import {
  DepositCommand,
  type DepositResult,
} from "../../../../../application/command/deposit/command.js";
import {
  asyncDispatch,
  rebuildAppErrorFromFailedOutcome,
} from "../../../../../application/worker/asyncDispatch.js";
import type { MutationHandlerDeps } from "../types.js";
import { BodySchema, ParamSchema, ResponseSchema } from "./schemas.js";

export function depositRoute(deps: MutationHandlerDeps) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Deposit funds into a wallet",
      responses: {
        201: {
          description: "Deposit completed",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        202: {
          description:
            "Async pipeline accepted the deposit but the worker did not finish before the wait window. Poll GET /v1/movements/{id} for the terminal state.",
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
            "Async pipeline returned a terminal failure. The reason is surfaced as the error message. The sync path translates domain errors to their native HTTP status.",
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
        const outcome = await asyncDispatch<DepositResult>(
          ctx,
          deps.commandBus,
          deps.asyncDispatch.resultSubscriber,
          deps.asyncDispatch.handlerWaitMs,
          {
            type: "deposit",
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
        // failed — the original AppError kind is lost across the queue,
        // so we surface as a 422 with the worker's failedReason. Future
        // iterations may extend the published payload with kind/code.
        throw rebuildAppErrorFromFailedOutcome(outcome);
      }

      const result = await deps.commandBus.dispatch(
        ctx,
        new DepositCommand(
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
