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
import { ChargeCommand } from "../../../../../application/command/charge/command.js";
import { BodySchema, ParamSchema, ResponseSchema } from "./schemas.js";

export function chargeRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Charge fees to a wallet",
      responses: {
        201: {
          description: "Charge completed",
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
          description: "Insufficient funds",
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

      const result = await commandBus.dispatch(
        ctx,
        new ChargeCommand(
          walletId,
          ctx.platformId,
          BigInt(data.amount_minor),
          c.req.header("idempotency-key") ?? "",
          data.reference,
          data.metadata,
        ),
      );

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
