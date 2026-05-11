-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "failed_reason" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'posted';

-- CreateIndex
CREATE INDEX "movements_status_created_at_idx" ON "movements"("status", "created_at");
