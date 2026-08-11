-- CreateTable
CREATE TABLE "rma_processos" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
    "nf_entrada_numero" VARCHAR(60),
    "nf_saida_numero" VARCHAR(60),
    "nf_entrada_arquivo" VARCHAR(255),
    "nf_saida_arquivo" VARCHAR(255),
    "cobrou" BOOLEAN,
    "valor_cobrado" DECIMAL(12,2),
    "nf_cobranca_numero" VARCHAR(60),
    "observacao" TEXT,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rma_processos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rma_itens" (
    "id" UUID NOT NULL,
    "processo_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "unidade_serie_id" UUID,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
    "mov_entrada_id" UUID,
    "mov_saida_id" UUID,
    "mov_descarte_id" UUID,
    "observacao" TEXT,

    CONSTRAINT "rma_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rma_anexos" (
    "id" UUID NOT NULL,
    "processo_id" UUID NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "arquivo" VARCHAR(255) NOT NULL,
    "label" VARCHAR(120),
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rma_anexos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rma_processos_cliente_id_idx" ON "rma_processos"("cliente_id");
CREATE INDEX "rma_processos_filial_id_idx" ON "rma_processos"("filial_id");
CREATE INDEX "rma_processos_status_idx" ON "rma_processos"("status");
CREATE INDEX "rma_processos_criado_em_idx" ON "rma_processos"("criado_em");
CREATE INDEX "rma_itens_processo_id_idx" ON "rma_itens"("processo_id");
CREATE INDEX "rma_itens_produto_id_idx" ON "rma_itens"("produto_id");
CREATE INDEX "rma_itens_status_idx" ON "rma_itens"("status");
CREATE INDEX "rma_anexos_processo_id_idx" ON "rma_anexos"("processo_id");

-- AddForeignKey
ALTER TABLE "rma_processos" ADD CONSTRAINT "rma_processos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rma_processos" ADD CONSTRAINT "rma_processos_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rma_processos" ADD CONSTRAINT "rma_processos_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rma_itens" ADD CONSTRAINT "rma_itens_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "rma_processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_itens" ADD CONSTRAINT "rma_itens_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rma_itens" ADD CONSTRAINT "rma_itens_unidade_serie_id_fkey" FOREIGN KEY ("unidade_serie_id") REFERENCES "unidades_serie"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rma_itens" ADD CONSTRAINT "rma_itens_mov_entrada_id_fkey" FOREIGN KEY ("mov_entrada_id") REFERENCES "movimentacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rma_itens" ADD CONSTRAINT "rma_itens_mov_saida_id_fkey" FOREIGN KEY ("mov_saida_id") REFERENCES "movimentacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rma_itens" ADD CONSTRAINT "rma_itens_mov_descarte_id_fkey" FOREIGN KEY ("mov_descarte_id") REFERENCES "movimentacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rma_anexos" ADD CONSTRAINT "rma_anexos_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "rma_processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
