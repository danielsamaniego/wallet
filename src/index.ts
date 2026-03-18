import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestResponseLog } from "./api/middleware/requestResponseLog.js";
import { trackingCanonical } from "./api/middleware/trackingCanonical.js";
import { loadConfig } from "./config.js";
import type { HonoVariables } from "./shared/kernel/context.js";
import { buildRequestContext } from "./shared/kernel/context.js";
import { wire } from "./wiring.js";

const config = loadConfig();
const deps = wire(config);

const app = new Hono<{ Variables: HonoVariables }>();

// Global error handler — catches unhandled exceptions and returns
// a generic 500 response without leaking internal details.
app.onError((err, c) => {
  const ctx = buildRequestContext(c);
  deps.logger.error(ctx, "Unhandled exception", { error: err.message });
  return c.json({ error: "INTERNAL_ERROR", message: "an unexpected error occurred" }, 500);
});

// Global middleware chain (order matters: tracking → logging → handler)
app.use("*", cors());
app.use("*", trackingCanonical(deps.idGen, deps.logger));
app.use("*", requestResponseLog(deps.logger));

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Route groups will be registered here:
// setupWalletRoutes(app, deps);
// setupTransferRoutes(app, deps);
// setupHoldRoutes(app, deps);
// setupPlatformRoutes(app, deps);

serve({ fetch: app.fetch, port: config.httpPort }, (info) => {
  console.log(`Wallet service running on http://localhost:${info.port}`);
});

export default app;
