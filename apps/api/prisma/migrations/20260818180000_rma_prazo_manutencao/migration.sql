-- AlterTable
ALTER TABLE "rma_processos" ADD COLUMN "prazo_manutencao" DATE;

CREATE INDEX "rma_processos_prazo_manutencao_idx" ON "rma_processos"("prazo_manutencao");
