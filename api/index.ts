import { getRequestListener } from "@hono/node-server";
import { loadConfig } from "../src/config.js";
import { wire } from "../src/wiring.js";
import { createApp } from "../src/app.js";

// Memoized at module level: executed once per cold start,
// reused across warm requests in the same serverless instance.
const config = loadConfig();
const deps = wire(config);
const app = createApp(deps);

export default getRequestListener(app.fetch);
