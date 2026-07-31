-- Permissões de tela/ação por usuário (moderação no cadastro)
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "permissoes" JSONB NOT NULL DEFAULT '{}';
