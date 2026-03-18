import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/kernel/context.js";
import { buildRequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { FreezeWalletHandler } from "../../../app/command/freezeWallet/handler.js";

const mainLogTag = "FreezeWalletHTTP";

export function freezeWalletHandler(handler: FreezeWalletHandler, logger: Logger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildRequestContext(c);

    const walletId = c.req.param("walletId")!;

    try {
      await handler.handle(ctx, { walletId });
      return c.json({ status: "frozen" }, 200);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
