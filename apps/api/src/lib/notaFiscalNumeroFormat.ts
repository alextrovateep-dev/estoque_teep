export type NotaFiscalOperacao =
  | "ENTRADA"
  | "SAIDA"
  | "TRANSFERENCIA"
  | "COBRANCA";

const LABEL: Record<NotaFiscalOperacao, string> = {
  ENTRADA: "entrada",
  SAIDA: "saída",
  TRANSFERENCIA: "transferência",
  COBRANCA: "cobrança",
};

export function normalizarNotaFiscalNumero(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  return t ? t : null;
}

/** Comparação: ignora maiúsculas e espaços. */
export function chaveNotaFiscalNumero(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toLowerCase();
}

export function mesmaNotaFiscalNumero(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizarNotaFiscalNumero(a);
  const nb = normalizarNotaFiscalNumero(b);
  if (!na || !nb) return false;
  return chaveNotaFiscalNumero(na) === chaveNotaFiscalNumero(nb);
}

export function mensagemNotaFiscalDuplicada(
  operacao: NotaFiscalOperacao,
  numero: string
): string {
  return `A NF ${numero.trim()} já foi usada em outra ${LABEL[operacao]}. Confira o número.`;
}
