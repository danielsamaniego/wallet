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
  CaptureHoldCommand,
  type CaptureHoldResult,
} from "../../../../../application/command/captureHold/command.js";
import { GetHoldQuery } from "../../../../../application/query/getHold/query.js";
import { asyncDispatch } from "../../../../../application/worker/asyncDispatch.js";
import type { MutationHandlerDeps } from "../types.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function captureHoldRoute(deps: MutationHandlerDeps) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Holds"],
      summary: "Capture an authorization hold",
      responses: {
        201: {
          description: "Hold captured",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        202: {
          description:
            "Async pipeline accepted the capture but the worker did not finish before the wait window. Poll GET /v1/movements/{id} for the terminal state.",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
        404: {
          description: "Hold not found",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        409: {
          description:
            "Concurrency conflict (LOCK_CONTENDED / VERSION_CONFLICT). Retry with the same Idempotency-Key.",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
        422: {
          description:
            "Hold not active, or async pipeline returned a terminal failure (the reason is surfaced as the error message).",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { holdId } = c.req.valid("param");
      const ctx = buildAuthenticatedAppContext(c);
      const idempotencyKey = c.req.header("idempotency-key") ?? "";
      const systemWalletShardCount = c.get("systemWalletShardCount") ?? 0;

      if (deps.asyncDispatch) {
        // Pre-resolve the hold's wallet_id for the worker's lock key.
        // The query is platform-scoped — throws 404 on missing or
        // cross-tenant hold, so the request collapses to NOT_FOUND
        // BEFORE we ever publish to QStash. This mirrors the sync
        // use case's pre-lock cross-tenant guard and prevents a known
        // hold id from triggering work for another platform.
        const hold = await deps.queryBus.dispatch(ctx, new GetHoldQuery(holdId, ctx.platformId));
        const outcome = await asyncDispatch<CaptureHoldResult>(
          ctx,
          deps.commandBus,
          deps.asyncDispatch.resultSubscriber,
          deps.asyncDispatch.handlerWaitMs,
          {
            type: "hold_capture",
            platformId: ctx.platformId,
            idempotencyKey,
            queuePayload: {
              holdId,
              walletId: hold.wallet_id,
              idempotencyKey,
              systemWalletShardCount,
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
        new CaptureHoldCommand(holdId, ctx.platformId, idempotencyKey, systemWalletShardCount),
      );

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
