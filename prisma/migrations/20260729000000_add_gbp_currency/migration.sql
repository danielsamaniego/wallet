-- Allow British pounds in the wallet currency catalog.
ALTER TABLE "wallets"
  DROP CONSTRAINT IF EXISTS "wallets_supported_currency",
  ADD CONSTRAINT "wallets_supported_currency"
    CHECK ("currency_code" IN ('USD', 'EUR', 'MXN', 'CLP', 'KWD', 'GBP'));
