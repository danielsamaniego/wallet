import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/adapters/kernel/hono.context.js";
import { buildAppContext } from "../../../../shared/adapters/kernel/hono.context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { UnfreezeWalletHandler } from "../../../application/command/unfreezeWallet/handler.js";

const mainLogTag = "UnfreezeWalletHTTP";

export function unfreezeWalletHandler(handler: UnfreezeWalletHandler, logger: ILogger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildAppContext(c);

    const walletId = c.req.param("walletId")!;

    try {
      await handler.handle(ctx, { walletId, platformId: ctx.platformId! });
      return c.json({ status: "active" }, 200);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
