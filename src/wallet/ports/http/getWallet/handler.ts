import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/kernel/context.js";
import { buildRequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { GetWalletHandler } from "../../../app/query/getWallet/handler.js";

const mainLogTag = "GetWalletHTTP";

export function getWalletHandler(handler: GetWalletHandler, logger: Logger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildRequestContext(c);

    const walletId = c.req.param("walletId")!;

    try {
      const dto = await handler.handle(ctx, {
        walletId,
        platformId: ctx.platformId!,
      });

      return c.json(dto, 200);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
