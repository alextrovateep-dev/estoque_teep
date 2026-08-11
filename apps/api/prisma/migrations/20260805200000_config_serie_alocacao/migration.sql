-- Configuração de formato por produto + histórico de alocações (desfazer)

CREATE TABLE "configuracao_series" (
    "id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "formato" VARCHAR(80) NOT NULL DEFAULT '{codigo}{ano2}{seq4}',
    "geracao_automatica" BOOLEAN NOT NULL DEFAULT true,
    "tamanho_sequencial" INTEGER NOT NULL DEFAULT 4,
    "prefixo_fixo" VARCHAR(20),
    "sufixo_fixo" VARCHAR(20),
    "reiniciar_anual" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "configuracao_series_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "configuracao_series_produto_id_key" ON "configuracao_series"("produto_id");

ALTER TABLE "configuracao_series"
  ADD CONSTRAINT "configuracao_series_produto_id_fkey"
  FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "serie_alocacoes" (
    "id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "ano" INTEGER NOT NULL,
    "sequencial_inicial" INTEGER NOT NULL,
    "sequencial_final" INTEGER NOT NULL,
    "series" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serie_alocacoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "serie_alocacoes_produto_id_status_idx" ON "serie_alocacoes"("produto_id", "status");
CREATE INDEX "serie_alocacoes_usuario_id_status_idx" ON "serie_alocacoes"("usuario_id", "status");

ALTER TABLE "serie_alocacoes"
  ADD CONSTRAINT "serie_alocacoes_produto_id_fkey"
  FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "serie_alocacoes"
  ADD CONSTRAINT "serie_alocacoes_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
