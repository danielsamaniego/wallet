-- Immutable ledger enforcement for financial audit trail tables.
-- Apply after Prisma migrations via: prisma db execute --file prisma/immutable_ledger.sql

-- Level 1: Trigger that prevents UPDATE and DELETE on immutable tables.
-- Shared function used by all append-only financial tables.
CREATE OR REPLACE FUNCTION prevent_immutable_modify()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % operation not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ledger_entries: double-entry audit trail
DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_modify();

-- transactions: financial operation records
DROP TRIGGER IF EXISTS transactions_immutable ON transactions;
CREATE TRIGGER transactions_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_modify();

-- movements: groups of transactions (journal entries)
DROP TRIGGER IF EXISTS movements_immutable ON movements;
CREATE TRIGGER movements_immutable
  BEFORE UPDATE OR DELETE ON movements
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_modify();

-- Chain validation: each ledger entry must chain correctly from the previous entry.
-- balance_after_minor(N) must equal balance_after_minor(N-1) + amount_minor(N).
-- Uses the existing (wallet_id, created_at) index — O(log n), stops at LIMIT 1.
CREATE OR REPLACE FUNCTION validate_ledger_chain()
RETURNS trigger AS $$
DECLARE
  prev_balance BIGINT;
  v_is_system  BOOLEAN;
BEGIN
  -- System wallets use approximate balance snapshots under concurrency
  -- (adjustSystemWalletBalance uses INCREMENT, not absolute values).
  -- Chain validation would cause false CHAIN_BREAK errors on concurrent operations.
  SELECT is_system INTO v_is_system FROM wallets WHERE id = NEW.wallet_id;
  IF v_is_system THEN
    RETURN NEW;
  END IF;

  SELECT le.balance_after_minor INTO prev_balance
  FROM ledger_entries le
  WHERE le.wallet_id = NEW.wallet_id
  ORDER BY le.created_at DESC, le.id DESC
  LIMIT 1;

  prev_balance := COALESCE(prev_balance, 0);

  IF NEW.balance_after_minor != prev_balance + NEW.amount_minor THEN
    RAISE EXCEPTION 'CHAIN_BREAK: expected balance %, got % for wallet %',
      (prev_balance + NEW.amount_minor), NEW.balance_after_minor, NEW.wallet_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_chain_validation ON ledger_entries;
CREATE TRIGGER trg_ledger_chain_validation
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION validate_ledger_chain();

-- Reconciliation: after each ledger entry insert, verify that cached_balance_minor
-- matches the entry's balance_after_minor. O(1) — single PK lookup on wallets.
-- Relies on the application updating the wallet BEFORE inserting ledger entries
-- (confirmed in deposit/withdraw/transfer/captureHold use cases).
-- System wallets are skipped: their balance snapshots are approximate under concurrency.
CREATE OR REPLACE FUNCTION reconcile_balance_after_ledger()
RETURNS trigger AS $$
DECLARE
  v_wallet_balance BIGINT;
  v_is_system      BOOLEAN;
BEGIN
  SELECT cached_balance_minor, is_system
    INTO v_wallet_balance, v_is_system
    FROM wallets WHERE id = NEW.wallet_id;

  IF v_is_system THEN
    RETURN NEW;
  END IF;

  IF v_wallet_balance != NEW.balance_after_minor THEN
    RAISE EXCEPTION 'RECONCILIATION_FAILED: wallet % cached_balance=% but entry balance_after=%',
      NEW.wallet_id, v_wallet_balance, NEW.balance_after_minor;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reconcile_after_ledger ON ledger_entries;
CREATE TRIGGER trg_reconcile_after_ledger
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reconcile_balance_after_ledger();

-- Field lock: identity fields of a wallet are immutable after creation.
-- Blocks direct SQL changes to owner_id, platform_id, currency_code, is_system, shard_index, created_at.
-- Only cached_balance_minor, status, version, and updated_at are allowed to change.
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
  IF OLD.shard_index IS DISTINCT FROM NEW.shard_index THEN
    RAISE EXCEPTION 'FIELD_LOCK: wallets.shard_index is immutable';
  END IF;
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'FIELD_LOCK: wallets.created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_field_lock ON wallets;
CREATE TRIGGER trg_wallet_field_lock
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION prevent_wallet_field_tampering();

-- Wallet deletion prevention: wallets with ledger entries or holds cannot be deleted.
-- Prevents orphaned ledger history and loss of audit trail.
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

DROP TRIGGER IF EXISTS trg_prevent_wallet_deletion ON wallets;
CREATE TRIGGER trg_prevent_wallet_deletion
  BEFORE DELETE ON wallets
  FOR EACH ROW EXECUTE FUNCTION prevent_wallet_deletion();

-- State machine: wallet status transitions.
-- Enforces the same rules as wallet.aggregate.ts at the DB level.
-- Valid transitions: active→frozen, active→closed, frozen→active, frozen→closed.
-- Terminal state: closed (no transitions out).
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
  IF NEW.status = 'closed' AND OLD.status NOT IN ('active', 'frozen') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: only active or frozen wallets can be closed';
  END IF;
  IF NEW.status = 'active' AND OLD.status != 'frozen' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: only frozen wallets can be unfrozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_status_machine ON wallets;
CREATE TRIGGER trg_wallet_status_machine
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION validate_wallet_status();

-- State machine: hold status transitions.
-- Only active holds can transition. Terminal states: captured, voided, expired.
-- Closes the race condition between capture/void and the expiration job.
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

DROP TRIGGER IF EXISTS trg_hold_status_machine ON holds;
CREATE TRIGGER trg_hold_status_machine
  BEFORE UPDATE ON holds
  FOR EACH ROW EXECUTE FUNCTION validate_hold_status();

-- Zero-sum: every completed movement must have entries that sum to exactly 0.
-- Double-entry bookkeeping invariant — each credit has a corresponding debit.
-- Fires AFTER INSERT on ledger_entries. With 2 entries per movement (current design),
-- the check runs when the second entry is inserted. O(1) in practice.
CREATE OR REPLACE FUNCTION validate_movement_zero_sum()
RETURNS trigger AS $$
DECLARE
  entry_sum BIGINT;
  entry_count INT;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*)
  INTO entry_sum, entry_count
  FROM ledger_entries
  WHERE movement_id = NEW.movement_id;

  -- Once a movement has 2+ entries, they must sum to 0
  IF entry_count >= 2 AND entry_sum != 0 THEN
    RAISE EXCEPTION 'ZERO_SUM_VIOLATION: movement % entries sum to % (expected 0)',
      NEW.movement_id, entry_sum;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movement_zero_sum ON ledger_entries;
CREATE TRIGGER trg_movement_zero_sum
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION validate_movement_zero_sum();

-- Balance constraint: regular wallets cannot go negative unless their platform allows it.
-- Implemented as a trigger (not a CHECK) because it must reference the platforms table.
-- Fast path: positive balance or system wallet exits immediately with no extra query.
-- The SELECT on platforms only fires when cached_balance_minor < 0 AND NOT is_system.
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_positive_balance;

CREATE OR REPLACE FUNCTION enforce_wallet_positive_balance()
RETURNS trigger AS $$
DECLARE
  v_allow_negative BOOLEAN;
BEGIN
  -- Fast path: balance is non-negative or system wallet — always valid.
  IF NEW.cached_balance_minor >= 0 OR NEW.is_system THEN
    RETURN NEW;
  END IF;

  -- Balance is negative on a non-system wallet: check platform configuration.
  SELECT allow_negative_balance INTO v_allow_negative
  FROM platforms WHERE id = NEW.platform_id;

  IF NOT COALESCE(v_allow_negative, false) THEN
    RAISE EXCEPTION 'NEGATIVE_BALANCE_NOT_ALLOWED: wallet % balance % violates platform constraint',
      NEW.id, NEW.cached_balance_minor;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_positive_balance ON wallets;
CREATE TRIGGER trg_enforce_positive_balance
  BEFORE INSERT OR UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION enforce_wallet_positive_balance();

ALTER TABLE holds
  DROP CONSTRAINT IF EXISTS holds_positive_amount,
  ADD CONSTRAINT holds_positive_amount CHECK (amount_minor > 0);

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_positive_amount,
  ADD CONSTRAINT transactions_positive_amount CHECK (amount_minor > 0);

ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_supported_currency,
  ADD CONSTRAINT wallets_supported_currency CHECK (currency_code IN ('USD', 'EUR', 'MXN', 'CLP', 'KWD'));

-- Status CHECK constraints — prevent typos and invalid values at DB level.
ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_valid_status,
  ADD CONSTRAINT wallets_valid_status CHECK (status IN ('active', 'frozen', 'closed'));

ALTER TABLE holds
  DROP CONSTRAINT IF EXISTS holds_valid_status,
  ADD CONSTRAINT holds_valid_status CHECK (status IN ('active', 'captured', 'voided', 'expired'));

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_valid_type,
  ADD CONSTRAINT transactions_valid_type CHECK (type IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'hold_capture', 'adjustment_credit', 'adjustment_debit', 'charge'));

ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_valid_entry_type,
  ADD CONSTRAINT ledger_entries_valid_entry_type CHECK (entry_type IN ('CREDIT', 'DEBIT'));

-- shard_index bounds: [0, MAX_SYSTEM_WALLET_SHARD_COUNT). The lower bound was
-- added in the sharding migration; this script tightens it with the upper bound
-- so the DB enforces the same limit as the domain (MAX = 1024, indices 0..1023).
ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS ck_wallet_shard_index_non_negative,
  ADD CONSTRAINT ck_wallet_shard_index_non_negative CHECK (shard_index >= 0 AND shard_index < 1024);
