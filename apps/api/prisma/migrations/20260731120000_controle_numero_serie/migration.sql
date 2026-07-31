-- AlterTable
ALTER TABLE "produtos" ADD COLUMN "controla_serie" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "movimentacoes" ADD COLUMN "series_informadas" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "unidades_serie" (
    "id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "numero_serie" VARCHAR(80) NOT NULL,
    "filial_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "cliente_id" UUID,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "unidades_serie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacao_series" (
    "id" UUID NOT NULL,
    "movimentacao_id" UUID NOT NULL,
    "unidade_serie_id" UUID NOT NULL,

    CONSTRAINT "movimentacao_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencia_item_series" (
    "id" UUID NOT NULL,
    "transferencia_item_id" UUID NOT NULL,
    "unidade_serie_id" UUID NOT NULL,
    "enviado" BOOLEAN NOT NULL DEFAULT true,
    "recebido" BOOLEAN,

    CONSTRAINT "transferencia_item_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unidades_serie_produto_id_status_idx" ON "unidades_serie"("produto_id", "status");

-- CreateIndex
CREATE INDEX "unidades_serie_filial_id_status_idx" ON "unidades_serie"("filial_id", "status");

-- CreateIndex
CREATE INDEX "unidades_serie_numero_serie_idx" ON "unidades_serie"("numero_serie");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_produto_serie" ON "unidades_serie"("produto_id", "numero_serie");

-- CreateIndex
CREATE INDEX "movimentacao_series_unidade_serie_id_idx" ON "movimentacao_series"("unidade_serie_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_mov_serie" ON "movimentacao_series"("movimentacao_id", "unidade_serie_id");

-- CreateIndex
CREATE INDEX "transferencia_item_series_unidade_serie_id_idx" ON "transferencia_item_series"("unidade_serie_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_transf_item_serie" ON "transferencia_item_series"("transferencia_item_id", "unidade_serie_id");

-- AddForeignKey
ALTER TABLE "unidades_serie" ADD CONSTRAINT "unidades_serie_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_serie" ADD CONSTRAINT "unidades_serie_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_serie" ADD CONSTRAINT "unidades_serie_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_series" ADD CONSTRAINT "movimentacao_series_movimentacao_id_fkey" FOREIGN KEY ("movimentacao_id") REFERENCES "movimentacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_series" ADD CONSTRAINT "movimentacao_series_unidade_serie_id_fkey" FOREIGN KEY ("unidade_serie_id") REFERENCES "unidades_serie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_item_series" ADD CONSTRAINT "transferencia_item_series_transferencia_item_id_fkey" FOREIGN KEY ("transferencia_item_id") REFERENCES "transferencia_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_item_series" ADD CONSTRAINT "transferencia_item_series_unidade_serie_id_fkey" FOREIGN KEY ("unidade_serie_id") REFERENCES "unidades_serie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
