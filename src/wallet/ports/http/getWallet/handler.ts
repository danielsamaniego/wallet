import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/adapters/kernel/hono.context.js";
import { buildAppContext } from "../../../../shared/adapters/kernel/hono.context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { GetWalletHandler } from "../../../application/query/getWallet/handler.js";
import { parsePathId } from "../../../../api/validation.js";

const mainLogTag = "GetWalletHTTP";

export function getWalletHandler(handler: GetWalletHandler, logger: ILogger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildAppContext(c);

    const walletId = parsePathId(c.req.param("walletId"));
    if (!walletId) return c.json({ error: "INVALID_REQUEST", message: "invalid walletId" }, 400);

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
