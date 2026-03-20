# Technical Context — Wallet Service

## Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ |
| Framework | Hono |
| Language | TypeScript 5+ (strict) |
| Database | PostgreSQL 16 |
| ORM | Prisma 7 |
| Validation | Zod |
| API docs | hono-openapi + @scalar/hono-api-reference (auto-generated OpenAPI 3.1) |
| Logging | Pino (structured JSON) |
| ID generation | uuidv7 (UUID v7, RFC 9562) |
| Testing | Vitest |
| Linting / formatting | Biome |
| Package manager | pnpm |
| Local DB | Docker Compose (PostgreSQL container) |

## Local Development

Docker Compose runs PostgreSQL for local development. The app itself runs natively via `tsx`.

```bash
pnpm start:local      # First time: docker up → wait → schema → constraints → seed
pnpm reset:local      # Nuclear reset: docker down -v → start:local
pnpm db:update        # Schema/constraint changes only (preserves data)
pnpm dev              # Dev server with hot reload
```

See `README.md` for full script reference.

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
| `src/api/` | HTTP composition, middleware, respond helpers |
| `src/wallet/` | Wallet bounded context (domain, app, adapters, ports) |
| `src/platform/` | Platform bounded context (API key management) |
| `src/shared/` | Cross-cutting: appError, kernel, observability |
| `prisma/` | Schema, config, migrations, immutable ledger SQL |
| `docs/` | Domain, data model, architecture docs |

## Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://wallet:wallet@localhost:5432/wallet` |
| `HTTP_PORT` | Server port | `3000` |
| `LOG_LEVEL` | Pino log level | `info` |

Credentials via environment variables — never hardcode.

## Constraints

- **Domain and app**: No external third-party libraries. Depend only on interfaces (ports) and shared packages. Third-party libs live in adapters.
- **Entity IDs**: UUID v7 only (RFC 9562); generated in application via `IDGenerator`. Database never generates IDs.
- **Timestamps**: Unix milliseconds (number) everywhere.
- **Amounts**: Integer cents (BigInt); no floats.
- **API**: REST; idempotency keys required for mutations.

## References

- [backend-architecture.md](backend-architecture.md) — Backend structure
- [systemPatterns.md](systemPatterns.md) — Architecture patterns
- [database-migrations.md](database-migrations.md) — Prisma migrations
