-- Rename _cents columns to _minor to accurately reflect multi-currency support.
-- With CLP (0 decimals) and KWD (3 decimals), "cents" is misleading.
-- "minor" means "smallest unit for the currency's minor exponent."

ALTER TABLE wallets RENAME COLUMN cached_balance_cents TO cached_balance_minor;

ALTER TABLE transactions RENAME COLUMN amount_cents TO amount_minor;

ALTER TABLE ledger_entries RENAME COLUMN amount_cents TO amount_minor;
ALTER TABLE ledger_entries RENAME COLUMN balance_after_cents TO balance_after_minor;

ALTER TABLE holds RENAME COLUMN amount_cents TO amount_minor;
