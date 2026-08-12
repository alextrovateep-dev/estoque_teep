-- Destinatários por processo RMA (snapshot + extras)
CREATE TABLE "rma_destinatarios" (
    "id" UUID NOT NULL,
    "processo_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "origem" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rma_destinatarios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rma_destinatarios_processo_id_usuario_id_key" ON "rma_destinatarios"("processo_id", "usuario_id");
CREATE INDEX "rma_destinatarios_usuario_id_idx" ON "rma_destinatarios"("usuario_id");

ALTER TABLE "rma_destinatarios" ADD CONSTRAINT "rma_destinatarios_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "rma_processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rma_destinatarios" ADD CONSTRAINT "rma_destinatarios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
