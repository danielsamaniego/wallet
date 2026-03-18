# Wallet Service — Makefile
# Run from project root.

# Docker Compose
.PHONY: up down logs build rebuild
up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

build:
	docker compose build

rebuild:
	docker compose build --no-cache

# Development
.PHONY: dev test test-watch lint lint-fix fmt
dev:
	pnpm dev

test:
	pnpm test

test-watch:
	pnpm test:watch

lint:
	pnpm lint

lint-fix:
	pnpm lint:fix

fmt:
	pnpm fmt

# Database (Prisma)
.PHONY: db-generate db-migrate db-push db-studio db-reset
db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-push:
	pnpm db:push

db-studio:
	pnpm db:studio

db-reset:
	npx prisma migrate reset

# Utilities
.PHONY: clean install
clean:
	rm -rf dist node_modules

install:
	pnpm install
