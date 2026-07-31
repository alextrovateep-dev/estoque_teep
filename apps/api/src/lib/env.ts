/**
 * Validação mínima de ambiente em produção (F11).
 * Falha cedo se secrets padrão ou curtos forem usados no go-live.
 */

const WEAK_JWT_MARKERS = [
  "change-me",
  "dev-access-secret",
  "dev-refresh-secret",
  "min-32-chars",
];

function isWeakSecret(value: string | undefined): boolean {
  if (!value || value.length < 32) return true;
  const lower = value.toLowerCase();
  return WEAK_JWT_MARKERS.some((m) => lower.includes(m));
}

/** Retorna lista de erros; vazio = ok. Em non-production sempre []. */
export function validateProductionEnv(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (env.NODE_ENV !== "production") return [];

  const errors: string[] = [];

  if (isWeakSecret(env.JWT_ACCESS_SECRET)) {
    errors.push(
      "JWT_ACCESS_SECRET deve ter ≥32 chars e não pode ser o valor de exemplo"
    );
  }
  if (isWeakSecret(env.JWT_REFRESH_SECRET)) {
    errors.push(
      "JWT_REFRESH_SECRET deve ter ≥32 chars e não pode ser o valor de exemplo"
    );
  }
  if (!env.DATABASE_URL) {
    errors.push("DATABASE_URL é obrigatório");
  }
  if (!env.CORS_ORIGIN || env.CORS_ORIGIN.includes("localhost")) {
    errors.push(
      "CORS_ORIGIN deve apontar para o domínio público (ex.: https://estoque.teep.com.br)"
    );
  }

  return errors;
}

export function assertProductionEnv(): void {
  const errors = validateProductionEnv();
  if (!errors.length) return;
  console.error("[env] Ambiente de produção inválido:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
