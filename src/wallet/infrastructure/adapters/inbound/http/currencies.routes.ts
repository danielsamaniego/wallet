import { Hono } from "hono";
import type { HonoVariables } from "../../../../../utils/infrastructure/hono.context.js";
import { listCurrenciesRoute } from "./listCurrencies/handler.js";

export function currencyRoutes() {
  const router = new Hono<{ Variables: HonoVariables }>();

  router.get("/", ...listCurrenciesRoute());

  return router;
}
