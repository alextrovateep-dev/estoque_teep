-- AlterTable
ALTER TABLE "rma_anexos" ADD COLUMN "item_id" UUID;

-- CreateIndex
CREATE INDEX "rma_anexos_item_id_idx" ON "rma_anexos"("item_id");

-- AddForeignKey
ALTER TABLE "rma_anexos" ADD CONSTRAINT "rma_anexos_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "rma_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
