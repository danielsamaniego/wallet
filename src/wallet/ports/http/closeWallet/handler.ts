import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/adapters/kernel/hono.context.js";
import { buildAppContext } from "../../../../shared/adapters/kernel/hono.context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { CloseWalletHandler } from "../../../application/command/closeWallet/handler.js";

const mainLogTag = "CloseWalletHTTP";

export function closeWalletHandler(handler: CloseWalletHandler, logger: ILogger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildAppContext(c);

    const walletId = c.req.param("walletId")!;

    try {
      await handler.handle(ctx, { walletId, platformId: ctx.platformId! });
      return c.json({ status: "closed" }, 200);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
