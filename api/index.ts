import { loadConfig } from "../src/config.js";
import { wire } from "../src/wiring.js";
import { createApp } from "../src/app.js";
import type { IncomingMessage, ServerResponse } from "node:http";

// Memoized at module level: executed once per cold start,
// reused across warm requests in the same serverless instance.
const config = loadConfig();
const deps = wire(config);
const app = createApp(deps);

/**
 * Vercel serverless handler. Converts the Node.js IncomingMessage to a
 * standard Web Request using `rawBody` (populated by @vercel/node), then
 * hands it to Hono's `.fetch()` and writes the Response back.
 *
 * We bypass `@hono/node-server/vercel` because its `getRequestListener`
 * falls back to `Readable.toWeb(incoming)` when `rawBody` is not a Buffer,
 * which hangs indefinitely in Vercel's serverless runtime.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const url = new URL(req.url || "/", `${proto}://${host}`);

  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }

  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  // Read body from Vercel's rawBody (Buffer) or fall back to collecting chunks.
  let body: BodyInit | undefined;
  if (hasBody) {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (raw) {
      body = raw;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      body = Buffer.concat(chunks);
    }
  }

  const webReq = new Request(url.href, { method, headers, body });
  const webRes = await app.fetch(webReq);

  res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
  if (webRes.body) {
    const reader = webRes.body.getReader();
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        res.write(result.value);
      }
    }
  }
  res.end();
}
