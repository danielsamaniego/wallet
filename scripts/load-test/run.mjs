#!/usr/bin/env node
// Wallet Service load tester.
//
// Creates N wallets, runs an ordered list of operations per wallet, all wallets in
// parallel (bounded by `concurrency`). Each operation gets a fresh Idempotency-Key.
// Emits a streaming CSV report and a summary to stdout.
//
// Usage:
//   WALLET_SERVICE_API_KEY=wk_xxx.yyy node scripts/load-test/run.mjs
//   WALLET_SERVICE_API_KEY=wk_xxx.yyy node scripts/load-test/run.mjs --config ./scenario.json
//   WALLET_BASE_URL=https://wallet-prod.vercel.app WALLET_SERVICE_API_KEY=... node scripts/load-test/run.mjs
//
// Env vars (override defaults):
//   WALLET_BASE_URL          base URL (default: https://wallet-prod.vercel.app)
//   WALLET_SERVICE_API_KEY   <api_key_id>.<secret>    (REQUIRED — no default)
//
// CLI args:
//   --config <path>          JSON file with any subset of config keys (see DEFAULT_CONFIG)
//   --dry-run                print resolved config and exit without firing any request
//
// Config keys (all optional in the JSON file — missing keys fall back to defaults):
//   baseUrl                  string
//   currencyCode             ISO 4217 uppercase (must be supported and in the platform's catalog)
//   walletCount              integer >= 1
//   ownerPrefix              string — prepended to each wallet's owner_id
//   operations               array of { type, amount_minor, reason? }
//                            type ∈ "deposit" | "withdraw" | "adjust" | "charge"
//                            adjust requires `reason`; amounts are integer minor units
//                            (negative allowed only for adjust)
//   concurrency              max wallet workflows running in parallel
//   requestTimeoutMs         per-request abort timeout
//   reportDir                where CSV reports are written
//   retryTransient           if true, retry once on 502/503/504 with the same Idempotency-Key

import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const DEFAULT_CONFIG = {
  baseUrl: "https://wallet-prod.vercel.app",
  currencyCode: "EUR",
  walletCount: 100,
  ownerPrefix: `load-${Date.now()}`,
  operations: [
    { type: "deposit", amount_minor: 10_000 },
    { type: "withdraw", amount_minor: 3_000 },
    { type: "adjust", amount_minor: -2_000, reason: "load-test negative adjust" },
    { type: "withdraw", amount_minor: 2_000 },
  ],
  concurrency: 100,
  requestTimeoutMs: 60_000,
  reportDir: "./load-test-reports",
  retryTransient: false,
};

function loadConfig() {
  let config = { ...DEFAULT_CONFIG };
  const args = process.argv.slice(2);
  const configFlag = args.indexOf("--config");
  if (configFlag > -1) {
    const path = args[configFlag + 1];
    if (!path) {
      console.error("ERROR: --config requires a path argument");
      process.exit(1);
    }
    const overrides = JSON.parse(readFileSync(path, "utf8"));
    config = { ...config, ...overrides };
  }
  if (process.env.WALLET_BASE_URL) config.baseUrl = process.env.WALLET_BASE_URL;
  config.dryRun = args.includes("--dry-run");
  if (!config.dryRun) {
    if (!process.env.WALLET_SERVICE_API_KEY) {
      console.error("ERROR: WALLET_SERVICE_API_KEY env var is required");
      process.exit(1);
    }
    config.apiKey = process.env.WALLET_SERVICE_API_KEY;
  }
  return config;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function doRequest(config, method, path, body, idempotencyKey) {
  const url = `${config.baseUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,
    "Idempotency-Key": idempotencyKey,
  };
  const start = performance.now();
  let status = 0;
  let rawText = "";
  let parsed = null;
  let error = "";
  try {
    const resp = await fetchWithTimeout(
      url,
      { method, headers, body: body ? JSON.stringify(body) : undefined },
      config.requestTimeoutMs,
    );
    status = resp.status;
    rawText = await resp.text();
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }
  } catch (e) {
    error = e?.name === "AbortError" ? `timeout after ${config.requestTimeoutMs}ms` : (e?.message ?? String(e));
  }
  const latencyMs = performance.now() - start;
  return { status, latencyMs, rawText, body: parsed, error };
}

async function requestWithMaybeRetry(config, method, path, body) {
  const idempotencyKey = randomUUID();
  let res = await doRequest(config, method, path, body, idempotencyKey);
  let retried = 0;
  if (config.retryTransient && (res.status === 502 || res.status === 503 || res.status === 504)) {
    await new Promise((r) => setTimeout(r, 250));
    res = await doRequest(config, method, path, body, idempotencyKey);
    retried = 1;
  }
  return { ...res, idempotencyKey, retried };
}

function endpointForOp(walletId, op) {
  switch (op.type) {
    case "deposit":
      return { path: `/v1/wallets/${walletId}/deposit`, body: { amount_minor: op.amount_minor } };
    case "withdraw":
      return { path: `/v1/wallets/${walletId}/withdraw`, body: { amount_minor: op.amount_minor } };
    case "charge":
      return { path: `/v1/wallets/${walletId}/charge`, body: { amount_minor: op.amount_minor } };
    case "adjust":
      return {
        path: `/v1/wallets/${walletId}/adjust`,
        body: { amount_minor: op.amount_minor, reason: op.reason ?? "load-test" },
      };
    default:
      throw new Error(`unknown op type: ${op.type}`);
  }
}

const CSV_COLUMNS = [
  "run_id",
  "wallet_index",
  "owner_id",
  "wallet_id",
  "op_seq",
  "op_type",
  "request_amount_minor",
  "idempotency_key",
  "started_at_iso",
  "latency_ms",
  "http_status",
  "response_code",
  "transaction_id",
  "movement_id",
  "retried",
  "error",
  "response_body",
];

function escapeCsv(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeRow(stream, fields) {
  stream.write(`${CSV_COLUMNS.map((c) => escapeCsv(fields[c])).join(",")}\n`);
}

function buildRow({ runId, walletIndex, ownerId, walletId, opSeq, opType, requestAmount, started, res }) {
  const responseCode = res.body && typeof res.body === "object" ? (res.body.error ?? "OK") : "OK";
  const truncatedBody = res.rawText ? res.rawText.slice(0, 1000) : "";
  return {
    run_id: runId,
    wallet_index: walletIndex,
    owner_id: ownerId,
    wallet_id: walletId,
    op_seq: opSeq,
    op_type: opType,
    request_amount_minor: requestAmount,
    idempotency_key: res.idempotencyKey,
    started_at_iso: started.toISOString(),
    latency_ms: Math.round(res.latencyMs),
    http_status: res.status,
    response_code: responseCode,
    transaction_id: res.body?.transaction_id ?? "",
    movement_id: res.body?.movement_id ?? "",
    retried: res.retried,
    error: res.error,
    response_body: truncatedBody,
  };
}

async function runWalletWorkflow(config, walletIndex, csvStream, runId, stats) {
  const ownerId = `${config.ownerPrefix}-${walletIndex}`;

  // Step 0: create wallet.
  const startedCreate = new Date();
  const createRes = await requestWithMaybeRetry(config, "POST", "/v1/wallets", {
    owner_id: ownerId,
    currency_code: config.currencyCode,
  });
  const row = buildRow({
    runId,
    walletIndex,
    ownerId,
    walletId: createRes.body?.wallet_id ?? "",
    opSeq: 0,
    opType: "create_wallet",
    requestAmount: "",
    started: startedCreate,
    res: createRes,
  });
  writeRow(csvStream, row);
  recordStat(stats, "create_wallet", row);

  const walletId = createRes.body?.wallet_id;
  if (!walletId) return; // can't run ops without a wallet

  // Steps 1..M: ops in sequence.
  for (let i = 0; i < config.operations.length; i++) {
    const op = config.operations[i];
    const { path, body } = endpointForOp(walletId, op);
    const started = new Date();
    const opRes = await requestWithMaybeRetry(config, "POST", path, body);
    const opRow = buildRow({
      runId,
      walletIndex,
      ownerId,
      walletId,
      opSeq: i + 1,
      opType: op.type,
      requestAmount: op.amount_minor,
      started,
      res: opRes,
    });
    writeRow(csvStream, opRow);
    recordStat(stats, op.type, opRow);
  }
}

function recordStat(stats, opType, row) {
  if (!stats[opType]) {
    stats[opType] = { total: 0, ok: 0, byStatus: {}, byCode: {}, latencies: [] };
  }
  const s = stats[opType];
  s.total++;
  if (row.http_status >= 200 && row.http_status < 300) s.ok++;
  s.byStatus[row.http_status] = (s.byStatus[row.http_status] ?? 0) + 1;
  s.byCode[row.response_code || "OK"] = (s.byCode[row.response_code || "OK"] ?? 0) + 1;
  s.latencies.push(row.latency_ms);
}

function pct(latencies, p) {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function printSummary(stats, totalMs) {
  console.log("");
  console.log("─".repeat(80));
  console.log(`Total wall-clock: ${(totalMs / 1000).toFixed(1)}s`);
  console.log("");
  const opOrder = ["create_wallet", "deposit", "withdraw", "adjust", "charge"];
  const present = opOrder.filter((o) => stats[o]);
  const header = "op             total  ok  fail   p50    p95    p99    max  http breakdown".padEnd(80);
  console.log(header);
  console.log("─".repeat(80));
  for (const op of present) {
    const s = stats[op];
    const fail = s.total - s.ok;
    const p50 = pct(s.latencies, 50);
    const p95 = pct(s.latencies, 95);
    const p99 = pct(s.latencies, 99);
    const max = s.latencies.length ? Math.max(...s.latencies) : 0;
    const statusBreakdown = Object.entries(s.byStatus)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([code, n]) => `${code}:${n}`)
      .join(" ");
    console.log(
      `${op.padEnd(14)} ${String(s.total).padStart(5)} ${String(s.ok).padStart(3)} ${String(fail).padStart(5)} ${String(p50).padStart(5)} ${String(p95).padStart(5)} ${String(p99).padStart(5)} ${String(max).padStart(6)}  ${statusBreakdown}`,
    );
  }
  console.log("");
  console.log("Error-code breakdown (non-OK responses):");
  for (const op of present) {
    const errs = Object.entries(stats[op].byCode).filter(([code]) => code !== "OK");
    if (errs.length === 0) continue;
    const summary = errs
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `${code}:${n}`)
      .join(" ");
    console.log(`  ${op.padEnd(14)} ${summary}`);
  }
}

async function runWithConcurrency(total, concurrency, worker) {
  let nextIdx = 0;
  const launchOne = async () => {
    for (;;) {
      const i = nextIdx++;
      if (i >= total) return;
      await worker(i);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, total) }, () => launchOne());
  await Promise.all(workers);
}

async function main() {
  const config = loadConfig();
  const runId = randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = resolve(config.reportDir, `report-${timestamp}.csv`);

  console.log("Wallet Load Tester");
  console.log("─".repeat(80));
  console.log(`Run ID:        ${runId}`);
  console.log(`Target:        ${config.baseUrl}`);
  console.log(`Currency:      ${config.currencyCode}`);
  console.log(`Wallets:       ${config.walletCount}`);
  console.log(`Ops/wallet:    ${config.operations.length + 1} (create + ${config.operations.map((o) => o.type).join(" → ")})`);
  console.log(`Concurrency:   ${config.concurrency}`);
  console.log(`Req timeout:   ${config.requestTimeoutMs}ms`);
  console.log(`Retry 5xx:     ${config.retryTransient}`);
  console.log(`Owner prefix:  ${config.ownerPrefix}`);
  console.log(`Report:        ${reportPath}`);
  console.log("");

  if (config.dryRun) {
    console.log("[dry-run] no requests fired.");
    return;
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  const csv = createWriteStream(reportPath);
  csv.write(`${CSV_COLUMNS.join(",")}\n`);

  const stats = {};
  const t0 = performance.now();

  await runWithConcurrency(config.walletCount, config.concurrency, (i) =>
    runWalletWorkflow(config, i, csv, runId, stats),
  );

  const totalMs = performance.now() - t0;
  csv.end();
  await new Promise((r) => csv.on("close", r));

  printSummary(stats, totalMs);
  console.log("");
  console.log(`CSV written to: ${reportPath}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
