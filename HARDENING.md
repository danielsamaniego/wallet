# Wallet Hardening Roadmap

Mejoras pendientes para llevar Wallet a produccion. Cada item esta inspirado en protecciones probadas de kunfupay-wallet, adaptadas a la arquitectura hexagonal y BigInt de este servicio.

Estado actual: Wallet tiene **3 capas** de proteccion DB (immutability trigger, CHECK constraints positivos, optimistic locking). El objetivo es llegar a **8+ capas**.

---

## Protecciones de base de datos

### 1. Chain validation trigger

**Prioridad:** Critica
**Esfuerzo:** 1h
**Referencia:** kunfupay-wallet `trg_validate_movement_chain`

**Problema:** Si un bug en la aplicacion calcula mal el `balance_after_cents` de un `LedgerEntry`, la DB lo acepta silenciosamente. El ledger queda roto y nadie lo detecta hasta una auditoria manual.

**Que protege:** Cada ledger entry encadena con la anterior para el mismo wallet. El `balance_after_cents` de la entry N debe ser igual al `balance_after_cents` de la entry N-1 mas `amount_cents` de la entry N.

**Escenario sin proteccion:**
```
Entry #1: balance_after = 1000  (correcto)
Entry #2: balance_after = 800   (bug: deberia ser 900, se perdieron 100 centavos)
Entry #3: balance_after = 700   (encadena con el error, ledger corrupto para siempre)
```

**SQL a implementar:**
```sql
CREATE OR REPLACE FUNCTION validate_ledger_chain()
RETURNS trigger AS $$
DECLARE
  prev_balance BIGINT;
BEGIN
  SELECT le.balance_after_cents INTO prev_balance
  FROM ledger_entries le
  WHERE le.wallet_id = NEW.wallet_id
  ORDER BY le.created_at DESC, le.id DESC
  LIMIT 1;

  prev_balance := COALESCE(prev_balance, 0);

  IF NEW.balance_after_cents != prev_balance + NEW.amount_cents THEN
    RAISE EXCEPTION 'CHAIN_BREAK: expected balance %, got % for wallet %',
      (prev_balance + NEW.amount_cents), NEW.balance_after_cents, NEW.wallet_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_chain_validation
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION validate_ledger_chain();
```

**Archivos a modificar:**
- `prisma/immutable_ledger.sql` — agregar trigger
- `src/index.ts` — agregar a `verifyDatabaseSafetyNets()`
- Tests e2e para verificar que `CHAIN_BREAK` se dispare

---

### 2. Reconciliation trigger

**Prioridad:** Critica
**Esfuerzo:** 1h
**Referencia:** kunfupay-wallet `trg_reconcile_after_movement`

**Problema:** Si `wallet.cached_balance_cents` diverge de la suma real de ledger entries, nadie lo detecta. Un acceso directo a DB podria hacer `UPDATE wallets SET cached_balance_cents = 999999` y la app no lo notaria.

**Que protege:** Despues de cada insert en `ledger_entries`, verifica que `wallets.cached_balance_cents == SUM(ledger_entries.amount_cents)` para ese wallet.

**Escenario sin proteccion:**
```sql
-- Atacante o bug:
UPDATE wallets SET cached_balance_cents = 999999 WHERE id = 'wallet-1';
-- El usuario ahora "tiene" $9,999.99 que no existen en el ledger
-- Puede retirar dinero que nunca fue depositado
```

**SQL a implementar:**
```sql
CREATE OR REPLACE FUNCTION reconcile_balance_after_ledger()
RETURNS trigger AS $$
DECLARE
  v_wallet_balance BIGINT;
  v_ledger_sum BIGINT;
BEGIN
  SELECT cached_balance_cents INTO v_wallet_balance
  FROM wallets WHERE id = NEW.wallet_id;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_ledger_sum
  FROM ledger_entries WHERE wallet_id = NEW.wallet_id;

  IF v_wallet_balance != v_ledger_sum THEN
    RAISE EXCEPTION 'RECONCILIATION_FAILED: wallet % balance=% but SUM(ledger)=% (diff=%)',
      NEW.wallet_id, v_wallet_balance, v_ledger_sum, ABS(v_wallet_balance - v_ledger_sum);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reconcile_after_ledger
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reconcile_balance_after_ledger();
```

**Nota:** Tolerancia 0 (exact match). Wallet usa BigInt centavos — no hay redondeo, no hay drift, no hay excusa para que difieran.

**Archivos a modificar:**
- `prisma/immutable_ledger.sql` — agregar trigger
- `src/index.ts` — agregar a verificacion de startup
- Tests e2e para verificar que `RECONCILIATION_FAILED` se dispare

---

### 3. Field lock triggers (wallet)

**Prioridad:** Critica
**Esfuerzo:** 1h
**Referencia:** kunfupay-wallet `trg_wallet_field_lock`

**Problema:** Con acceso directo a DB, alguien puede cambiar `owner_id`, `platform_id`, `currency_code` o `is_system` de una wallet. Esto permite robo (reasignar wallet a otro usuario), corrupcion (cambiar moneda), o escalacion de privilegios (convertir wallet en system wallet).

**Que protege:** Hace inmutables los campos que definen la identidad de una wallet. Solo `cached_balance_cents`, `status`, `version` y `updated_at` pueden cambiar.

**Campos inmutables:**
- `owner_id` — a quien pertenece
- `platform_id` — a que plataforma pertenece
- `currency_code` — en que moneda opera
- `is_system` — si es wallet de sistema
- `created_at` — cuando se creo

**SQL a implementar:**
```sql
CREATE OR REPLACE FUNCTION prevent_wallet_field_tampering()
RETURNS trigger AS $$
BEGIN
  IF OLD.owner_id IS DISTINCT FROM NEW.owner_id THEN
    RAISE EXCEPTION 'FIELD_LOCK: wallets.owner_id is immutable';
  END IF;
  IF OLD.platform_id IS DISTINCT FROM NEW.platform_id THEN
    RAISE EXCEPTION 'FIELD_LOCK: wallets.platform_id is immutable';
  END IF;
  IF OLD.currency_code IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'FIELD_LOCK: wallets.currency_code is immutable';
  END IF;
  IF OLD.is_system IS DISTINCT FROM NEW.is_system THEN
    RAISE EXCEPTION 'FIELD_LOCK: wallets.is_system is immutable';
  END IF;
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'FIELD_LOCK: wallets.created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_field_lock
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION prevent_wallet_field_tampering();
```

**Archivos a modificar:**
- `prisma/immutable_ledger.sql` — agregar trigger
- `src/index.ts` — agregar a verificacion de startup

---

### 4. Wallet deletion prevention

**Prioridad:** Critica
**Esfuerzo:** 30min
**Referencia:** kunfupay-wallet `trg_prevent_wallet_delete`

**Problema:** `DELETE FROM wallets WHERE id = '...'` borra una wallet y toda su historia de ledger entries queda huerfana. La integridad referencial de FK no aplica si se borra en cascada, y el audit trail se pierde irrecuperablemente.

**Que protege:** Previene borrado de wallets que tienen ledger entries o holds asociados.

**SQL a implementar:**
```sql
CREATE OR REPLACE FUNCTION prevent_wallet_deletion()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ledger_entries WHERE wallet_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'DELETE_BLOCKED: wallet % has ledger entries and cannot be deleted', OLD.id;
  END IF;
  IF EXISTS (SELECT 1 FROM holds WHERE wallet_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'DELETE_BLOCKED: wallet % has holds and cannot be deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_wallet_deletion
  BEFORE DELETE ON wallets
  FOR EACH ROW EXECUTE FUNCTION prevent_wallet_deletion();
```

**Archivos a modificar:**
- `prisma/immutable_ledger.sql` — agregar trigger
- `src/index.ts` — agregar a verificacion de startup

---

### 5. State machine triggers (wallet + hold)

**Prioridad:** Alta
**Esfuerzo:** 1h
**Referencia:** kunfupay-wallet `trg_settlement_state_machine` (adaptado)

**Problema:** La app valida transiciones de estado en el dominio (`wallet.aggregate.ts`, `hold.entity.ts`), pero con acceso directo a DB se puede hacer `UPDATE wallets SET status = 'active' WHERE status = 'closed'` (resucitar una wallet cerrada) o `UPDATE holds SET status = 'active' WHERE status = 'captured'` (reactivar un hold capturado para doble-captura).

**Que protege:** Enforce en DB de las transiciones validas:

Wallet:
```
active  → frozen    (freeze)
active  → closed    (close)
frozen  → active    (unfreeze)
closed  → (ninguna) (terminal)
```

Hold:
```
active   → captured  (capture)
active   → voided    (void)
active   → expired   (expire)
captured → (ninguna) (terminal)
voided   → (ninguna) (terminal)
expired  → (ninguna) (terminal)
```

**SQL a implementar:**
```sql
CREATE OR REPLACE FUNCTION validate_wallet_status()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: closed wallet cannot change status';
  END IF;
  IF NEW.status = 'frozen' AND OLD.status != 'active' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: only active wallets can be frozen';
  END IF;
  IF NEW.status = 'closed' AND OLD.status != 'active' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: only active wallets can be closed';
  END IF;
  IF NEW.status = 'active' AND OLD.status != 'frozen' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: only frozen wallets can be unfrozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_status_machine
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION validate_wallet_status();

CREATE OR REPLACE FUNCTION validate_hold_status()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status != 'active' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: hold % is %, cannot change status', OLD.id, OLD.status;
  END IF;
  IF NEW.status NOT IN ('captured', 'voided', 'expired') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: invalid hold target status %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_hold_status_machine
  BEFORE UPDATE ON holds
  FOR EACH ROW EXECUTE FUNCTION validate_hold_status();
```

**Archivos a modificar:**
- `prisma/immutable_ledger.sql` — agregar ambos triggers
- `src/index.ts` — agregar a verificacion de startup

---

### 6. Movement zero-sum trigger

**Prioridad:** Alta
**Esfuerzo:** 1h
**Referencia:** Inspirado en kunfupay-wallet `ck_movement_math`

**Problema:** El sistema usa double-entry bookkeeping — cada movement debe tener entries que sumen exactamente 0 (cada credito tiene un debito correspondiente). Si un bug crea solo un lado de la transaccion, se crea o destruye dinero silenciosamente.

**Que protege:** Despues de insertar una ledger entry, verifica que la suma de todas las entries del mismo movement sea 0 cuando el movement esta completo (2 entries).

**Escenario sin proteccion:**
```
Deposit $100:
  Entry 1: wallet-user  CREDIT +100  (usuario recibe)
  Entry 2: wallet-system DEBIT -100   (sistema paga)
  SUM = 0 ✓

Bug — deposit parcial:
  Entry 1: wallet-user  CREDIT +100  (usuario recibe)
  (Entry 2 nunca se crea por un bug)
  SUM = +100 ← dinero creado de la nada
```

**SQL a implementar:**
```sql
CREATE OR REPLACE FUNCTION validate_movement_zero_sum()
RETURNS trigger AS $$
DECLARE
  entry_sum BIGINT;
  entry_count INT;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0), COUNT(*)
  INTO entry_sum, entry_count
  FROM ledger_entries
  WHERE movement_id = NEW.movement_id;

  -- Double-entry: once a movement has 2+ entries, they must sum to 0
  IF entry_count >= 2 AND entry_sum != 0 THEN
    RAISE EXCEPTION 'ZERO_SUM_VIOLATION: movement % entries sum to % (expected 0)',
      NEW.movement_id, entry_sum;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_movement_zero_sum
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION validate_movement_zero_sum();
```

**Archivos a modificar:**
- `prisma/immutable_ledger.sql` — agregar trigger
- `src/index.ts` — agregar a verificacion de startup

---

## Error handling

### 7. PostgreSQL error wrapping

**Prioridad:** Alta
**Esfuerzo:** 2h
**Referencia:** kunfupay-wallet `wrapPgError()`

**Problema:** Si un trigger de DB dispara `CHAIN_BREAK`, `RECONCILIATION_FAILED`, o `FIELD_LOCK`, el error llega al global `onError` como un error generico de Prisma. El cliente recibe `500 INTERNAL_ERROR` sin informacion accionable. El operador no sabe que tipo de corrupcion se detecto.

**Que mejora:** Mapear excepciones de PostgreSQL a `AppError` con codigos especificos. El cliente recibe 409 Conflict con un codigo que describe exactamente que paso.

**Implementacion:**
```typescript
// src/utils/infrastructure/hono.error.ts (nueva funcion)
function wrapPgError(err: unknown): AppError | null {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("CHAIN_BREAK"))
    return AppError.conflict("CHAIN_BREAK", "ledger entry chain integrity violated");
  if (msg.includes("RECONCILIATION_FAILED"))
    return AppError.conflict("RECONCILIATION_FAILED", "wallet balance diverged from ledger");
  if (msg.includes("FIELD_LOCK"))
    return AppError.conflict("FIELD_LOCK", "attempted to modify immutable field");
  if (msg.includes("DELETE_BLOCKED"))
    return AppError.conflict("DELETE_BLOCKED", "entity has dependent records");
  if (msg.includes("INVALID_TRANSITION"))
    return AppError.domainRule("INVALID_TRANSITION", "status transition not allowed");
  if (msg.includes("ZERO_SUM_VIOLATION"))
    return AppError.conflict("ZERO_SUM_VIOLATION", "movement entries do not sum to zero");
  if (msg.includes("append-only"))
    return AppError.conflict("IMMUTABLE_VIOLATION", "append-only table cannot be modified");

  return null;
}
```

**Agregar al `onError` en `src/app.ts`:**
```typescript
app.onError((err, c) => {
  const pgError = wrapPgError(err);
  if (pgError) {
    deps.logger.warn(ctx, pgError.code);
    return errorResponse(c, pgError.code, pgError.msg, httpStatus(pgError.kind));
  }
  // ... resto del handler existente
});
```

**Archivos a modificar:**
- `src/utils/infrastructure/hono.error.ts` — agregar `wrapPgError()`
- `src/app.ts` — integrar en `onError`
- `tests/unit/app.test.ts` — tests para cada tipo de error PG

---

### 8. Startup verification extendida

**Prioridad:** Alta
**Esfuerzo:** 30min
**Referencia:** Patron existente en `src/index.ts` (ya verifica 3 triggers + 3 constraints)

**Problema:** Despues de agregar los triggers 1-6, la verificacion de startup debe confirmar que TODOS existen antes de aceptar trafico. Si alguno falta (por ejemplo, alguien aplico migraciones pero olvido correr `immutable_ledger.sql`), la app esta desprotegida sin saberlo.

**Que mejora:** Extender `verifyDatabaseSafetyNets()` para chequear todos los triggers nuevos.

**Triggers a verificar (adicionales a los 3 existentes):**
```typescript
const requiredTriggers = [
  // Existentes
  "ledger_entries_immutable",
  "transactions_immutable",
  "movements_immutable",
  // Nuevos
  "trg_ledger_chain_validation",
  "trg_reconcile_after_ledger",
  "trg_wallet_field_lock",
  "trg_prevent_wallet_deletion",
  "trg_wallet_status_machine",
  "trg_hold_status_machine",
  "trg_movement_zero_sum",
];
```

**Archivos a modificar:**
- `src/index.ts` — extender arrays de `expectedTriggers`

---

## Completados

### ~~9. Pre-commit hooks (Husky)~~ ✅

Implementado en commit `bfa0607` + `ae77d08`.

Husky + lint-staged ejecuta en cada commit:
- **Biome lint** en todos los `.ts` staged
- **Layer violation checker** — domain/application no pueden importar infrastructure/middleware, use cases no pueden importar otros use cases
- **Financial pattern checker** — bloquea `parseFloat`, `.toFixed()`, `Math.round` en campos de dinero

---

### ~~10. CI/CD workflows (test + lint)~~ ✅

Implementado en commit `b7a1bed`.

GitHub Actions `ci.yml` con 4 jobs paralelos en cada PR y push a main:
- Lint (Biome)
- Type check (`tsc --noEmit`)
- Unit tests (`pnpm test`)
- E2E tests (`pnpm test:e2e` con PostgreSQL 16 service container)

---

### ~~11. Env validation con Zod~~ ✅

Implementado en commit `83b3ee1`.

`loadConfig()` valida con Zod al arrancar:
- `DATABASE_URL` requerido, validado como URL
- `HTTP_PORT` entero 1-65535
- `LOG_LEVEL` enum de niveles Pino validos
- Test guardian que falla si se agrega una variable sin testearla

---

### ~~12. Health check con DB~~ ✅

Implementado en commit `161dde2`.

`GET /health` ejecuta `SELECT 1` contra PostgreSQL:
- DB accesible: `200 { status: "ok", db: "connected" }`
- DB caida: `503 { status: "degraded", db: "disconnected" }`
