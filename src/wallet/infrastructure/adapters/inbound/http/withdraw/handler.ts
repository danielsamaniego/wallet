import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "../../../../../../utils/infrastructure/kernel/hono.error.js";
import { buildAppContext, handlerFactory } from "../../../../../../utils/infrastructure/kernel/hono.context.js";
import type { ICommandBus } from "../../../../../../utils/application/cqrs.js";
import { WithdrawCommand } from "../../../../../application/command/withdraw/command.js";
import { BodySchema, ParamSchema, ResponseSchema } from "./schemas.js";

export function withdrawRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Withdraw funds from a wallet",
      responses: {
        201: { description: "Withdrawal completed", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        422: { description: "Insufficient funds", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);

      const result = await commandBus.dispatch(ctx, new WithdrawCommand(
        walletId,
        ctx.platformId!,
        BigInt(data.amount_cents),
        c.req.header("idempotency-key")!,
        data.reference,
      ));

      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
