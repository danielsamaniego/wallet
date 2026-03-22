import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../utils/infrastructure/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../utils/infrastructure/hono.context.js";
import type { ICommandBus } from "../../../../../../utils/application/cqrs.js";
import { TransferCommand } from "../../../../../application/command/transfer/command.js";
import { BodySchema, ResponseSchema } from "./schemas.js";

export function transferRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Transfers"],
      summary: "Transfer funds between wallets",
      responses: {
        201: { description: "Transfer completed", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        422: { description: "Insufficient funds or currency mismatch", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);

      const result = await commandBus.dispatch(ctx, new TransferCommand(
        data.source_wallet_id,
        data.target_wallet_id,
        ctx.platformId!,
        BigInt(data.amount_cents),
        c.req.header("idempotency-key")!,
        data.reference,
      ));

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
