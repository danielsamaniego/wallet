import { describeRoute, resolver } from "hono-openapi";
import { handlerFactory } from "../../../../../../utils/infrastructure/hono.context.js";
import { getSupportedCurrencies } from "../../../../../../utils/kernel/currency.js";
import { ResponseSchema } from "./schemas.js";

export function listCurrenciesRoute() {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Currencies"],
      summary: "List supported currencies",
      responses: {
        200: {
          description: "Supported currencies",
          content: { "application/json": { schema: resolver(ResponseSchema) } },
        },
      },
    }),
    (c) => {
      const currencies = getSupportedCurrencies().map((e) => ({
        code: e.code,
        minor_unit: e.minorUnit,
      }));
      return c.json({ currencies }, 200);
    },
  );
}
