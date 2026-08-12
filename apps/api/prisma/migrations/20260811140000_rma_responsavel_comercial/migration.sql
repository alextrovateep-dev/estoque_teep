-- AlterTable
ALTER TABLE "clientes" ADD COLUMN "responsavel_comercial_id" UUID;

-- AlterTable
ALTER TABLE "rma_processos" ADD COLUMN "responsavel_comercial_id" UUID;
ALTER TABLE "rma_processos" ADD COLUMN "aprovacao_manutencao" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE';
ALTER TABLE "rma_processos" ADD COLUMN "aprovacao_em" TIMESTAMPTZ;
ALTER TABLE "rma_processos" ADD COLUMN "aprovacao_por_id" UUID;
ALTER TABLE "rma_processos" ADD COLUMN "aprovacao_obs" TEXT;

-- CreateIndex
CREATE INDEX "clientes_responsavel_comercial_id_idx" ON "clientes"("responsavel_comercial_id");
CREATE INDEX "rma_processos_responsavel_comercial_id_idx" ON "rma_processos"("responsavel_comercial_id");
CREATE INDEX "rma_processos_aprovacao_manutencao_idx" ON "rma_processos"("aprovacao_manutencao");

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_responsavel_comercial_id_fkey" FOREIGN KEY ("responsavel_comercial_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rma_processos" ADD CONSTRAINT "rma_processos_responsavel_comercial_id_fkey" FOREIGN KEY ("responsavel_comercial_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rma_processos" ADD CONSTRAINT "rma_processos_aprovacao_por_id_fkey" FOREIGN KEY ("aprovacao_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
