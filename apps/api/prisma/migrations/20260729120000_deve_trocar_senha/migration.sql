-- F16: senha provisória / troca no primeiro acesso
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "deve_trocar_senha" BOOLEAN NOT NULL DEFAULT false;
