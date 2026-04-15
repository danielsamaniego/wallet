-- Restrict currency_code to supported currencies.
-- Application-layer validation rejects unsupported codes before they reach the DB;
-- this constraint is a defense-in-depth safety net.

ALTER TABLE wallets
  ADD CONSTRAINT wallets_supported_currency
  CHECK (currency_code IN ('USD', 'EUR', 'MXN', 'CLP', 'KWD'));
