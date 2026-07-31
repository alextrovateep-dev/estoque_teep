/** Normalização de CPF/CNPJ compartilhada (API + web). */

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Máscara completa de CNPJ (14 dígitos). Caso contrário devolve só dígitos. */
export function formatCnpj(digitsOrMasked: string): string {
  const d = onlyDigits(digitsOrMasked).slice(0, 14);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Máscara CEP (8 dígitos → 00000-000). */
export function formatCep(digitsOrMasked: string): string | null {
  const d = onlyDigits(digitsOrMasked).slice(0, 8);
  if (!d) return null;
  if (d.length !== 8) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * Normaliza documento para gravação:
 * - 14 dígitos → CNPJ mascarado
 * - demais → trim ou null
 */
export function normalizeDocumento(
  doc: string | null | undefined
): string | null {
  if (doc == null) return null;
  const trimmed = String(doc).trim();
  if (!trimmed) return null;
  const digits = onlyDigits(trimmed);
  if (digits.length === 14) return formatCnpj(digits);
  return trimmed.slice(0, 20);
}

export function sameDocumento(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const da = onlyDigits(a || "");
  const db = onlyDigits(b || "");
  if (!da || !db) return false;
  return da === db;
}
