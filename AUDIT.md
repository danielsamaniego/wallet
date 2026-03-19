# Wallet Service — Production Readiness Audit

## LO BUENO (Fortalezas sólidas)

### 1. Modelo contable correcto

Double-entry bookkeeping con `Movement` como journal entry. Cada operación financiera produce entradas de ledger que suman cero por movimiento (`SUM(amount_cents) GROUP BY movement_id = 0`). Este es el mismo modelo que usan wallets profesionales como Stripe, Modern Treasury y Moov.

- Cada deposit, withdrawal, transfer y hold capture genera exactamente dos ledger entries (CREDIT + DEBIT) agrupados bajo un `Movement`.
- El `Movement` actúa como journal entry contable, garantizando la integridad del sistema de partida doble.
- Las transferencias generan dos `Transaction` entities (transfer_out, transfer_in) con el mismo `movementId`, manteniendo trazabilidad completa.

### 2. Ledger inmutable con enforcement a nivel DB

El archivo `prisma/immutable_ledger.sql` implementa protección multinivel:

```sql
-- Trigger que previene UPDATE y DELETE en ledger_entries
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modify();

-- Constraints de seguridad adicionales
ALTER TABLE wallets ADD CONSTRAINT wallets_positive_balance
  CHECK (cached_balance_cents >= 0 OR is_system = true);
ALTER TABLE holds ADD CONSTRAINT holds_positive_amount CHECK (amount_cents > 0);
ALTER TABLE transactions ADD CONSTRAINT transactions_positive_amount CHECK (amount_cents > 0);
```

Esto es una capa de defensa excelente que muchas wallets omiten, confiando únicamente en la aplicación. Si un bug en el código intenta modificar el ledger, la DB lo rechaza.

### 3. Optimistic locking bien implementado

El campo `version` en `Wallet` con `updateMany WHERE version = X` en `src/wallet/adapters/persistence/prisma/wallet.repo.ts:42-58` es la implementación canónica de optimistic concurrency control:

```typescript
const result = await db.wallet.updateMany({
  where: { id: wallet.id, version: wallet.version },
  data: {
    cachedBalanceCents: wallet.cachedBalanceCents,
    status: wallet.status,
    version: wallet.version + 1,
    updatedAt: BigInt(wallet.updatedAt),
  },
});
if (result.count === 0) {
  throw ErrVersionConflict();
}
```

Detalles destacables:
- `touchForHoldChange()` en el aggregate hace que PlaceHold y VoidHold participen en el contention del wallet, evitando que holds concurrentes pasen el balance check simultáneamente.
- El version check se hace dentro de la transacción de DB, garantizando atomicidad.
- El error `VERSION_CONFLICT` se mapea a HTTP 409, permitiendo retry del cliente.

### 4. Idempotencia con atomic acquire

El middleware `src/api/middleware/idempotency.ts` implementa el patrón INSERT-ON-CONFLICT:

- Hash SHA-256 del payload (`method:path:body`) para detectar payload mismatches con el mismo idempotency key.
- No cachea errores transient (5xx, 409) — libera el key para que el cliente pueda reintentar.
- Responses determinísticas (2xx, 4xx) se cachean por 48h.
- Detección de request en progreso (`IDEMPOTENCY_KEY_IN_PROGRESS`) cuando otra request está procesando el mismo key.
- Detección de payload mismatch (`IDEMPOTENCY_PAYLOAD_MISMATCH`) cuando el mismo key se usa con body diferente.

### 5. BigInt para montos

Todos los campos monetarios usan `BigInt` (integer cents), eliminando cualquier posibilidad de errores de punto flotante. La convención `_cents` en nombres de columnas es clara y autoexplicativa. Los montos se validan como positivos a nivel de dominio y a nivel de DB constraint.

### 6. Arquitectura hexagonal limpia

```
src/wallet/
├── domain/          # Aggregates, entities, ports (interfaces) — sin dependencias externas
├── application/     # Commands & Queries (use cases) — solo depende de domain
├── adapters/        # Implementaciones concretas (Prisma, HTTP)
│   ├── persistence/ # Driven adapters (repositories)
│   └── ports/http/  # Driving adapters (HTTP handlers)
```

- Domain no importa nada de `@prisma/client`, `hono`, ni ningún framework.
- Los puertos (`IWalletRepository`, `ITransactionManager`, etc.) están definidos en domain.
- Wiring explícito en `src/wiring.ts` — no hay magic DI container.
- CQRS con read stores separados para queries, sin cargar aggregates innecesariamente.

### 7. Defensa en profundidad para holds

Triple verificación de expiración:

1. **On-access check**: `hold.isExpired(now)` en capture/void — si el hold expiró entre el batch job y el request, se detecta y actualiza inmediatamente.
2. **Batch job**: Cada 30s marca holds con `status='active' AND expires_at < now` como `expired`.
3. **Query filters**: `WHERE (expires_at IS NULL OR expires_at > now)` en `sumActiveHolds`, `countActiveHolds`, `findActiveByWallet` — los holds expirados no cuentan para el balance disponible aunque no hayan sido marcados aún.

### 8. `balanceAfterCents` en ledger entries

Cada ledger entry registra el snapshot del balance después de aplicarse. Esto permite:

- Reconstruir el balance a cualquier punto en el tiempo sin replay de eventos.
- Verificación de consistencia: el `balanceAfterCents` de la última entry de un wallet debe coincidir con `cachedBalanceCents`.
- Generación de estados de cuenta sin cálculos complejos.

Decisión pragmática acertada frente a event sourcing completo.

---

## LO MALO (Problemas críticos para producción)

### CRÍTICO 1: Deadlock en transfers concurrentes

**Archivo**: `src/wallet/application/command/transfer/handler.ts:140-141`

```typescript
await this.walletRepo.save(txCtx, source);  // UPDATE wallet A → row lock
await this.walletRepo.save(txCtx, target);  // UPDATE wallet B → row lock
```

**Escenario de deadlock**:

Si dos transfers concurrentes ejecutan A→B y B→A simultáneamente:

```
T1: UPDATE wallet A (acquires row lock on A)
T2: UPDATE wallet B (acquires row lock on B)
T1: UPDATE wallet B (blocks — T2 holds lock on B)
T2: UPDATE wallet A (blocks — T1 holds lock on A)
→ DEADLOCK
```

PostgreSQL detectará el deadlock y matará una de las transacciones (~1-3s de delay), pero esto causa:
- Errores 500 inesperados en producción.
- Degradación de performance bajo carga.
- Un patrón que debería ser prevenido por diseño, no por detección del motor de DB.

**Solución**: Ordenar los wallets por ID antes de persistir para garantizar un orden de lock consistente:

```typescript
// Persist wallets in deterministic order to prevent deadlocks
const [first, second] = source.id < target.id
  ? [source, target] : [target, source];
await this.walletRepo.save(txCtx, first);
await this.walletRepo.save(txCtx, second);
```

Este patrón de "lock ordering" es estándar en sistemas financieros y elimina deadlocks por diseño.

---

### CRÍTICO 2: System wallet como cuello de botella de escalabilidad

**Archivos afectados**: `deposit/handler.ts`, `withdraw/handler.ts`, `captureHold/handler.ts`

**Problema**: Toda operación financiera toca el system wallet del platform+currency:

```typescript
// deposit/handler.ts
wallet.deposit(cmd.amountCents, now);
systemWallet.withdraw(cmd.amountCents, 0n, now);  // ← Toca system wallet
await this.walletRepo.save(txCtx, wallet);
await this.walletRepo.save(txCtx, systemWallet);   // ← UPDATE con version check
```

Bajo carga, el system wallet se convierte en un hot row. Con 100 TPS, casi cada operación generará `VERSION_CONFLICT` en el system wallet porque todas compiten por la misma fila con el mismo version number.

**Impacto**: Con 100 requests concurrentes, solo 1 gana el version check; las otras 99 reciben 409 y deben reintentar. Esto crea una cascada de reintentos que amplifica la carga.

**Soluciones** (de menor a mayor complejidad):

1. **System wallet sin version check** (recomendado): El system wallet no necesita protección optimista — su balance puede ser negativo y no tiene restricción de fondos. Usar un UPDATE atómico directo:
   ```sql
   UPDATE wallets
   SET cached_balance_cents = cached_balance_cents + $amount,
       updated_at = $now
   WHERE id = $systemWalletId
   ```
   Sin check de version. La atomicidad del UPDATE de PostgreSQL es suficiente.

2. **Sharded system wallets**: Crear N system wallets por platform+currency y distribuir round-robin. Reduce contention N veces.

3. **Reconciliación diferida**: No tocar el system wallet en tiempo real. Acumular movimientos y reconciliar con batch job periódico.

---

### CRÍTICO 3: Idempotency `release` y `complete` son fire-and-forget

**Archivo**: `src/api/middleware/idempotency.ts:153,163`

```typescript
// Línea 153: Error silenciado
store.release(key, platformId).catch(() => {});

// Línea 163: Error silenciado
store.complete(key, platformId, status, responseBody).catch(() => {});
```

**Escenario 1 — Release falla después de un 409**:
1. Request A ejecuta la operación, recibe VERSION_CONFLICT (409).
2. El middleware intenta `release` del idempotency record, pero falla (DB down momentáneamente, timeout).
3. El record queda en estado "pending" (`responseStatus = 0`).
4. El cliente reintenta con el mismo idempotency key.
5. El middleware ve `responseStatus = 0` → devuelve `IDEMPOTENCY_KEY_IN_PROGRESS` (409).
6. **El cliente queda bloqueado durante 48 horas** (TTL del record) sin poder reintentar.

**Escenario 2 — Complete falla después de éxito**:
1. Request ejecuta la operación financiera exitosamente (dinero movido).
2. El middleware intenta `complete` del idempotency record, pero falla.
3. El record queda en estado "pending".
4. El cliente reintenta con el mismo idempotency key.
5. El middleware ve "pending" → devuelve `IDEMPOTENCY_KEY_IN_PROGRESS`.
6. Eventualmente el TTL expira, el record se limpia.
7. El cliente reintenta y **la operación se ejecuta de nuevo** → double spend.

**Solución**:
- `release` y `complete` deben ser operaciones síncronas con al menos 1 retry y logging de error crítico (alertable).
- Idealmente, mover el idempotency record **dentro** de la transacción de negocio (ver CRÍTICO 4).

---

### CRÍTICO 4: La transacción de idempotencia y la transacción de negocio están desacopladas

**Flujo actual**:

```
Middleware:  INSERT idempotency record (pending)     ← Transacción 1
Handler:    Ejecuta operación financiera             ← Transacción 2
Middleware:  UPDATE idempotency record (completed)   ← Transacción 3
```

Hay una ventana entre las transacciones 2 y 3 donde el proceso puede morir (crash, OOM kill, deploy):

```
1. INSERT idempotency record → OK
2. Ejecuta transfer de $1000 → COMMIT exitoso, dinero movido
3. ← PROCESO MUERE AQUÍ →
4. UPDATE idempotency record → NUNCA EJECUTADO
```

Resultado:
- El dinero se movió.
- El idempotency record queda "pending".
- Después de TTL (48h), el record se limpia.
- El cliente reintenta → **la operación se ejecuta de nuevo**.
- $1000 transferidos dos veces.

**Nota**: El `Transaction.idempotencyKey` unique constraint en la tabla `transactions` actúa como segunda línea de defensa — si el retry inserta otra transaction con el mismo key, la constraint UNIQUE falla. Pero esto genera un error 500 no manejado en lugar de devolver la respuesta idempotente cached.

**Solución profesional**: Hay dos caminos:

1. **Mover el complete dentro de la transacción de negocio**: Que el handler actualice el idempotency record dentro del mismo `txManager.run()`. Así, si el commit falla, todo se revierte; si el commit pasa, el record queda completo atómicamente.

2. **Confiar en el unique constraint como mecanismo primario**: Manejar el error de duplicate `idempotencyKey` en `Transaction` como señal de operación ya ejecutada, y devolver la respuesta correcta consultando la transacción existente.

---

### CRÍTICO 5: READ COMMITTED no protege contra phantom reads en operaciones financieras

**Problema**: `Prisma.$transaction()` usa READ COMMITTED por defecto. En el flujo de withdraw/transfer/placeHold:

```typescript
// Paso 1: Lee balance del wallet
const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
// wallet.cachedBalanceCents = 1000

// Paso 2: Lee suma de holds activos
const activeHolds = await this.holdRepo.sumActiveHolds(txCtx, wallet.id);
// activeHolds = 200, availableBalance = 800

// ← VENTANA: otra transacción T2 inserta un hold de 700 y hace COMMIT →
// (phantom read: este hold no era visible cuando leímos en paso 2)

// Paso 3: Verifica y retira
wallet.withdraw(500n, 800n, now);  // Pasa: 800 >= 500
// Pero el balance disponible REAL ahora es 1000 - 200 - 700 = 100
// El withdraw de 500 no debería haber pasado
```

Con READ COMMITTED, cada statement ve la foto más reciente de datos committed. Pero entre statements dentro de la misma transacción, otros commits son visibles.

**Mitigación existente**: `touchForHoldChange()` en PlaceHold hace que el hold y el withdraw compitan por la versión del wallet. Si ambos leen version=5, solo uno podrá actualizar a version=6. Esto mitiga el escenario pero no lo elimina completamente — depende del orden exacto de ejecución.

**Solución**: Usar `isolationLevel: 'Serializable'` o al menos `'RepeatableRead'` para transacciones financieras:

```typescript
await this.prisma.$transaction(fn, {
  isolationLevel: 'Serializable'
});
```

O alternativamente, agregar `SELECT FOR UPDATE` al leer el wallet para garantizar que nadie más puede modificarlo durante la transacción.

---

## LO QUE PUEDE MEJORAR (Importante pero no bloqueante)

### 1. No hay retry server-side para version conflicts

El servidor devuelve 409 `VERSION_CONFLICT` y espera que el cliente reintente. Wallets profesionales implementan 2-3 reintentos internos (con backoff) antes de escalar al cliente. Esto:

- Reduce latencia percibida (el retry interno es ms, el del cliente es cientos de ms por roundtrip).
- Simplifica la integración del cliente.
- Absorbe contention natural sin exponer errores al usuario final.

```typescript
// Patrón sugerido
async runWithRetry<T>(ctx: AppContext, fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isVersionConflict(err) && attempt < maxRetries - 1) {
        continue; // Retry with fresh read
      }
      throw err;
    }
  }
}
```

### 2. Status como strings sin constraint de DB

Wallet status (`active | frozen | closed`), hold status (`active | captured | voided | expired`), transaction type — todos son `String` sin restricción a nivel DB.

Un bug que setee `status = "actve"` (typo) pasará silenciosamente y causará comportamiento inesperado.

**Solución**: Agregar CHECK constraints en `immutable_ledger.sql`:

```sql
ALTER TABLE wallets ADD CONSTRAINT wallets_valid_status
  CHECK (status IN ('active', 'frozen', 'closed'));

ALTER TABLE holds ADD CONSTRAINT holds_valid_status
  CHECK (status IN ('active', 'captured', 'voided', 'expired'));

ALTER TABLE transactions ADD CONSTRAINT transactions_valid_type
  CHECK (type IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'hold_capture'));
```

### 3. Jobs in-process sin distributed lock

`expireHolds` y `cleanupIdempotencyRecords` usan `setInterval` y corren en cada instancia del servicio. Con N réplicas, N instancias ejecutan el mismo job simultáneamente:

- Trabajo redundante multiplicado por N.
- Posibles race conditions entre instancias procesando los mismos records.
- Sin visibilidad de cuál instancia ejecutó el job.

**Solución**: Usar `pg_advisory_lock` para leader election:

```typescript
async function withAdvisoryLock(prisma: PrismaClient, lockId: number, fn: () => Promise<void>) {
  const acquired = await prisma.$queryRaw`SELECT pg_try_advisory_lock(${lockId})`;
  if (!acquired) return; // Another instance has the lock
  try {
    await fn();
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${lockId})`;
  }
}
```

### 4. No hay partial capture de holds

Un hold de $100 solo puede capturarse por los $100 completos. Wallets de producción (Stripe, Adyen, Square) permiten capturas parciales:

```
Hold: $100
Capture: $70
→ $70 se debita, $30 se libera automáticamente
```

Esto es estándar en e-commerce (el monto final puede diferir del autorizado por impuestos, descuentos, items cancelados).

**Impacto**: Limita casos de uso reales donde el monto final difiere del autorizado.

### 5. No hay timeout explícito en transacciones

`Prisma.$transaction()` tiene un timeout default de 5 segundos. Para operaciones que tocan múltiples wallets, holds, ledger entries y potencialmente reintentos, 5 segundos puede ser insuficiente.

```typescript
// Configurar explícitamente
await this.prisma.$transaction(fn, {
  timeout: 10000,       // 10 segundos
  maxWait: 5000,        // Máximo 5s esperando conexión del pool
});
```

### 6. No hay rate limiting

Sin protección contra abuso a nivel API. Un cliente malicioso o buggy puede:

- Saturar el sistema con requests que generan version conflicts en cascada.
- Crear miles de holds para bloquear fondos de un wallet.
- Hacer requests masivas al endpoint de balance para DoS.

**Solución mínima**: Rate limiting por `platformId` + endpoint con buckets diferenciados (más permisivo para reads, restrictivo para mutations).

### 7. Sin audit trail para eventos no-financieros

El ledger captura operaciones financieras, pero eventos como:
- Freeze / unfreeze de wallet
- Intento de close
- Autenticación fallida
- Cambios de status de platform

Solo quedan en logs de aplicación (efímeros, no queryables). Un `audit_events` table permitiría compliance y forensics.

### 8. No hay mecanismo de reconciliación

No existe un proceso para verificar que:

```sql
wallet.cached_balance_cents == SUM(ledger_entries.amount_cents WHERE wallet_id = wallet.id)
```

Si alguna vez divergen (bug en código, partial failure no contemplada, error de migración), no hay forma de detectarlo automáticamente.

**Solución**: Job periódico de reconciliación que compare balances y alerte si hay discrepancia:

```sql
SELECT w.id, w.cached_balance_cents, COALESCE(SUM(le.amount_cents), 0) as ledger_balance
FROM wallets w
LEFT JOIN ledger_entries le ON le.wallet_id = w.id
GROUP BY w.id
HAVING w.cached_balance_cents != COALESCE(SUM(le.amount_cents), 0);
```

### 9. Graceful shutdown ausente

Los cron jobs con `setInterval` no tienen cleanup. Si el proceso recibe SIGTERM durante una operación:

- El interval no se cancela.
- Operaciones en vuelo pueden quedar en estado inconsistente.
- Conexiones de DB pueden no cerrarse limpiamente.

**Solución**:

```typescript
const intervals: NodeJS.Timeout[] = [];

process.on('SIGTERM', async () => {
  intervals.forEach(clearInterval);
  await prisma.$disconnect();
  process.exit(0);
});
```

### 10. `Date.now()` como fuente de timestamps

`Date.now()` se usa dentro de transacciones para todos los timestamps. En un entorno distribuido con múltiples instancias, el clock skew entre máquinas puede causar:

- Ledger entries con timestamps no monotónicos.
- Holds que expiran antes o después de lo esperado.
- Orden inconsistente en queries por `createdAt`.

Los UUID v7 mitigan esto parcialmente (contienen timestamp), pero los campos `createdAt`/`updatedAt` pueden divergir del UUID timestamp.

**Impacto**: Menor en single-instance, potencial problema con múltiples réplicas.

---

## Resumen Ejecutivo

| Área | Calificación | Notas |
|------|:---:|-------|
| Modelo de datos | **9/10** | Double-entry correcto, BigInt, snapshots de balance |
| Arquitectura | **9/10** | DDD / Hexagonal / CQRS limpio y bien separado |
| Concurrencia | **6/10** | Optimistic lock bueno, pero deadlock en transfers, system wallet bottleneck, isolation level insuficiente |
| Idempotencia | **5/10** | Diseño correcto pero la separación de transacciones crea ventana de double-spend |
| Operabilidad | **6/10** | Buen logging, pero sin reconciliación, sin graceful shutdown, jobs sin distributed lock |
| Completitud funcional | **7/10** | Falta partial capture, rate limiting, audit events |

**Veredicto**: La base arquitectónica y el modelo de datos son excelentes — mejor que muchos sistemas en producción. Pero los 5 problemas marcados como CRÍTICO son condiciones de carrera reales que bajo carga pueden causar pérdida de dinero (double-spend en idempotencia) o degradación severa (deadlock en transfers, contention en system wallet). Resolverlos es necesario antes de ir a producción con tráfico real.
