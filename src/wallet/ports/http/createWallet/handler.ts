import type { Context } from "hono";
import { z } from "zod";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/kernel/context.js";
import { buildRequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { CreateWalletHandler } from "../../../app/command/createWallet/handler.js";

const mainLogTag = "CreateWalletHTTP";

const RequestSchema = z.object({
  owner_id: z.string().min(1),
  currency_code: z.string().length(3),
});

export function createWalletHandler(handler: CreateWalletHandler, logger: Logger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildRequestContext(c);

    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: "INVALID_REQUEST", message: "invalid JSON body" }, 400);
    }

    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "INVALID_REQUEST", message: parsed.error.message }, 400);
    }

    try {
      const result = await handler.handle(ctx, {
        ownerId: parsed.data.owner_id,
        platformId: ctx.platformId!,
        currencyCode: parsed.data.currency_code,
      });

      return c.json({ wallet_id: result.walletId }, 201);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
