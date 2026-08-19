ALTER TABLE "filiais"
  ADD COLUMN "estoque_acabados" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "tipos_movimentacao"
  ADD COLUMN "saida_pedido_venda" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "tipos_movimentacao_saida_pedido_venda_key"
  ON "tipos_movimentacao" ("saida_pedido_venda")
  WHERE "saida_pedido_venda" = true;

CREATE TABLE "pedidos_venda" (
  "id" UUID NOT NULL,
  "egestor_codigo" INTEGER NOT NULL,
  "nome_contato" VARCHAR(150) NOT NULL,
  "cod_contato" INTEGER,
  "dt_venda" DATE NOT NULL,
  "situacao" INTEGER NOT NULL,
  "situacao_os" VARCHAR(40),
  "valor_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
  "filial_acabado_id" UUID,
  "separado_em" TIMESTAMPTZ,
  "separado_por_id" UUID,
  "grupo_lancamento_id" UUID,
  "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pedidos_venda_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pedidos_venda_egestor_codigo_key" ON "pedidos_venda"("egestor_codigo");
CREATE INDEX "pedidos_venda_status_idx" ON "pedidos_venda"("status");
CREATE INDEX "pedidos_venda_dt_venda_idx" ON "pedidos_venda"("dt_venda");
CREATE INDEX "pedidos_venda_grupo_lancamento_id_idx" ON "pedidos_venda"("grupo_lancamento_id");

CREATE TABLE "pedido_venda_itens" (
  "id" UUID NOT NULL,
  "pedido_id" UUID NOT NULL,
  "egestor_item_codigo" INTEGER,
  "codigo_proprio" VARCHAR(80) NOT NULL,
  "descricao" VARCHAR(200) NOT NULL,
  "quantidade" DECIMAL(12,4) NOT NULL,
  "produto_id" UUID,
  CONSTRAINT "pedido_venda_itens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pedido_venda_itens_pedido_id_egestor_item_codigo_key"
  ON "pedido_venda_itens"("pedido_id", "egestor_item_codigo");
CREATE INDEX "pedido_venda_itens_pedido_id_idx" ON "pedido_venda_itens"("pedido_id");
CREATE INDEX "pedido_venda_itens_produto_id_idx" ON "pedido_venda_itens"("produto_id");

CREATE TABLE "pedido_venda_destinatarios" (
  "id" UUID NOT NULL,
  "pedido_id" UUID NOT NULL,
  "usuario_id" UUID NOT NULL,
  CONSTRAINT "pedido_venda_destinatarios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pedido_venda_destinatarios_pedido_id_usuario_id_key"
  ON "pedido_venda_destinatarios"("pedido_id", "usuario_id");
CREATE INDEX "pedido_venda_destinatarios_usuario_id_idx" ON "pedido_venda_destinatarios"("usuario_id");

ALTER TABLE "pedidos_venda"
  ADD CONSTRAINT "pedidos_venda_filial_acabado_id_fkey"
  FOREIGN KEY ("filial_acabado_id") REFERENCES "filiais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pedidos_venda"
  ADD CONSTRAINT "pedidos_venda_separado_por_id_fkey"
  FOREIGN KEY ("separado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pedido_venda_itens"
  ADD CONSTRAINT "pedido_venda_itens_pedido_id_fkey"
  FOREIGN KEY ("pedido_id") REFERENCES "pedidos_venda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pedido_venda_itens"
  ADD CONSTRAINT "pedido_venda_itens_produto_id_fkey"
  FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pedido_venda_destinatarios"
  ADD CONSTRAINT "pedido_venda_destinatarios_pedido_id_fkey"
  FOREIGN KEY ("pedido_id") REFERENCES "pedidos_venda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pedido_venda_destinatarios"
  ADD CONSTRAINT "pedido_venda_destinatarios_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
