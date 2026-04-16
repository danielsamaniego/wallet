-- Add allow_negative_balance flag to platforms.
-- When true, the platform's wallets can have a negative cached_balance_minor
-- via administrative adjustments (dispute/chargeback scenarios).
-- Default false preserves existing behaviour for all current platforms.
ALTER TABLE "platforms" ADD COLUMN "allow_negative_balance" BOOLEAN NOT NULL DEFAULT false;
