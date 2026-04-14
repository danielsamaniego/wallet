#!/usr/bin/env bash
# Starts the full dev environment in Docker (PostgreSQL + App with hot reload).
# Usage: pnpm dev:docker
set -euo pipefail

COMPOSE_FILE="docker-compose.dev.yml"

echo "🐳 Starting PostgreSQL..."
docker compose -f "$COMPOSE_FILE" up -d postgres
docker compose -f "$COMPOSE_FILE" exec postgres sh -c 'until pg_isready -U wallet -d wallet; do sleep 1; done' > /dev/null 2>&1

echo "📦 Syncing database schema..."
DATABASE_URL="postgresql://wallet:wallet@localhost:5432/wallet" \
  npx prisma db push --config prisma/prisma.config.ts --accept-data-loss 2>&1 | tail -1

echo "🔒 Applying immutable ledger constraints..."
cat prisma/immutable_ledger.sql | docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U wallet -d wallet > /dev/null 2>&1

echo "🌱 Seeding test data..."
DATABASE_URL="postgresql://wallet:wallet@localhost:5432/wallet" \
  pnpm db:seed 2>&1 | grep -E "API Key|Platform" || true

echo "🚀 Starting App with hot reload..."
docker compose -f "$COMPOSE_FILE" up -d --build app

echo ""
echo "✅ Dev environment ready!"
echo "   App:     http://localhost:3000"
echo "   Health:  http://localhost:3000/health"
echo "   Docs:    http://localhost:3000/docs"
echo "   DB:      postgresql://wallet:wallet@localhost:5432/wallet"
echo ""
echo "   Logs:    docker compose -f $COMPOSE_FILE logs -f app"
echo "   Stop:    pnpm dev:docker:down"
