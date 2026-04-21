# Technical Context — Wallet Service

## Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ |
| Framework | Hono |
| Language | TypeScript 5+ (strict) |
| Database | PostgreSQL 16 |
| ORM | Prisma 7 (via `@prisma/adapter-pg` + `pg` driver) |
| Validation | Zod |
| API docs | hono-openapi + @scalar/hono-api-reference (auto-generated OpenAPI 3.1) |
| Logging | Pino (structured JSON) |
| ID generation | uuidv7 (UUID v7, RFC 9562) |
| Testing | Vitest |
| Linting / formatting | Biome |
| Package manager | pnpm |
| Local DB | Docker Compose (PostgreSQL container) |
| Distributed lock | Redis 7 + ioredis (**optional**; per-wallet write serialization — `redis://` local or `rediss://` managed such as Upstash). See systemPatterns.md § "Distributed Lock". |

## Local Development

Docker Compose runs PostgreSQL for local development. The app itself runs natively via `tsx`.

```bash
pnpm start:local      # First time: docker up → wait → schema → constraints → seed
pnpm reset:local      # Nuclear reset: docker down -v → start:local
pnpm db:update        # Schema/constraint changes only (preserves data)
pnpm dev              # Dev server with hot reload
```

See the root `README.md` for full script reference.

## Database Connection

Prisma connects via the **Prisma Postgres adapter** (`@prisma/adapter-pg` + `pg` driver). In `wiring.ts`:

```typescript
const adapter = new PrismaPg({ connectionString: config.databaseUrl });
const prisma = new PrismaClient({ adapter });
```

This uses the native `pg` driver instead of Prisma's built-in connection, enabling more control over the connection pool and compatibility with managed PostgreSQL providers.

## Production

Production runs as a **plain Node.js process** against a managed PostgreSQL instance (Neon, Supabase, AWS RDS, etc.). No Docker.

```bash
pnpm install --frozen-lockfile
pnpm db:generate
prisma migrate deploy --config prisma/prisma.config.ts
psql $DATABASE_URL -f prisma/immutable_ledger.sql
pnpm build
pnpm start            # node dist/index.js
```

Rules:
- Never `db:push` in production — use `prisma migrate deploy`
- Never auto-migrate at app startup
- Never run seed in production
- Apply `immutable_ledger.sql` after migrations touching constrained tables

## Directories

| Path | Description |
|------|-------------|
| `src/` | Application source |
| `src/common/` | Cross-cutting features with full architecture (NOT a BC). Currently: idempotency (cleanup job, store port, Prisma adapter). |
| `src/utils/` | Pure toolkit — reusable utilities, NOT features. Contains kernel (domain-safe abstractions), application interfaces (CQRS bus, IIDGenerator, ITransactionManager), infrastructure implementations, HTTP middlewares. |
| `src/utils/kernel/` | Domain-safe abstractions (NO infra deps). Equivalent to domain+application pragmatically. AppError, AppContext, BigInt utils, listing types, ILogger port. |
| `src/utils/middleware/` | All HTTP middlewares: apiKeyAuth, idempotency, requestResponseLog, trackingCanonical. |
| `src/wallet/` | Wallet bounded context (domain, application, infrastructure adapters) |
| `src/wallet/infrastructure/adapters/inbound/http/` | HTTP route files + per-endpoint handler/schemas folders |
| `src/wallet/infrastructure/adapters/inbound/scheduler/` | Wallet-specific scheduled jobs (expireHolds) |
| `src/wallet/infrastructure/adapters/outbound/prisma/` | Prisma repository and read store implementations |
| `prisma/` | Schema, config, migrations, immutable ledger SQL |
| `docs/` | Domain, data model, architecture docs |

**Note:** `src/platform/` is planned for the Platform bounded context (API key management) but is not yet implemented.

## Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://wallet:wallet@localhost:5432/wallet` |
| `DIRECT_URL` | Prisma direct connection (bypasses pooler; used by migrations). Falls back to `DATABASE_URL`. | unset |
| `HTTP_PORT` | Server port | `3000` |
| `LOG_LEVEL` | Pino log level | `info` |
| `CRON_SECRET` | Shared secret for Vercel Cron auth. Empty string disables check. | `""` |
| `WALLET_LOCK_ENABLED` | Feature toggle for the per-wallet distributed lock. `true`/`false`. | `false` |
| `REDIS_URL` | Redis connection (`redis://host:port` or `rediss://default:TOKEN@host:port`). Required when the lock is enabled; when absent with `WALLET_LOCK_ENABLED=true`, the lock is effectively disabled and a `console.warn` is emitted at boot. | unset |
| `WALLET_LOCK_TTL_MS` | Lock auto-expiry if a holder crashes. Must exceed the longest critical section. | `10000` |
| `WALLET_LOCK_WAIT_MS` | How long a waiter blocks before rejecting with `LOCK_CONTENDED`. Must be below the HTTP request timeout. | `5000` |
| `WALLET_LOCK_RETRY_MS` | Polling interval between `SET NX` attempts while waiting. | `50` |

Credentials via environment variables — never hardcode.

**Lock tuning guidance**: see [systemPatterns.md § Distributed Lock](systemPatterns.md#distributed-lock-per-resource-serialization) for the full contract, fallthrough behavior, and the seven per-request canonical metrics emitted.

## Constraints

- **Domain and app**: No external third-party libraries. Depend only on interfaces (ports) and `utils/kernel/`. Third-party libs live in adapters.
- **Entity IDs**: UUID v7 only (RFC 9562); generated in application via `IIDGenerator`. Database never generates IDs.
- **Timestamps**: Unix milliseconds (number) everywhere.
- **Amounts**: Integer minor units (BigInt); no floats. Supported currencies: USD, EUR, MXN, CLP, KWD.
- **API**: REST; idempotency keys required for mutations.

## References

- [backend-architecture.md](backend-architecture.md) — Backend structure
- [systemPatterns.md](systemPatterns.md) — Architecture patterns
- [database-migrations.md](database-migrations.md) — Prisma migrations
