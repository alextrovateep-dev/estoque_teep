-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "estoque_maximo" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "alertas_email" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "receber_alertas_email" BOOLEAN NOT NULL DEFAULT false;
