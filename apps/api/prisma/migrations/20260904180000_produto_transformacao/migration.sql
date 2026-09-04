-- Transformação A→B: histórico com séries origem/destino e movimentações

CREATE TABLE "produto_transformacoes" (
    "id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "produto_origem_id" UUID NOT NULL,
    "unidade_serie_origem_id" UUID NOT NULL,
    "numero_serie_origem" VARCHAR(80) NOT NULL,
    "produto_destino_id" UUID NOT NULL,
    "unidade_serie_destino_id" UUID NOT NULL,
    "numero_serie_destino" VARCHAR(80) NOT NULL,
    "movimentacao_saida_origem_id" UUID NOT NULL,
    "movimentacao_entrada_destino_id" UUID NOT NULL,
    "observacao" TEXT,

    CONSTRAINT "produto_transformacoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "produto_transformacoes_filial_id_criado_em_idx" ON "produto_transformacoes"("filial_id", "criado_em");
CREATE INDEX "produto_transformacoes_produto_origem_id_idx" ON "produto_transformacoes"("produto_origem_id");
CREATE INDEX "produto_transformacoes_produto_destino_id_idx" ON "produto_transformacoes"("produto_destino_id");
CREATE INDEX "produto_transformacoes_unidade_serie_origem_id_idx" ON "produto_transformacoes"("unidade_serie_origem_id");
CREATE INDEX "produto_transformacoes_unidade_serie_destino_id_idx" ON "produto_transformacoes"("unidade_serie_destino_id");
CREATE INDEX "produto_transformacoes_numero_serie_origem_idx" ON "produto_transformacoes"("numero_serie_origem");
CREATE INDEX "produto_transformacoes_numero_serie_destino_idx" ON "produto_transformacoes"("numero_serie_destino");

ALTER TABLE "produto_transformacoes" ADD CONSTRAINT "produto_transformacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produto_transformacoes" ADD CONSTRAINT "produto_transformacoes_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produto_transformacoes" ADD CONSTRAINT "produto_transformacoes_produto_origem_id_fkey" FOREIGN KEY ("produto_origem_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produto_transformacoes" ADD CONSTRAINT "produto_transformacoes_produto_destino_id_fkey" FOREIGN KEY ("produto_destino_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produto_transformacoes" ADD CONSTRAINT "produto_transformacoes_unidade_serie_origem_id_fkey" FOREIGN KEY ("unidade_serie_origem_id") REFERENCES "unidades_serie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produto_transformacoes" ADD CONSTRAINT "produto_transformacoes_unidade_serie_destino_id_fkey" FOREIGN KEY ("unidade_serie_destino_id") REFERENCES "unidades_serie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produto_transformacoes" ADD CONSTRAINT "produto_transformacoes_movimentacao_saida_origem_id_fkey" FOREIGN KEY ("movimentacao_saida_origem_id") REFERENCES "movimentacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produto_transformacoes" ADD CONSTRAINT "produto_transformacoes_movimentacao_entrada_destino_id_fkey" FOREIGN KEY ("movimentacao_entrada_destino_id") REFERENCES "movimentacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
