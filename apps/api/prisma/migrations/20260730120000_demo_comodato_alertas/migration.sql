-- Demo/Comodato: flags de tipo, vínculo retorno, agendas de alerta, anexos tipados

ALTER TABLE "tipos_movimentacao"
  ADD COLUMN IF NOT EXISTS "gera_alerta_retorno" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "dias_alerta" JSONB NOT NULL DEFAULT '[15,30,45,60]',
  ADD COLUMN IF NOT EXISTS "eh_retorno_de_id" UUID;

CREATE INDEX IF NOT EXISTS "tipos_movimentacao_eh_retorno_de_id_idx"
  ON "tipos_movimentacao"("eh_retorno_de_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tipos_movimentacao_eh_retorno_de_id_fkey'
  ) THEN
    ALTER TABLE "tipos_movimentacao"
      ADD CONSTRAINT "tipos_movimentacao_eh_retorno_de_id_fkey"
      FOREIGN KEY ("eh_retorno_de_id") REFERENCES "tipos_movimentacao"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "movimentacoes"
  ADD COLUMN IF NOT EXISTS "alerta_emails" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "movimentacao_origem_id" UUID;

CREATE INDEX IF NOT EXISTS "movimentacoes_movimentacao_origem_id_idx"
  ON "movimentacoes"("movimentacao_origem_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movimentacoes_movimentacao_origem_id_fkey'
  ) THEN
    ALTER TABLE "movimentacoes"
      ADD CONSTRAINT "movimentacoes_movimentacao_origem_id_fkey"
      FOREIGN KEY ("movimentacao_origem_id") REFERENCES "movimentacoes"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "movimentacao_anexos" (
  "id" UUID NOT NULL,
  "movimentacao_id" UUID NOT NULL,
  "tipo" VARCHAR(40) NOT NULL,
  "arquivo" VARCHAR(255) NOT NULL,
  "label" VARCHAR(120),
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "movimentacao_anexos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "movimentacao_anexos_movimentacao_id_idx"
  ON "movimentacao_anexos"("movimentacao_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movimentacao_anexos_movimentacao_id_fkey'
  ) THEN
    ALTER TABLE "movimentacao_anexos"
      ADD CONSTRAINT "movimentacao_anexos_movimentacao_id_fkey"
      FOREIGN KEY ("movimentacao_id") REFERENCES "movimentacoes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "alerta_retorno_agendas" (
  "id" UUID NOT NULL,
  "movimentacao_id" UUID NOT NULL,
  "dias" INTEGER NOT NULL,
  "agendado_para" DATE NOT NULL,
  "emails_destino" TEXT NOT NULL,
  "enviado_em" TIMESTAMPTZ,
  "cancelado_em" TIMESTAMPTZ,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alerta_retorno_agendas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "alerta_retorno_agendas_movimentacao_id_dias_key"
  ON "alerta_retorno_agendas"("movimentacao_id", "dias");

CREATE INDEX IF NOT EXISTS "alerta_retorno_agendas_agendado_para_enviado_em_cancelado_em_idx"
  ON "alerta_retorno_agendas"("agendado_para", "enviado_em", "cancelado_em");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alerta_retorno_agendas_movimentacao_id_fkey'
  ) THEN
    ALTER TABLE "alerta_retorno_agendas"
      ADD CONSTRAINT "alerta_retorno_agendas_movimentacao_id_fkey"
      FOREIGN KEY ("movimentacao_id") REFERENCES "movimentacoes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
