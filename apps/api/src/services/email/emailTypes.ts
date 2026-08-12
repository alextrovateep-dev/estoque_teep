import type { AlertaEvento } from "@teep/shared";

/** Alertas de estoque (opt-in D33 + allowlist). */
export type AlertaEmailType = AlertaEvento;

/** Conta / acesso — sempre transacional, sem opt-in de alerta. */
export type ContaEmailType = "ACESSO_SENHA_PROVISORIA";

/** Tipos de e-mail transacional (union fechada). */
export type EmailType = AlertaEmailType | ContaEmailType;

export const ALERTA_EMAIL_TYPES: readonly AlertaEmailType[] = [
  "ESTOQUE_MINIMO",
  "ESTOQUE_MAXIMO",
  "PRECO_AJUSTADO",
  "DIVERGENCIA_TRANSFERENCIA",
  "ALERTA_RETORNO_MOVIMENTACAO",
  "TRANSFERENCIA_PENDENTE_APROVACAO",
  "TRANSFERENCIA_APROVADA",
  "TRANSFERENCIA_REJEITADA",
  "RMA_ABERTO",
  "RMA_FINANCEIRO",
  "RMA_ENCERRADO",
  "RMA_LAUDO",
] as const;

export const CONTA_EMAIL_TYPES: readonly ContaEmailType[] = [
  "ACESSO_SENHA_PROVISORIA",
] as const;

export const EMAIL_TYPES: readonly EmailType[] = [
  ...ALERTA_EMAIL_TYPES,
  ...CONTA_EMAIL_TYPES,
] as const;
