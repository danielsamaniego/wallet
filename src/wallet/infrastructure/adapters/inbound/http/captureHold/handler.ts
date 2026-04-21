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
import { CaptureHoldCommand } from "../../../../../application/command/captureHold/command.js";
import { ParamSchema, ResponseSchema } from "./schemas.js";

export function captureHoldRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Holds"],
      summary: "Capture an authorization hold",
      responses: {
        201: {
          description: "Hold captured",
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
          description: "Hold not active",
          content: { "application/json": { schema: resolver(ErrorResponseSchema) } },
        },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    async (c) => {
      const { holdId } = c.req.valid("param");
      const ctx = buildAuthenticatedAppContext(c);

      const result = await commandBus.dispatch(
        ctx,
        new CaptureHoldCommand(
          holdId,
          ctx.platformId,
          c.req.header("idempotency-key") ?? "",
          c.get("systemWalletShardCount") ?? 0,
        ),
      );

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
