# Active Context — Wallet Service

## Current Focus

**Async movement processing — Phase 1A landed (foundation, no behavior change).** The wallet has begun a multi-phase migration toward an asynchronous, queue-backed processing pipeline (QStash → throttled worker → DB) to absorb concurrency peaks (~1000 simultaneous movements) without saturating the Postgres pool. The full plan lives in `HIGH_CONCURRENCY_PLAN.md` at the repo root. Phase 1A is purely structural: it adds the lifecycle column the worker will use, with zero impact on today's synchronous flows.

**Phase 1A (completed):**
- `Movement` aggregate: new `MovementStatus` type (`pending` | `processing` | `posted` | `failed` | `reversed`) and `failedReason: string | null`. `Movement.create()` takes both as optional with `status` defaulting to `'posted'`; `Movement.reconstruct()` requires both explicitly. Both new getters exposed.
- Prisma schema: `Movement.status String @default("posted")` + `Movement.failedReason String? @map("failed_reason")` + `@@index([status, createdAt])`. Migration `20260511060527_add_movement_status_lifecycle` is additive; the DB DEFAULT backfills every existing row (verified locally against a 87k-movement prod backup → 100% `posted`).
- `PrismaMovementRepo.save` persists both new fields. Added two new unit tests asserting the exact payload sent to `prisma.movement.create` (default case + failed case).
- All 7 synchronous use cases (`deposit`, `withdraw`, `transfer`, `charge`, `adjustBalance`, `captureHold`, `importHistoricalEntry`) continue to call `Movement.create({ id, type, createdAt })` unchanged and receive the `posted` default — runtime behavior is identical, API contract intact.
- Full unit suite: 906/906 at 100% coverage. E2E: 258/258. No regressions in the loaded prod backup.
- `WALLET_ASYNC_PROCESSING_ENABLED=false` everywhere; the flag is not yet read by any code path.

**Local infra ready for Phase 2:** `docker-compose.dev.yml` now ships a `qstash` service (Upstash's official dev image at `public.ecr.aws/upstash/qstash:latest`) on ports 8080/8081 with the public dev token + signing keys baked in. Verified end-to-end: 1 direct publish + 30 queue publishes all delivered with proper `Upstash-Signature` JWT headers; queue throttle (parallelism=10) observed in non-sequential delivery order; queue drained to `lag: 0`. `.env.example` documents the same vars for host-based development.

**Phase 1B (completed):**
- New endpoint `GET /v1/movements/{id}` returns `{ id, type, status, reason, failed_reason, created_at }`. Backed by a new `IMovementReadStore` port + `PrismaMovementReadStore` adapter + `GetMovementUseCase` (query bus handler). Routes mounted at `/v1/movements/` via a new `movements.routes.ts`. OpenAPI/Scalar pick the route up automatically through `describeRoute`.
- Cross-tenant isolation is enforced by the read store: a movement is only resolvable when at least one of its transactions points to a wallet of the requesting platform. No transactions yet (i.e. async `pending`/`processing` movements created in Phase 2) → 404. When Phase 2 lands the schema will denormalise `Movement.platform_id` so pending movements are resolvable; for now there are no such rows.
- Unit suite: 916/916 at 100% coverage. E2E: 271/271, including a new `get-movement.e2e.test.ts` covering auth (missing/malformed/SQL-injection-shaped keys), cross-tenant 404, input validation, edge cases, info-disclosure, and the GET/POST method discipline.

**Phase 1C (completed):**
- New internal endpoint `POST /internal/worker/process-movement`, mounted outside `/v1` because it is not part of the public API. Authenticated by the `Upstash-Signature` JWT header — no API-key auth applies here.
- New middleware `qstashSignature` in `utils/infrastructure/middleware/`. Reads the raw body once (the stream is then drained), verifies the JWT against the `Receiver` injected via DI, and stores the raw body on `HonoVariables.rawBody` so the downstream handler can re-parse it. Missing header → `401 MISSING_SIGNATURE`; verifier returns false or throws → `401 INVALID_SIGNATURE` (no underlying error leaked).
- `Config` gains an optional `qstash` field (both `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` required together). When missing, `wiring` does not build a `Receiver` and the worker route is not mounted (404 — fail-closed). Local docker-compose and `docker-compose.test.yml` carry the public dev keys so the route is reachable in both environments.
- `processMovementRoute` handler (Phase 1C scaffolding): parses the raw body with Zod (`movement_id` required, 1..255 chars), logs receipt, returns 200. Phase 2 replaces the logging step with the real `ProcessMovementUseCase`.
- Unit suite: 933/933 at 100% coverage. New tests cover the middleware (4 cases — missing header, valid sig, invalid sig, verifier throws), the handler (6 cases — missing rawBody, invalid JSON, schema violations, valid body), the routes file (3 cases — receiver undefined → 404; receiver wired → 401 without sig; receiver wired → 200 with sig), and the four `Config` permutations of QStash keys.
- E2E suite: 277/277. New `worker-process-movement.e2e.test.ts` covers 6 cases: missing signature, malformed signature, wrong auth scheme (API-key only — must still 401), GET method (404), unknown sub-path (404), and information-disclosure invariants on the 401 body. The happy path is intentionally not E2E-tested in this phase because forging a valid JWT inside the e2e harness is too heavy for the phase scope; unit tests cover it with a mock receiver.

**Phase 1D (completed):**
- New domain port `IMovementQueuePublisher` in `src/wallet/domain/ports/movement.queue.publisher.ts`. Outbound contract `publish(ctx, { movementId, idempotencyKey? })` that Phase 2's `EnqueueMovementUseCase` will call to schedule a `pending` movement for async processing. The payload is intentionally tiny — only the id travels; the worker re-loads the persisted movement to avoid drift between queue and DB.
- New domain port `IResultPublisher` in `src/wallet/domain/ports/result.publisher.ts`. Outbound contract `publish(ctx, { movementId, status, failedReason? })` where `status` is the terminal `"posted" | "failed"` only — intermediate states never traverse this channel. Phase 2's worker calls it after the business transaction commits so the original handler (awaiting on Redis pub/sub via the "sync illusion" pattern) can wake up and respond `200 OK` to the consumer.
- Both interfaces are declarations only — zero runtime code, zero adapters, zero wiring. Consistent with the existing port pattern (`IWalletReadStore`, `IMovementRepository`, etc.). Phase 2 adds `QStashMovementQueuePublisher` + `RedisResultPublisher` adapters and registers them through `wallet.module.ts`.

**Phase 2A (completed — service extraction):** every command use case (`deposit`, `withdraw`, `transfer`, `charge`, `adjustBalance`, `captureHold`, `importHistoricalEntry`) now splits into two colocated files: `usecase.ts` is the orchestrator (lock + tx envelope + `Movement.create` + `movementRepo.save` + delegate) and `service.ts` carries the business-rule core (wallet validation, balance updates, transactions, ledger entries). The Phase 2B async worker will load the pending Movement and invoke the same `service.execute(ctx, cmd, movement)` — zero duplication between sync and async paths. Each test file follows the split: `<op>.usecase.test.ts` (orchestration only, mocks the service) + `<op>.service.test.ts` (full business-rule coverage, mocks the repos). AGENTS.md § "CQRS file structure" updated to document the three-file pattern.

**Phase 2B.1 (completed — Movement.platformId denormalisation):**
- New nullable column `Movement.platform_id` + `(platform_id, status, created_at)` index. Migration `20260512044537_add_movement_platform_id` is self-contained: it ensures the `prevent_immutable_modify` function exists, temporarily drops the `movements_immutable` trigger so the one-time backfill `UPDATE` can run, populates `platform_id` from `transactions.wallet.platform_id` using `SELECT DISTINCT ON (t.movement_id)`, then restores the trigger. Idempotent against fresh deploys (no trigger present) and against existing DBs (trigger present from a prior `immutable_ledger.sql` run).
- `Movement` aggregate: `create()` now requires `platformId: string`; `reconstruct()` takes `platformId: string | null` so legacy orphan rows (no transactions to derive from) coexist as `null`. All 7 mutating use cases pass `cmd.platformId` when creating the Movement.
- `PrismaMovementRepo.save` persists `platformId` in the INSERT.
- `PrismaMovementReadStore.getById` switched to `OR: [{ platformId }, { transactions: { some: { wallet: { platformId } } } }]` — direct match for new rows (incl. Phase 2B `pending`/`processing`), transactional fallback for legacy NULL orphans. Unreachable-id semantics unchanged → 404.
- Local DB backfill (against the loaded prod backup): 46,249 movements got `platform_id`, 40,828 orphans remain NULL (legacy data-integrity artifacts that the API never exposed anyway).
- Unit suite: 976/976 at 100% coverage. E2E: 277/277 unchanged.

**Phase 2B.2 (completed — Movement state machine + repo write methods):**
- `Movement` aggregate gains immutable `transitionToProcessing()`, `transitionToPosted()`, `transitionToFailed(reason)` methods that return a *new* Movement aggregate (preserving the immutability of the domain object). Invalid transitions throw `INVALID_MOVEMENT_TRANSITION` via the new `movement.errors.ts`.
- `IMovementRepository` gains `findById`, `markProcessing`, `markPosted`, `markFailed`. `markProcessing` is an atomic claim (`updateMany WHERE id AND status='pending'`): returns the reloaded Movement when count=1, returns `null` when another worker already claimed the row (count=0). `markPosted` / `markFailed` use the same `WHERE status='processing'` guard and throw `MOVEMENT_NOT_FOUND` when the row is no longer in the expected state.
- `PrismaMovementRepo` implements all four with concrete Prisma calls.
- DB trigger overhaul in `prisma/immutable_ledger.sql`: the old `movements_immutable` trigger that blocked all UPDATEs is replaced by two triggers. `movements_lifecycle_only_update` runs `prevent_movement_modify_except_lifecycle()`, which allows only `status` (along the state machine) and `failed_reason` to change; every other column raises an exception. `movements_no_delete` keeps the DELETE block. Verified end-to-end with raw SQL: valid `pending → processing → posted` succeeds, invalid `pending → posted` and any `type` change are rejected.
- `src/index.ts` startup safety-net check updated to expect the new trigger names.
- Unit: 1000/1000 at 100% coverage. E2E: 277/277 unchanged.

**Phase 2B.3 (completed — outbound adapter implementations):**
- `QStashMovementQueuePublisher` adapter (implements `IMovementQueuePublisher`). Uses `@upstash/qstash` `Client.queue(name).enqueueJSON({ url, body, deduplicationId? })`. Body is minimal (`{ movement_id }`); the worker re-loads the persisted Movement so source-of-truth stays in Postgres. `idempotencyKey` forwards as `deduplicationId` for queue-level dedup BEFORE delivery (does not replace `IdempotencyRecord`).
- `RedisResultPublisher` adapter (implements `IResultPublisher`). Two writes per publish: `SET movement:result:{id}` with a 60-second TTL (the durable side), then `PUBLISH movement:result:{id}` for active subscribers (cosmetic until we add a SUBSCRIBE-based subscriber). SET happens BEFORE PUBLISH so a poller that starts mid-publish still observes the result.
- `RedisResultSubscriber` — polling-based reader. The HTTP handler will call `waitFor(movementId, { timeoutMs })` right after dispatching `EnqueueMovementCommand`; the method GETs `movement:result:{id}` every 50 ms until the value appears or the timeout fires. Polling (vs SUBSCRIBE) was chosen for serverless: no long-lived connection per request, compatible with both ioredis-TCP and Upstash-REST transports (future). Errors during a poll are swallowed; if the whole window stays broken the caller observes a timeout and falls back to 202.
- No wiring yet — Phase 2B.6 (handler refactor) registers the adapters and reads the related env vars (`QSTASH_TOKEN`, `QSTASH_URL`, `WALLET_INTERNAL_WORKER_URL`, `WALLET_HANDLER_WAIT_MS`).
- Unit: 1017/1017 at 100% coverage. New cases on each adapter (happy path, error propagation, sleep-skip on tight-deadline edge for the subscriber). E2E: 277/277 unchanged.

**Phase 2B.4 (completed — Movement.queuePayload for worker replay):**
- New nullable column `movements.queue_payload jsonb` + migration `20260512053811_add_movement_queue_payload`. No backfill needed — legacy rows stay NULL (they were synchronous and never enqueued anything).
- `Movement` aggregate gains a `queuePayload: MovementQueuePayload | null` field (loose `Record<string, unknown>` type; (de)serialiser in Phase 2B.5/2B.6 narrows by `movement.type`). Optional in `create()` (defaults `null` for sync flows), required in `reconstruct()`. All three transitions (`transitionToProcessing/Posted/Failed`) preserve the payload across status changes.
- `PrismaMovementRepo.save` persists it; `findById` / `markProcessing` reload it so the worker can replay the command.
- DB trigger `prevent_movement_modify_except_lifecycle()` extended to also block any UPDATE on `queue_payload` (the column is set once at INSERT and never changes — verified end-to-end with raw SQL).
- Unit: 1021/1021 at 100% coverage. New cases on Movement (default null queuePayload, explicit payload round-trips through getter) and on PrismaMovementRepo (payload persisted in save, payload reloaded in findById).
- E2E: 277/277 unchanged.

**Phase 2B.5 (completed — `EnqueueMovementUseCase` + publisher wiring):**
- New CQRS triple under `src/wallet/application/command/enqueueMovement/`: `command.ts` (`EnqueueMovementCommand(type, platformId, idempotencyKey, queuePayload, reason?)` + `EnqueueMovementResult { movementId }`) and `usecase.ts`. The handler generates a fresh `movement_id`, builds `Movement.create({ status: "pending", platformId, queuePayload, reason })`, persists it via `movementRepo.save`, then forwards `{ movementId, idempotencyKey }` to `IMovementQueuePublisher.publish`. Save-before-publish is invariant: a delivered queue message must always find a row. If publish fails after save, the pending row stays as a known orphan for a future reconciliation job (extending the state machine to allow a direct `pending → failed` rollback is deferred).
- No lock + tx envelope (different from the seven `<op>UseCase` orchestrators): the only DB write is a single idempotent INSERT and the publish is external. The async-path service layer (which DOES need lock + tx) runs later in the worker adapter.
- `Config` gains an optional `asyncPipeline` block built only when `QSTASH_TOKEN`, `QSTASH_URL`, and `WALLET_INTERNAL_WORKER_URL` are all set. New env vars: `WALLET_QSTASH_QUEUE_NAME` (default `"wallet-movements"`) and `WALLET_HANDLER_WAIT_MS` (default `1500`). Decoupled from `config.qstash` (the inbound signing keys for the worker route) — a tenant can run as a sync-only producer with the worker route still mounted to refuse inbound deliveries cleanly.
- `SharedInfra` gains optional `movementQueuePublisher?: IMovementQueuePublisher`. `wiring.ts` instantiates `new QStashClient({ token, baseUrl })` + `new QStashMovementQueuePublisher(...)` gated by `config.asyncPipeline` presence; otherwise it stays `undefined` and logs `qstash publisher disabled`.
- `wallet.module.ts` conditionally instantiates `EnqueueMovementUseCase(movementRepo, movementQueuePublisher, idGen, logger)` and registers `EnqueueMovementCommand.TYPE → handler` on the command bus only when the publisher is present (consistent with the optional `lockRunner` registration pattern). When `asyncPipeline` is unset, dispatching the command fails-fast at the bus — the Phase 2B.6 handler refactor falls back to the sync path in that case.
- Unit: 1033/1033 at 100% coverage. New `EnqueueMovementUseCase` test (6 cases: returns movementId, INSERTs pending Movement with type/platformId/queuePayload, publishes with deduplicationId, save-before-publish ordering, adjustment with reason, publish error propagation). New `config` test cases (6) cover the missing/present permutations and custom queueName/handlerWaitMs.
- E2E: 277/277 unchanged.

**Phase 2B.6 (completed — worker dispatcher real body):**
- New CQRS triple under `src/wallet/application/worker/processMovement/` (deliberately outside `application/command/` because the worker is a cross-cutting dispatcher that needs to import all six operation commands + services — `check-layer-violations.cjs` forbids cross-use-case imports inside `application/command/<folder>/`): `command.ts` (`ProcessMovementCommand(movementId)` + `ProcessMovementResult { outcome: "posted" | "failed" | "noop", failedReason? }`), `payload.ts` (per-type pure hydrators that read `Movement.queue_payload` and build the matching operation command), and `usecase.ts` (orchestrator). Loose `Record<string, unknown>` payloads carry BigInt amounts as strings (JSON has no native BigInt) — hydrators validate and `BigInt()`-decode.
- `ProcessMovementUseCase.handle`: (1) `markProcessing` — atomic `pending → processing` claim, returns `null` for any non-`pending` row → `outcome: "noop"`, queue acks without publish; (2) hydrate the per-type command + derive lock keys from the payload; (3) run `<op>Service.execute` inside `lockRunner.run(lockKeys, txManager.run(...))`; (4) `markPosted` **inside the same tx** so ledger writes and the lifecycle transition commit atomically — a partial commit would leave a "processing" row with posted ledger entries; (5) `resultPublisher.publish({ status: "posted" })` OUTSIDE the lock so the optional Redis blip can't block the lock release. On any thrown error: catch all, best-effort `markFailed` + `publish({ status: "failed", failedReason })`. Both wrapped in their own try/catch so a Redis blip after a DB blip doesn't mask the root cause. Transient retries are deferred — for now, "any error = terminal failure".
- The dispatcher handles all six `MovementType` values (`deposit`, `withdrawal`, `charge`, `adjustment`, `transfer`, `hold_capture`). Lock keys: single `wallet-lock:<walletId>` for the wallet-scoped ops; both endpoints for `transfer`; for `hold_capture` the lock key is derived from a **pre-resolved** `queue_payload.walletId` so the worker never does a synchronous hold→wallet lookup on every queued message (the HTTP handler owns the cross-tenant guard before enqueueing).
- `RedisResultPublisher` wired in `wiring.ts` with a dedicated ioredis client (separate from the lock client — the lock favours fast fall-through at 500 ms while the publisher prefers to complete its SET+PUBLISH under mild network pressure at 2 s). Gate: `config.qstash` is set (signing keys → worker route mounted) AND `config.walletLock.transport === "tcp"` (Upstash REST does not support pub/sub). When absent the use case isn't registered and the worker route falls back to a 500 with a clear log so deployment misconfiguration is loud.
- `SharedInfra` gains optional `resultPublisher?: IResultPublisher`. `wallet.module.ts` instantiates `ProcessMovementUseCase` and registers `ProcessMovementCommand.TYPE → handler` only when the publisher is wired.
- Worker handler refactored: signature now takes `(commandBus, idGen, logger)`. After body validation it dispatches `ProcessMovementCommand` through the bus. Returns 200 with `{ ok, movement_id, outcome, failed_reason? }` regardless of outcome — QStash only retries on non-2xx, and terminal results must never be retried. `worker.routes.ts` passes `deps.commandBus` along. Existing Zod schema + signature middleware behaviour unchanged.
- Unit: 1089/1089 at 100% coverage. New tests: 28 hydrator cases (one per type happy + every required-field-missing/wrong-shape branch + BigInt parse + transfer self-rejection), 26 use case orchestration cases (noop, dispatch per type, posted ordering, lock-release-before-publish, hydration failure → fail, platformId null → fail, service throws → fail, markFailed throws → still publish, publisher throws → still return failed). Worker handler tests updated for the new dispatch path; 7 cases covering 500 (rawBody missing), 400 (invalid JSON / schema / oversized id / empty id), and 200 for each of `posted` / `failed` (with reason) / `noop`.
- E2E: 277/277 unchanged.

**Phase 2B.7a (completed — foundation for the handler refactor):**
- `MovementResult` gains optional `body?: Record<string, unknown>` so the worker can publish the matching service's return value alongside the terminal status. The contract is "what the sync use case would have returned" — the awaiting HTTP handler casts to its own expected shape and rebuilds the same 200 response as the sync path. Failures still carry only `failedReason`; `body` is `undefined` for failures.
- `ProcessMovementUseCase.dispatchByType` now captures each `<op>Service.execute(...)` return value and threads it back through `handle` → `resultPublisher.publish({ status: "posted", body })`. All six service result types (`DepositResult`, `WithdrawResult`, …) carry plain string IDs — no BigInt — so the loose `Record<string, unknown>` round-trips through JSON without custom serialisers.
- New top-level config flag `asyncProcessingEnabled: boolean` driven by `WALLET_ASYNC_PROCESSING_ENABLED` (strict `"true"`/`"false"` enum so a typo cannot silently disable rollout). Default `false`. Independent of `asyncPipeline` wiring on purpose — a deployment can flip the flag before the publisher env vars are set; handlers gracefully degrade at runtime.
- `wiring.ts`: pub/sub block reorganised so a single dedicated ioredis client backs both `RedisResultPublisher` (wired when QStash signing keys are present — this process can act as a worker) and `RedisResultSubscriber` (wired when `asyncProcessingEnabled=true` — this process serves HTTP handlers that may opt into the async path). Both share one client to halve the connection count; their lifecycles are independent so a sync-only producer and an async-receiving handler can co-exist on the same Wallet deployment.
- `Dependencies` gains optional `resultSubscriber?: RedisResultSubscriber` so the seven mutating HTTP handlers can `waitFor(movementId, { timeoutMs: config.asyncPipeline!.handlerWaitMs })` after dispatching `EnqueueMovementCommand`. Handlers read `config.asyncProcessingEnabled` + `config.asyncPipeline?.handlerWaitMs` for the branching decision in Phase 2B.7b.
- Unit: 1096/1096 at 100% coverage. New tests: posted-result-with-body round-trip on both publisher and subscriber; usecase asserts `publish` carries the full service body; 6 new config cases covering missing flag (default false), non-boolean value rejection, `"true"`/`"false"` parsing, and flag independence from `asyncPipeline`. E2E: 277/277 unchanged.

**Phase 2B.7b (completed — six mutating HTTP handlers refactored behind the rollout flag):**
- New `IResultSubscriber` domain port at `src/wallet/domain/ports/result.subscriber.ts` so the application layer can depend on the interface rather than the concrete `RedisResultSubscriber`. `RedisResultSubscriber implements IResultSubscriber`; the shared `ResultSubscriberOptions` moved to the port file too. `Dependencies.resultSubscriber` now typed as `IResultSubscriber` for testability.
- New `asyncDispatch` helper at `src/wallet/application/worker/asyncDispatch.ts`. Given `(ctx, commandBus, resultSubscriber, handlerWaitMs, { type, platformId, idempotencyKey, queuePayload, reason? })` it: dispatches `EnqueueMovementCommand`, calls `resultSubscriber.waitFor(movementId, { timeoutMs })`, and returns a discriminated union — `{ kind: "completed", body }`, `{ kind: "failed", failedReason }`, or `{ kind: "pending" }`. Defensive fallbacks: a posted result with no `body` surfaces as `{}` (never crashes), a failed result with no reason surfaces as `"unknown"`. Bus errors propagate so a wiring bug surfaces as 500 via the global onError rather than being silently swallowed.
- New shared `MutationHandlerDeps` type + `buildMutationDeps(deps)` projector at `src/wallet/infrastructure/adapters/inbound/http/types.ts`. The projector populates `asyncDispatch` only when BOTH `resultSubscriber` is wired AND `config.asyncPipeline` is set — either missing → handler stays on the sync path even when the operator flipped the rollout flag before the publisher env vars landed.
- Six mutating handlers refactored (`deposit`, `withdraw`, `charge`, `adjustBalance`, `transfer`, `captureHold`). Each:
  - Reads operation-specific request data, derives `idempotencyKey`, `systemWalletShardCount`, and (for adjustBalance) `allowNegativeBalance` from context.
  - If `deps.asyncDispatch` is present: serialises the command fields into `queue_payload` (BigInt → string via `String(data.amount_minor)`, with conditional spreads for optional `reference`/`metadata` so missing keys aren't sent as `undefined`), calls `asyncDispatch<TResult>(...)`, then maps the outcome: `completed` → 201 with the same body shape as the sync path (cast from `TResult`); `pending` → 202 `{ movement_id, status: "pending" }`; `failed` → `throw AppError.domainRule("MOVEMENT_FAILED", failedReason)` so the global onError maps it to 422.
  - Otherwise: today's inline `commandBus.dispatch(...)` unchanged.
- `captureHold` async path additionally calls `queryBus.dispatch(new GetHoldQuery(holdId, ctx.platformId))` BEFORE enqueueing. The query is platform-scoped, so the cross-tenant pre-lock guard the sync use case enforces happens at the handler boundary instead — a known hold id from another platform collapses to 404 without ever publishing to QStash. The resolved `wallet_id` flows into `queue_payload.walletId` so the worker's hydrator never re-queries.
- Routes (`wallets.routes.ts`, `transfers.routes.ts`, `holds.routes.ts`) call `buildMutationDeps(deps)` once and pass the same projection to every async-aware handler.
- Failed-outcome behaviour difference: when the worker terminally fails, the original `AppError` kind/code is lost across the queue boundary. The handler returns 422 `MOVEMENT_FAILED` with the worker's `failedReason` as the message regardless of whether the sync path would have returned 404 (wallet not found), 422 (insufficient funds), or another mapped status. Clients fetch `GET /v1/movements/{id}` for the canonical state. A future iteration may extend the published `MovementResult` to carry full error fidelity (`failedKind`, `failedCode`) so the handler can rebuild the original AppError.
- Unit: 1127/1127 at 100% coverage. New tests: 9 cases on `asyncDispatch` (completed/posted-body, completed-without-body, failed/with reason, failed-without reason, pending, bus throws, command construction with/without `reason`, waitFor receives correct timeoutMs), 3 cases on `buildMutationDeps`, ~12 cases across the six handler routes covering completed/pending/failed branches and the captureHold pre-resolve happy + failure paths. Existing sync-path handler tests updated to pass `MutationHandlerDeps` instead of `ICommandBus`.
- E2E: 277/277 unchanged. The async-path E2E (forging a signed worker delivery inside the harness) is deferred — it requires building a QStash JWT in test code, which is non-trivial; the helper + handler logic are covered exhaustively at the unit level for now.

**Phase 3+ (next):**
1. E2E coverage for the async path — at minimum happy + claim-race + timeout-to-202 cases. Requires forging an Upstash-Signature JWT inside the harness against the dev keys.
2. Per-platform rollout mechanism. Today's `WALLET_ASYNC_PROCESSING_ENABLED` is a global flag; we likely want a `platforms.async_processing_enabled boolean` column (or a percentage knob) so async can be rolled out tenant-by-tenant.
3. Transient-error retries in `ProcessMovementUseCase`. Today any error marks the movement `failed`; a future iteration can distinguish transient (Prisma write conflict, Redis blip) from terminal (domain error) and let QStash retry up to N times before giving up.
4. Reconciliation job for `pending` movements whose QStash publish failed. Today those rows stay as known orphans; a periodic sweep can republish or transition them to `failed`.
5. Full error fidelity across the queue boundary — extend `MovementResult` with `failedKind`/`failedCode` so the handler can rebuild the original AppError and the async path returns the same HTTP status as the sync path on domain rejections.

**Phase 2 (after Phase 1 lands):** `EnqueueMovementUseCase` (handler-side: validate → insert pending movement → publish to QStash → wait on Redis pub/sub up to `WALLET_HANDLER_WAIT_MS`, return 200 or 202), `ProcessMovementUseCase` (worker-side: claim pending → dispatch existing use case command → publish result), and the QStash/Redis adapters. Behind `WALLET_ASYNC_PROCESSING_ENABLED`. The lock and transaction layers stay exactly as they are today — the use case bodies move from inline-in-handler to inline-in-worker, nothing else.

---

## Previously Landed

**System wallet sharding.** The system wallet is no longer a single hot row per `(platform, currency)`. It is physically fanned out across N shards (default 32, configurable per platform via `platforms.system_wallet_shard_count`, only-increase). Every movement routes to a shard via a deterministic FNV-1a hash of the user wallet id and writes with a single `UPDATE … RETURNING` (atomic increment, no read-then-write). This closes the residual hot-row surface left behind by the distributed lock, which serialized user wallets only.

**Sharding feature (completed):**
- `wallets.shard_index` (int, NOT NULL, default 0, CHECK >= 0) + unique `(owner_id, platform_id, currency_code, shard_index)`. User wallets keep 0; system wallets span `0..count-1`.
- `platforms.system_wallet_shard_count` (int, default 32, 1..1024, only-increase enforced at the domain boundary by `Platform.setSystemWalletShardCount`).
- `src/utils/kernel/shard.ts` — pure FNV-1a hash, zero deps.
- `IWalletRepository` port rewritten: `findSystemWallet` / `adjustSystemWalletBalance` gone; replaced by `adjustSystemShardBalance`, `findSystemShard`, `ensureSystemWalletShards`, `sumSystemWalletBalance`, `listSystemWalletCurrencies`.
- All 6 financial mutation use cases route the system side via the hash; `adjustSystemShardBalance` runs `UPDATE wallets SET cached_balance_minor = cached_balance_minor + $delta, updated_at = $now … RETURNING id, cached_balance_minor`, so the shard read happens in the same statement as the write and no longer creates a read/write dependency that `SERIALIZABLE` aborts.
- `CreateWalletUseCase.handle` calls `ensureSystemWalletShards` **outside** the SERIALIZABLE tx; inside the tx we only check for duplicate owner and save the user wallet. Materialising shards inside the tx caused aborts under concurrent createWallet bursts for the same `(platform, currency)`.
- `UpdatePlatformConfigUseCase` accepts an optional `systemWalletShardCount`. When it grows, the use case lists every currency in use for the platform and ensures the expanded shard set for each (idempotent via `skipDuplicates`).
- `ReadStore`s filter `is_system = false` for the public wallet listing; shards never leak into `/v1/wallets`.
- Immutable-ledger trigger (`prevent_wallet_field_tampering`) now also blocks `UPDATE` on `shard_index`.
- TransactionManager's `isRetryable` extended to match Prisma 7's `TransactionWriteConflict` class and messages ("TransactionWriteConflict", "write conflict", "could not serialize access", code "P2034"). Previously these leaked as 500 under heavy cross-wallet load instead of being retried or wrapped as 409 VERSION_CONFLICT.
- Load test [tests/e2e/wallet/system-wallet-sharding.e2e.test.ts](../tests/e2e/wallet/system-wallet-sharding.e2e.test.ts): 150 wallets × 4 concurrent deposits each (600 ops) clears `>95%` success with zero 500s; remaining non-201s are 409 VERSION_CONFLICTs, retryable by the client with the same `Idempotency-Key`.
- Full 100% unit coverage maintained (834 tests); 258 E2E tests pass.

**Distributed lock feature (already landed):** The service has a Redis-backed per-resource serialization layer that wraps all 12 mutating use cases. Under concurrent same-wallet writes, requests queue on a Redis mutex instead of racing on the DB version, eliminating the 409 VERSION_CONFLICT storm on user wallets. Optimistic locking remains as the safety net.

**Lock feature (completed):**
- Port `IDistributedLock` + app-level `LockRunner` + `RedisDistributedLock` adapter (ioredis, SET NX PX + token-aware Lua release).
- Wired into all 12 mutating use cases (`deposit`, `withdraw`, `transfer`, `charge`, `adjustBalance`, `placeHold`, `captureHold`, `voidHold`, `freeze`, `unfreeze`, `close`, `importHistoricalEntry`). Transfer locks both wallets (sort + dedupe → no A↔B deadlock).
- Feature-toggled via `WALLET_LOCK_ENABLED` + `REDIS_URL`. Graceful fallthrough when Redis is unreachable; falls through silently on `Command timed out` during contention (transient reclassification) to preserve the serialization guarantee.
- Pre-lock platform validation in `captureHold`/`voidHold` to prevent cross-tenant DoS via known holdId.
- OpenAPI: 409 `LOCK_CONTENDED`/`VERSION_CONFLICT` declared on all mutation endpoints.
- Observability: seven per-request canonical metrics (`lock.attempts`, `lock.transient_errors`, `lock.token_mismatch`, `lock.acquired`, `lock.contended`, `lock.fallthrough`, `lock.duration_ms`) + structured logs at debug/info/warn + Redis connection lifecycle events hooked in wiring.
- Full 100% coverage maintained. New E2E tests in `wallet-lock.e2e.test.ts` (50/100 concurrent deposits, cross-wallet parallelism, mixed deposit/withdraw/adjust, forced contention via external Redis holder).
- Docs updated: see `systemPatterns.md` § "Distributed Lock" for the canonical usage guide.

The residual hot-row surface called out when the lock shipped is now closed by sharding (see above). `adjustSystemWalletBalance` is gone; every mutation writes through one of N `adjustSystemShardBalance` rows.

---

**Previous focus — `allow_negative_balance` per-platform feature (completed):** Platforms can configure their own instance to permit administrative adjustments (`POST /v1/wallets/:id/adjust`) that push wallet balances below zero — enabling dispute resolution, chargeback, and penalty fee workflows. The `PATCH /v1/platforms/config` endpoint allows platforms to toggle this flag using their own API key.

**allow_negative_balance feature (completed):**
- `Platform` aggregate: `allowNegativeBalance` field, getter, `setAllowNegativeBalance()` method
- Prisma schema: `allow_negative_balance BOOLEAN DEFAULT false` on `platforms` table
- DB constraint replaced: `wallets_positive_balance` CHECK removed; replaced by `trg_enforce_positive_balance` BEFORE INSERT OR UPDATE trigger that queries `platforms.allow_negative_balance` at runtime
- `apiKeyAuth` middleware: propagates `allowNegativeBalance` flag into `HonoVariables` (HTTP layer only, not AppContext)
- `AdjustBalanceCommand`: carries `allowNegativeBalance: boolean` through application layer
- `wallet.adjust()`: accepts `allowNegativeBalance` param; skips INSUFFICIENT_FUNDS guard when flag is true (system wallets always bypass)
- `wallet.readstore.ts`: removed available balance clamp (`max(0)`) — negative values now surfaced correctly in API
- `UpdatePlatformConfig`: full CQRS slice (command + usecase + handler + schemas + route) at `PATCH /v1/platforms/config`
- `ImportHistoricalEntry` use case: computes real available balance via `holdRepo.sumActiveHolds()` for negative adjustments — prevents zombie holds (a hold whose capture becomes permanently impossible because `cached < holdAmount` after import). Negative balance bypass is implicit: the domain's `adjust()` receives `allowNegativeBalance=true` so historical imports can push below zero, but the available-balance check still gates whether present-day holds would be broken.
- 221 E2E tests passing (including new `negative-balance.e2e.test.ts` and `config.e2e.test.ts`)
- `src/index.ts` DB safety net check updated: validates `trg_enforce_positive_balance` trigger; removed `wallets_positive_balance` constraint check

**Previously completed:**
- Hono app with middleware chain (trackingCanonical → cors → secureHeaders → requestResponseLog global; apiKeyAuth → idempotency per route group)
- Utils infrastructure: AppError, IIDGenerator (UUID v7), Logger chain (Pino -> SensitiveKeysFilter -> SafeLogger)
- CQRS bus: ICommandBus/IQueryBus interfaces (`utils/application/cqrs.ts`) and implementations (`utils/infrastructure/cqrs.ts`) with middleware pipeline
- Prisma schema with all models (Platform, Wallet, Transaction, LedgerEntry, Hold, Movement, IdempotencyRecord)
- Immutable ledger SQL (trigger + constraints)
- Wallet BC: all command use cases (createWallet, deposit, withdraw, transfer, placeHold, captureHold, voidHold, freeze, unfreeze, close, expireHolds)
- Wallet BC: all query use cases (getWallet, getTransactions, getLedgerEntries)
- Movement entity for true double-entry ledger grouping (entries per movement sum to zero)
- Scheduled jobs as inbound adapters: hold expiration (`wallet/infrastructure/adapters/inbound/scheduler/`) and idempotency cleanup (`common/idempotency/infrastructure/adapters/inbound/scheduler/`) dispatch commands via CommandBus
- Concurrency hardening: PlaceHold + VoidHold participate in optimistic locking
- TransactionManager: Serializable isolation + internal retry (3 attempts, exponential backoff) before escalating VERSION_CONFLICT to client
- CaptureHold validates real wallet balance
- Idempotency: transient error release, payload mismatch (SHA-256 of method:path:body), endpoint scoping
- Docker Compose (PostgreSQL 16 for local dev), Dockerfile
- pnpm scripts for all workflows: `start:local`, `reset:local`, `db:update`, `dev`
- Full documentation set + concurrency audit
- AI agent instructions unified around `AGENTS.md`; `CLAUDE.md` imports it and the dedicated Cursor rule was removed to avoid duplicated guidance
- Auto-generated OpenAPI 3.1 spec (hono-openapi) + interactive Scalar UI at `/docs`
- All 13 endpoints documented with `describeRoute()` (tags, summary, response schemas)
- Dedicated e2e coverage for balance adjustments endpoint (`POST /v1/wallets/:walletId/adjust`) across auth, validation, idempotency, cross-tenant, concurrency, and ledger integrity scenarios
- Multi-currency support: explicit currency catalog (USD, EUR, MXN, CLP, KWD) with `wallets_supported_currency` CHECK constraint
- Renamed all `_cents` fields to `_minor` across domain, application, infrastructure, and API layers to accurately reflect multi-currency minor unit semantics
- Endpoint `schemas.ts` pattern: request + response Zod schemas per endpoint
- Shared `ErrorResponseSchema` in `utils/infrastructure/hono.error.ts`
- Reusable listing system: Stripe-style flat filters (`filter[field][op]=value`), dynamic multi-field sorting (`sort=-field`), keyset cursor pagination with sort signature validation
- Listing modules: `utils/kernel/listing.ts` (domain types + cursor), `utils/infrastructure/listing.zod.ts` (Zod schema factory), `utils/infrastructure/listing.prisma.ts` (Prisma query builder)
- Composite indexes for filter+sort patterns on Transaction and LedgerEntry
- Architecture refactoring: `shared/` → `utils/` (toolkit) + `common/` (cross-cutting features)
- Route files colocated with BC: `wallet/infrastructure/adapters/inbound/http/wallets.routes.ts`, `transfers.routes.ts`, `holds.routes.ts`
- Read store interfaces extracted to `wallet/application/ports/` (wallet.readstore.ts, transaction.readstore.ts, ledgerEntry.readstore.ts)
- Command/query handler files renamed from `handler.ts` to `usecase.ts`
- HTTP handlers receive `commandBus`/`queryBus` instead of individual handler instances
- Handler dispatch uses static TYPE for bus dispatch instead of constructor.name

## Temporary: Historical Import Endpoint

> **TODO(historical-import-temp)**: Remove this entire feature once all legacy consumers have completed their one-off backfill of pre-Wallet history.

`POST /v1/wallets/:walletId/import-historical-entry` creates a Transaction + Movement + paired LedgerEntries with a caller-supplied `historical_created_at` in the past, so a legacy system's journal can be replayed into the Wallet ledger preserving the original event times and human references. Semantics match `POST /:walletId/adjust` (same signed `amount_minor`, same system-wallet counterpart, same idempotency contract) — the only difference is that all journal entities get the historical timestamp instead of `Date.now()`.

- **Gate**: the endpoint is mounted behind a middleware that returns `404 NOT_FOUND` unless `HISTORICAL_IMPORT_ENABLED=true` is set on the app process. Default is off.
- **Validation**: `historical_created_at` must be a positive integer (Unix ms) strictly in the past; `reference` is required (unlike regular `adjust` where it is optional) so the imported history carries a user-facing description end-to-end.
- **Removal**: grep for `TODO(historical-import-temp)` to list every file and line that needs deleting. The marker is consistent across command, use case, handler, schemas, route registration, middleware, module wiring, tests, and docker-compose env vars.

## Next Steps

1. **Platform BC**: Complete remaining platform management features (suspend, revoke, API key rotation) — `UpdatePlatformConfig` CQRS slice already done
2. **Production hardening**: Body size limit, status CHECK constraints, rate limiting, graceful shutdown
3. **Wallet lookup by owner**: `GET /v1/wallets?owner_id=...&currency_code=...` endpoint for platform integration
4. **Metadata on mutations**: Accept optional JSON metadata on deposit/withdraw/transfer/adjust
5. **Deploy**: Production configuration (managed PostgreSQL + Node.js process)
6. **Integration tests**

## Active Decisions

- **allow_negative_balance**: Per-platform flag. Flows through HonoVariables → AdjustBalanceCommand (not through AppContext, which is cross-cutting infra context only). DB enforcement via trigger (not CHECK) because triggers can reference other tables at runtime. Available balance no longer clamped to 0 in readstore. Withdraw, transfer, and holds are unaffected by the flag.

- **Amounts**: Integer in smallest currency unit per ISO 4217 (BigInt) — `_minor` suffix is convention
- **Concurrency**: Two layers. Outer = `LockRunner` per-resource Redis mutex wrapping the `txManager.run(...)` of every mutating use case (feature-toggled; falls through if Redis is absent or down). Inner = optimistic locking (version field) on all wallet mutations including PlaceHold/VoidHold. No SELECT FOR UPDATE in domain. See systemPatterns.md § "Distributed Lock" and § "Why optimistic locking…".
- **Ledger**: Double-entry via Movement entity, append-only, protected by PostgreSQL trigger. Audit invariant: `SUM(amount_minor) GROUP BY movement_id = 0`
- **Auth**: API key per platform (not user JWT)
- **DI**: Manual wiring (no DI container). All deps instantiated in `wiring.ts`, registered on CommandBus/QueryBus
- **Transactions**: Serializable isolation level; TransactionManager retries internally (3 attempts, exponential backoff 30/60/120ms) for VERSION_CONFLICT and PostgreSQL serialization failures before escalating to client
- **Hold expiration**: Two layers — query filter (`expires_at > now`) for immediate correctness + scheduled job (inbound adapter) dispatching command via bus for DB hygiene
- **CQRS dispatch**: Commands/queries dispatched via bus with middleware pipeline. Handlers registered using static TYPE field (not constructor.name)
- **Architecture split**: `utils/` = pure toolkit (no use cases), `common/` = cross-cutting features with full architecture (ports, adapters, use cases)
