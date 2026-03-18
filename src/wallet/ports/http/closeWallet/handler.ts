import type { Context } from "hono";
import { withError } from "../../../../api/respond/error.js";
import type { HonoVariables } from "../../../../shared/kernel/context.js";
import { buildRequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { CloseWalletHandler } from "../../../app/command/closeWallet/handler.js";

const mainLogTag = "CloseWalletHTTP";

export function closeWalletHandler(handler: CloseWalletHandler, logger: Logger) {
  return async (c: Context<{ Variables: HonoVariables }>) => {
    const methodLogTag = `${mainLogTag} | handle`;
    const ctx = buildRequestContext(c);

    const walletId = c.req.param("walletId")!;

    try {
      await handler.handle(ctx, { walletId });
      return c.json({ status: "closed" }, 200);
    } catch (err) {
      return withError(c, logger, ctx, methodLogTag, err);
    }
  };
}
