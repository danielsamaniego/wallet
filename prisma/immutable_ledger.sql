-- Immutable ledger enforcement for ledger_entries table.
-- Apply after Prisma migrations via: psql -f prisma/immutable_ledger.sql

-- Level 1: Trigger that prevents UPDATE and DELETE on ledger_entries.
CREATE OR REPLACE FUNCTION prevent_ledger_modify()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % operation not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modify();

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
