-- AlterTable
ALTER TABLE "transferencias" ADD COLUMN "credito_destino" VARCHAR(30);

-- CreateIndex
CREATE INDEX "transferencias_status_idx" ON "transferencias"("status");
