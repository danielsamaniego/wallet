-- Immutable ledger enforcement for ledger_entries table.
-- Apply after Prisma migrations via: psql -f prisma/immutable_ledger.sql

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

-- Safety constraints
ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_positive_balance,
  ADD CONSTRAINT wallets_positive_balance CHECK (cached_balance_cents >= 0 OR is_system = true);

ALTER TABLE holds
  DROP CONSTRAINT IF EXISTS holds_positive_amount,
  ADD CONSTRAINT holds_positive_amount CHECK (amount_cents > 0);

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_positive_amount,
  ADD CONSTRAINT transactions_positive_amount CHECK (amount_cents > 0);
