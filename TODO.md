# Wallet Service — TODO

Pendientes priorizados de la auditoría de seguridad y revisión de código.
Referencia completa: [AUDIT_REPORT.md](AUDIT_REPORT.md)

---

## Prioridad ALTA — Bloquean producción con tráfico real

### 1. Rate limiting

**Fuente:** HARDENING-1 + R1
**Riesgo:** Sin límite de requests, un atacante puede hacer brute-force de API keys, saturar la DB con operaciones, o llenar la tabla de idempotency records.
**Evidencia:** 50 requests en 207ms sin throttling.

**Plan:**
- Middleware por `platformId` (post-auth) con buckets diferenciados: más permisivo para reads (GET), más restrictivo para mutations (POST).
- Considerar rate limit por IP pre-auth para proteger contra brute-force de API keys.
- Hono tiene `bodyLimit` y se puede usar un store en memoria (o Redis para multi-instancia).

**Esfuerzo:** 4-8h

---

### 2. Idempotency keys aisladas por platform

**Fuente:** R2
**Riesgo:** El UNIQUE constraint en `idempotency_records` es solo sobre `idempotency_key`, no `(idempotency_key, platform_id)`. Platform A puede usar un key que "bloquea" a Platform B.

**Plan:**
- Cambiar el UNIQUE de `idempotencyKey` a `(idempotencyKey, platformId)` en el schema de Prisma.
- Actualizar `acquire()` en `PrismaIdempotencyStore` para filtrar por `platformId` en el `findUnique`.
- Migración de DB.

**Esfuerzo:** 1-2h

---

### 3. Idempotency recovery via UNIQUE constraint

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
| `adapters/persistence/prisma/errors.ts` | Nuevo: `isUniqueViolation()` helper |
| `adapters/persistence/prisma/transaction.repo.ts` | Catch P2002 → domain error; `findByIdempotencyKey`, `findByMovementId` |
| `domain/ports/transaction.repository.ts` | Agregar queries al port |
| 4 command handlers | try/catch recovery via `AppError.code` |
| `api/middleware/idempotency.ts` | Stale pending recovery; retry en release/complete |

**Esfuerzo:** 4-6h

---

### 4. Body size limit

**Fuente:** R3
**Riesgo:** Sin límite de tamaño en el body, un payload gigante puede agotar memoria del proceso.

**Plan:**
- Agregar `bodyLimit` middleware de Hono. Ejemplo: `app.use('*', bodyLimit({ maxSize: 64 * 1024 }))` (64KB — más que suficiente para cualquier request válido).

**Esfuerzo:** 15 min

---

## Prioridad MEDIA — Deuda técnica importante

### 5. Graceful shutdown

**Fuente:** DISEÑO-5 (parcial) + AUDIT_REPORT
**Riesgo:** SIGTERM sin cleanup deja intervals corriendo y conexiones de DB huérfanas.

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

### 6. Advisory locks en background jobs

**Fuente:** DISEÑO-5
**Riesgo:** Con N réplicas, N instancias ejecutan los mismos jobs simultáneamente. Trabajo redundante y posibles race conditions.

**Plan:**
- `pg_try_advisory_lock(lockId)` antes de cada job run.
- Si otra instancia tiene el lock, skip.
- Lock IDs: 1001 para `expireHolds`, 1002 para `cleanupIdempotency`.

**Esfuerzo:** 2-4h

---

### 7. Status CHECK constraints en DB

**Fuente:** HARDENING-4
**Riesgo:** Un bug que setee `status = "actve"` (typo) pasa silenciosamente. No hay constraint a nivel DB.

**Plan:** Agregar a `prisma/immutable_ledger.sql`:
```sql
ALTER TABLE wallets ADD CONSTRAINT wallets_valid_status
  CHECK (status IN ('active', 'frozen', 'closed'));
ALTER TABLE holds ADD CONSTRAINT holds_valid_status
  CHECK (status IN ('active', 'captured', 'voided', 'expired'));
ALTER TABLE transactions ADD CONSTRAINT transactions_valid_type
  CHECK (type IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'hold_capture'));
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_valid_entry_type
  CHECK (entry_type IN ('CREDIT', 'DEBIT'));
```
Actualizar `verifyDatabaseSafetyNets()` para verificar los nuevos constraints.

**Esfuerzo:** 30 min

---

### 8. Job de reconciliación

**Fuente:** HARDENING-7
**Riesgo:** Si `cached_balance_cents` diverge del ledger por un bug, no hay forma de detectarlo automáticamente.

**Plan:** Job periódico que ejecute:
```sql
SELECT w.id, w.cached_balance_cents, COALESCE(SUM(le.amount_cents), 0) as ledger_balance
FROM wallets w LEFT JOIN ledger_entries le ON le.wallet_id = w.id
GROUP BY w.id
HAVING w.cached_balance_cents != COALESCE(SUM(le.amount_cents), 0);
```
Si hay discrepancias, loguear como error crítico (alertable).

**Esfuerzo:** 4h

---

## Prioridad BAJA — Nice to have

### 9. Sanitización de campos de texto

**Fuente:** R4
**Riesgo:** `reference` almacena strings sin sanitizar (ej: `<script>alert(1)</script>`). Como API JSON, no es un riesgo directo de XSS — pero un frontend que renderice el valor sin escapar sería vulnerable.

**Plan:** Documentar en la API que `reference` se devuelve tal cual y el consumidor debe escaparlo para HTML. Opcionalmente, strip HTML tags en input con una regex simple.

**Esfuerzo:** 30 min (documentar) / 1h (sanitizar)

---

### 10. Partial capture de holds

**Fuente:** HARDENING-6
**Riesgo:** Feature gap — un hold solo se puede capturar por el monto completo. Stripe/Adyen permiten capturas parciales.

**Plan:** Agregar `amount_cents` opcional al capture command. Si presente, capturar ese monto y liberar la diferencia.

**Esfuerzo:** 4-8h

---

### 11. Audit trail para eventos no-financieros

**Fuente:** HARDENING-8
**Riesgo:** Freeze/unfreeze, autenticación fallida, cambios de status — solo quedan en logs efímeros.

**Plan:** Tabla `audit_events` con `event_type`, `actor_id`, `resource_id`, `metadata`, `created_at`.

**Esfuerzo:** 8-12h

---

## Resumen

| Estado | Cantidad |
|--------|----------|
| Completados en esta auditoría | **8** (BUG-1, DISEÑO-1, DISEÑO-3, DISEÑO-4, HARDENING-2, HARDENING-3, HARDENING-5, +backoff) |
| Alta prioridad pendiente | **4** (#1-#4) |
| Media prioridad pendiente | **4** (#5-#8) |
| Baja prioridad pendiente | **3** (#9-#11) |

---

## Paginación — Ya resuelto

**Fuente:** R5
**Estado:** Ya implementado. Ambos endpoints de paginación (`getTransactions`, `getLedgerEntries`) tienen `Math.min(limit, 100)` como cap. Default 50, máximo 100. Cursor-based pagination con `hasMore` flag.
