-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "reason" TEXT;

-- RenameIndex
ALTER INDEX "transactions_wallet_id_amount_cents_idx" RENAME TO "transactions_wallet_id_amount_minor_idx";
