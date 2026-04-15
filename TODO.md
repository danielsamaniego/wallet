# Wallet Service — TODO

Pendientes priorizados de la auditoría de seguridad y revisión de código.
Referencia completa: [AUDIT_REPORT.md](AUDIT_REPORT.md)

---

## Pre-producción — No bloquean desarrollo

### Rate limiting

**Fuente:** HARDENING-1 + R1
**Riesgo:** Sin límite de requests, un atacante puede hacer brute-force de API keys, saturar la DB, o llenar la tabla de idempotency records.

**Plan:**
- Middleware por `platformId` (post-auth) con buckets diferenciados: más permisivo para reads (GET), más restrictivo para mutations (POST).
- Considerar rate limit por IP pre-auth para proteger contra brute-force de API keys.
- Store en memoria (para desarrollo/una réplica) o Redis (para multi-instancia).

**Esfuerzo:** 4-8h

---

### Graceful shutdown

**Fuente:** DISEÑO-5 (parcial) + AUDIT_REPORT
**Riesgo:** SIGTERM sin cleanup deja intervals corriendo y conexiones de DB huérfanas en redeployments.

**Plan:**
```typescript
const intervals: NodeJS.Timeout[] = [];
// ... push intervals from startExpireHoldsJob, startCleanupIdempotencyJob ...

process.on('SIGTERM', async () => {
  intervals.forEach(clearInterval);
  await prisma.$disconnect();
  process.exit(0);
});
```

**Esfuerzo:** 1h

---

### Idempotency recovery via UNIQUE constraint

**Fuente:** DISEÑO-2
**Riesgo:** Si el proceso crashea entre el commit de la operación y el `complete()` del idempotency record, el cliente recibe 500 en el retry en vez de la respuesta idempotente.
**Mitigación existente:** `Transaction.idempotencyKey` UNIQUE constraint previene double-spend. Pero el error no se maneja — el cliente ve 500.

**Plan (diseñado y prototipado, pendiente de implementar):**
- **Capa 1 — Adapter:** `transaction.repo.ts` atrapa P2002 → lanza `ErrIdempotencyKeyAlreadyUsed` (domain error).
- **Capa 2 — Use case:** Handlers catch `IDEMPOTENCY_KEY_ALREADY_USED` → buscan Transaction existente via `findByIdempotencyKey` → devuelven resultado. Transfers recuperan ambos lados via `findByMovementId`.
- **Capa 3 — Middleware:** Records pending >5 min se liberan (stale cleanup). `release()`/`complete()` con 1 retry.

**Archivos:**
| Archivo | Cambio |
|---------|--------|
| `domain/transaction/transaction.errors.ts` | Nuevo: `ErrIdempotencyKeyAlreadyUsed` |
| `wallet/infrastructure/adapters/outbound/prisma/errors.ts` | Nuevo: `isUniqueViolation()` helper |
| `wallet/infrastructure/adapters/outbound/prisma/transaction.repo.ts` | Catch P2002 → domain error; `findByIdempotencyKey`, `findByMovementId` |
| `domain/ports/transaction.repository.ts` | Agregar queries al port |
| 4 command handlers | try/catch recovery via `AppError.code` |
| `utils/middleware/idempotency.ts` | Stale pending recovery; retry en release/complete |

**Esfuerzo:** 4-6h

---

## Operacional — Nice to have

### Advisory locks en background jobs

**Fuente:** DISEÑO-5
**Riesgo:** Con N réplicas, N instancias ejecutan los mismos jobs simultáneamente. Trabajo redundante y posibles race conditions.

**Plan:**
- `pg_try_advisory_lock(lockId)` antes de cada job run.
- Si otra instancia tiene el lock, skip.
- Lock IDs: 1001 para `expireHolds`, 1002 para `cleanupIdempotency`.

**Esfuerzo:** 2-4h

---

### Job de reconciliación

**Fuente:** HARDENING-7
**Riesgo:** Si `cached_balance_minor` diverge del ledger por un bug, no hay forma de detectarlo automáticamente.

**Plan:** Job periódico que ejecute:
```sql
SELECT w.id, w.cached_balance_minor, COALESCE(SUM(le.amount_minor), 0) as ledger_balance
FROM wallets w LEFT JOIN ledger_entries le ON le.wallet_id = w.id
GROUP BY w.id
HAVING w.cached_balance_minor != COALESCE(SUM(le.amount_minor), 0);
```
Si hay discrepancias, loguear como error crítico (alertable).

**Esfuerzo:** 4h

---

### Sanitización de campos de texto

**Fuente:** R4
**Riesgo:** `reference` almacena strings sin sanitizar (ej: `<script>alert(1)</script>`). Como API JSON, no es un riesgo directo de XSS — pero un frontend que renderice el valor sin escapar sería vulnerable.

**Plan:** Documentar en la API que `reference` se devuelve tal cual y el consumidor debe escaparlo para HTML. Opcionalmente, strip HTML tags en input con una regex simple.

**Esfuerzo:** 30 min (documentar) / 1h (sanitizar)

---

### Partial capture de holds

**Fuente:** HARDENING-6
**Riesgo:** Feature gap — un hold solo se puede capturar por el monto completo. Stripe/Adyen permiten capturas parciales.

**Plan:** Agregar `amount_minor` opcional al capture command. Si presente, capturar ese monto y liberar la diferencia.

**Esfuerzo:** 4-8h

---

### Audit trail para eventos no-financieros

**Fuente:** HARDENING-8
**Riesgo:** Freeze/unfreeze, autenticación fallida, cambios de status — solo quedan en logs efímeros.

**Plan:** Tabla `audit_events` con `event_type`, `actor_id`, `resource_id`, `metadata`, `created_at`.

**Esfuerzo:** 8-12h

---

## Completados

- BUG-1, DISEÑO-1, DISEÑO-3, DISEÑO-4, HARDENING-2, HARDENING-3, HARDENING-5
- Server-side retry for VERSION_CONFLICT (3 attempts + exponential backoff)
- Body size limit (`bodyLimit({ maxSize: 64 * 1024 })` con 413 `PAYLOAD_TOO_LARGE`)
- Status CHECK constraints (wallets/holds/transactions/ledger_entries en `immutable_ledger.sql` + verificación al arrancar)
- Idempotency keys aisladas por platform (UNIQUE compuesto `(idempotencyKey, platformId)` + store filtra por platform)
- Paginación con cap `Math.min(limit, 100)` en getTransactions y getLedgerEntries
