import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validationHook } from "../../../../api/validation.js";
import { buildAppContext, handlerFactory } from "../../../../shared/adapters/kernel/hono.context.js";
import type { GetLedgerEntriesHandler } from "../../../application/query/getLedgerEntries/handler.js";

const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export function getLedgerEntriesRoute(handler: GetLedgerEntriesHandler) {
  return handlerFactory.createHandlers(
    zValidator("param", ParamSchema, validationHook),
    zValidator("query", QuerySchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const { limit, cursor } = c.req.valid("query");
      const ctx = buildAppContext(c);

      const result = await handler.handle(ctx, {
        walletId,
        platformId: ctx.platformId!,
        limit,
        cursor,
      });

      return c.json(result, 200);
    },
  );
}
