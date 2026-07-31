-- CreateTable
CREATE TABLE "filiais" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "sigla" VARCHAR(5) NOT NULL,
    "cidade" VARCHAR(80),
    "estado" CHAR(2),
    "responsavel" VARCHAR(100),
    "email_contato" VARCHAR(100),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filiais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "perfil" VARCHAR(30) NOT NULL,
    "filial_id" UUID,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "descricao" VARCHAR(150) NOT NULL,
    "categoria_id" UUID NOT NULL,
    "unidade" VARCHAR(10) NOT NULL DEFAULT 'UN',
    "preco_unitario" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "estoque_minimo" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "documento" VARCHAR(20),
    "tipo" VARCHAR(15) NOT NULL,
    "email" VARCHAR(100),
    "telefone" VARCHAR(20),
    "cidade" VARCHAR(50),
    "estado" CHAR(2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_movimentacao" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "operacao" VARCHAR(7) NOT NULL,
    "requer_cliente" BOOLEAN NOT NULL DEFAULT false,
    "requer_aprovacao" BOOLEAN NOT NULL DEFAULT false,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipos_movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estoques" (
    "id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "saldo_atual" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "atualizado_em" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "estoques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes" (
    "id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "tipo_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "cliente_id" UUID,
    "filial_id" UUID NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "preco_unitario" DECIMAL(12,2) NOT NULL,
    "operacao" VARCHAR(7) NOT NULL,
    "observacao" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'CONCLUIDO',
    "estorno_de_id" UUID,
    "transferencia_item_id" UUID,
    "data_movimento" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencias" (
    "id" UUID NOT NULL,
    "origem_filial_id" UUID NOT NULL,
    "destino_filial_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "guia_transporte" VARCHAR(120),
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "transferencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencia_itens" (
    "id" UUID NOT NULL,
    "transferencia_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "qtd_enviada" DECIMAL(12,4) NOT NULL,
    "qtd_recebida" DECIMAL(12,4),

    CONSTRAINT "transferencia_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes_alertas" (
    "id" UUID NOT NULL,
    "evento" VARCHAR(60) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "canal_email" BOOLEAN NOT NULL DEFAULT true,
    "canal_push" BOOLEAN NOT NULL DEFAULT false,
    "destinatarios" TEXT NOT NULL,
    "tipo_id" UUID,
    "descricao" TEXT,

    CONSTRAINT "configuracoes_alertas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "filiais_nome_key" ON "filiais"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "filiais_sigla_key" ON "filiais"("sigla");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_nome_key" ON "categorias"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "produtos_codigo_key" ON "produtos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_documento_key" ON "clientes"("documento");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_movimentacao_nome_key" ON "tipos_movimentacao"("nome");

-- CreateIndex
CREATE INDEX "estoques_produto_id_idx" ON "estoques"("produto_id");

-- CreateIndex
CREATE INDEX "estoques_filial_id_idx" ON "estoques"("filial_id");

-- CreateIndex
CREATE UNIQUE INDEX "estoques_produto_id_filial_id_key" ON "estoques"("produto_id", "filial_id");

-- CreateIndex
CREATE INDEX "movimentacoes_produto_id_idx" ON "movimentacoes"("produto_id");

-- CreateIndex
CREATE INDEX "movimentacoes_filial_id_idx" ON "movimentacoes"("filial_id");

-- CreateIndex
CREATE INDEX "movimentacoes_data_movimento_idx" ON "movimentacoes"("data_movimento");

-- CreateIndex
CREATE INDEX "movimentacoes_cliente_id_idx" ON "movimentacoes"("cliente_id");

-- CreateIndex
CREATE INDEX "movimentacoes_status_idx" ON "movimentacoes"("status");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filiais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoques" ADD CONSTRAINT "estoques_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoques" ADD CONSTRAINT "estoques_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "tipos_movimentacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_estorno_de_id_fkey" FOREIGN KEY ("estorno_de_id") REFERENCES "movimentacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_transferencia_item_id_fkey" FOREIGN KEY ("transferencia_item_id") REFERENCES "transferencia_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_origem_filial_id_fkey" FOREIGN KEY ("origem_filial_id") REFERENCES "filiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_destino_filial_id_fkey" FOREIGN KEY ("destino_filial_id") REFERENCES "filiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_itens" ADD CONSTRAINT "transferencia_itens_transferencia_id_fkey" FOREIGN KEY ("transferencia_id") REFERENCES "transferencias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_itens" ADD CONSTRAINT "transferencia_itens_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_alertas" ADD CONSTRAINT "configuracoes_alertas_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "tipos_movimentacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
