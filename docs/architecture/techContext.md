# Technical Context — Wallet Service

## Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js |
| Framework | Hono |
| Language | TypeScript |
| Database | PostgreSQL 16 |
| ORM | Prisma |
| Validation | Zod |
| Logging | Pino |
| ID generation | uuidv7 (UUID v7, RFC 9562) |
| Testing | Vitest |
| Linting / formatting | Biome |
| Package manager | pnpm |
| Orchestration | Docker Compose |

## Docker Compose

PostgreSQL runs in Docker Compose for local development. The service connects via `DATABASE_URL`.

- **PostgreSQL**: Port 5432

## Deployment

- **Vercel**: Node.js serverless functions
- **Cloudflare Workers**: Via Prisma Accelerate (edge-compatible Prisma)

## Directories

| Path | Description |
|------|-------------|
| `src/` | Application source |
| `src/api/` | HTTP composition, middleware, respond helpers |
| `src/wallet/` | Wallet bounded context (domain, app, adapters, ports) |
| `src/platform/` | Platform bounded context (API key management) |
| `src/shared/` | Cross-cutting: appError, kernel, observability |
| `prisma/` | Schema, migrations, immutable ledger SQL |
| `docs/` | Domain, data model, architecture docs |

## Environment

- `DATABASE_URL`: PostgreSQL connection string
- `HTTP_PORT`: Server port (default 3000)
- Credentials via environment variables (never hardcode)

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
