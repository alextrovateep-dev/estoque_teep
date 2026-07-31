-- AlterTable
ALTER TABLE "tipos_movimentacao" ALTER COLUMN "operacao" SET DATA TYPE VARCHAR(20);

-- AlterTable
ALTER TABLE "tipos_movimentacao" ADD COLUMN IF NOT EXISTS "permitido_operador" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tipos_movimentacao" ADD COLUMN IF NOT EXISTS "permitido_gerente" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "movimentacoes" ALTER COLUMN "operacao" SET DATA TYPE VARCHAR(20);
ALTER TABLE "movimentacoes" ADD COLUMN IF NOT EXISTS "filial_destino_id" UUID;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "movimentacoes_filial_destino_id_idx" ON "movimentacoes"("filial_destino_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "movimentacoes"
    ADD CONSTRAINT "movimentacoes_filial_destino_id_fkey"
    FOREIGN KEY ("filial_destino_id") REFERENCES "filiais"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
