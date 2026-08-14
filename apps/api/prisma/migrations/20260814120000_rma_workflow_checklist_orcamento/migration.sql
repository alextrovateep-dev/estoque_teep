-- RMA ampliado: etapas + checklist por produto + diagnóstico/plano/orçamento

UPDATE "rma_itens"
SET "etapa" = 'AGUARDANDO_RECEBIMENTO'
WHERE "etapa" = 'AGUARDANDO_LAUDO';

ALTER TABLE "rma_itens"
  ALTER COLUMN "etapa" SET DEFAULT 'AGUARDANDO_RECEBIMENTO';

CREATE TABLE "rma_checklist_templates" (
    "id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "rma_checklist_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rma_checklist_template_itens" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "codigo" VARCHAR(40) NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "ajuda" TEXT,
    "tipo_campo" VARCHAR(20) NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "opcoes_json" JSONB,
    "exige_foto_se" VARCHAR(40),
    CONSTRAINT "rma_checklist_template_itens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rma_checklist_execucoes" (
    "id" UUID NOT NULL,
    "rma_item_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'EM_PREENCHIMENTO',
    "preenchido_por_id" UUID,
    "concluido_em" TIMESTAMPTZ,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "rma_checklist_execucoes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rma_checklist_respostas" (
    "id" UUID NOT NULL,
    "execucao_id" UUID NOT NULL,
    "template_item_id" UUID NOT NULL,
    "valor_texto" TEXT,
    "valor_bool" BOOLEAN,
    "fotos" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "rma_checklist_respostas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rma_diagnosticos" (
    "id" UUID NOT NULL,
    "rma_item_id" UUID NOT NULL,
    "resumo_problema" TEXT NOT NULL,
    "observacao_tecnica" TEXT,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "rma_diagnosticos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rma_manutencao_planos" (
    "id" UUID NOT NULL,
    "rma_item_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "rma_manutencao_planos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rma_manutencao_servicos" (
    "id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "descricao" VARCHAR(300) NOT NULL,
    CONSTRAINT "rma_manutencao_servicos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rma_manutencao_pecas" (
    "id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "motivo" VARCHAR(300),
    CONSTRAINT "rma_manutencao_pecas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rma_orcamentos" (
    "id" UUID NOT NULL,
    "rma_item_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
    "mao_de_obra" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "observacao_comercial" TEXT,
    "enviado_em" TIMESTAMPTZ,
    "aprovado_em" TIMESTAMPTZ,
    "aprovado_por_id" UUID,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "rma_orcamentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rma_orcamento_linhas" (
    "id" UUID NOT NULL,
    "orcamento_id" UUID NOT NULL,
    "descricao" VARCHAR(300) NOT NULL,
    "produto_id" UUID,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "valor_unitario" DECIMAL(12,2) NOT NULL,
    "origem" VARCHAR(20) NOT NULL DEFAULT 'EXTRA',
    CONSTRAINT "rma_orcamento_linhas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rma_checklist_templates_produto_tipo_ativo_key" ON "rma_checklist_templates"("produto_id", "tipo") WHERE "ativo" = true;
CREATE INDEX "rma_checklist_templates_produto_id_tipo_idx" ON "rma_checklist_templates"("produto_id", "tipo");
CREATE INDEX "rma_checklist_templates_tipo_ativo_idx" ON "rma_checklist_templates"("tipo", "ativo");
CREATE INDEX "rma_checklist_template_itens_template_id_ordem_idx" ON "rma_checklist_template_itens"("template_id", "ordem");
CREATE UNIQUE INDEX "rma_checklist_execucoes_rma_item_id_tipo_key" ON "rma_checklist_execucoes"("rma_item_id", "tipo");
CREATE INDEX "rma_checklist_execucoes_template_id_idx" ON "rma_checklist_execucoes"("template_id");
CREATE INDEX "rma_checklist_execucoes_status_idx" ON "rma_checklist_execucoes"("status");
CREATE UNIQUE INDEX "rma_checklist_respostas_execucao_id_template_item_id_key" ON "rma_checklist_respostas"("execucao_id", "template_item_id");
CREATE UNIQUE INDEX "rma_diagnosticos_rma_item_id_key" ON "rma_diagnosticos"("rma_item_id");
CREATE UNIQUE INDEX "rma_manutencao_planos_rma_item_id_key" ON "rma_manutencao_planos"("rma_item_id");
CREATE INDEX "rma_manutencao_servicos_plano_id_ordem_idx" ON "rma_manutencao_servicos"("plano_id", "ordem");
CREATE INDEX "rma_manutencao_pecas_plano_id_idx" ON "rma_manutencao_pecas"("plano_id");
CREATE INDEX "rma_manutencao_pecas_produto_id_idx" ON "rma_manutencao_pecas"("produto_id");
CREATE UNIQUE INDEX "rma_orcamentos_rma_item_id_key" ON "rma_orcamentos"("rma_item_id");
CREATE INDEX "rma_orcamentos_status_idx" ON "rma_orcamentos"("status");
CREATE INDEX "rma_orcamento_linhas_orcamento_id_idx" ON "rma_orcamento_linhas"("orcamento_id");
CREATE INDEX "rma_orcamento_linhas_produto_id_idx" ON "rma_orcamento_linhas"("produto_id");

ALTER TABLE "rma_checklist_templates" ADD CONSTRAINT "rma_checklist_templates_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_checklist_template_itens" ADD CONSTRAINT "rma_checklist_template_itens_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "rma_checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_checklist_execucoes" ADD CONSTRAINT "rma_checklist_execucoes_rma_item_id_fkey" FOREIGN KEY ("rma_item_id") REFERENCES "rma_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_checklist_execucoes" ADD CONSTRAINT "rma_checklist_execucoes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "rma_checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rma_checklist_execucoes" ADD CONSTRAINT "rma_checklist_execucoes_preenchido_por_id_fkey" FOREIGN KEY ("preenchido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rma_checklist_respostas" ADD CONSTRAINT "rma_checklist_respostas_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "rma_checklist_execucoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_checklist_respostas" ADD CONSTRAINT "rma_checklist_respostas_template_item_id_fkey" FOREIGN KEY ("template_item_id") REFERENCES "rma_checklist_template_itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rma_diagnosticos" ADD CONSTRAINT "rma_diagnosticos_rma_item_id_fkey" FOREIGN KEY ("rma_item_id") REFERENCES "rma_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_manutencao_planos" ADD CONSTRAINT "rma_manutencao_planos_rma_item_id_fkey" FOREIGN KEY ("rma_item_id") REFERENCES "rma_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_manutencao_servicos" ADD CONSTRAINT "rma_manutencao_servicos_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "rma_manutencao_planos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_manutencao_pecas" ADD CONSTRAINT "rma_manutencao_pecas_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "rma_manutencao_planos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_manutencao_pecas" ADD CONSTRAINT "rma_manutencao_pecas_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rma_orcamentos" ADD CONSTRAINT "rma_orcamentos_rma_item_id_fkey" FOREIGN KEY ("rma_item_id") REFERENCES "rma_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_orcamentos" ADD CONSTRAINT "rma_orcamentos_aprovado_por_id_fkey" FOREIGN KEY ("aprovado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rma_orcamento_linhas" ADD CONSTRAINT "rma_orcamento_linhas_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "rma_orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_orcamento_linhas" ADD CONSTRAINT "rma_orcamento_linhas_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
