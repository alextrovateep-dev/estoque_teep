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

const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function dvCnpj(base: string, weights: number[]): number {
  const sum = [...base].reduce((acc, n, i) => acc + Number(n) * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** CNPJ com 14 dígitos e dígitos verificadores válidos (ignora pontuação). */
export function isValidCnpj(value: string | null | undefined): boolean {
  const d = onlyDigits(value || "");
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const d1 = dvCnpj(d.slice(0, 12), CNPJ_W1);
  const d2 = dvCnpj(d.slice(0, 12) + String(d1), CNPJ_W2);
  return d[12] === String(d1) && d[13] === String(d2);
}

export const MSG_CNPJ_OBRIGATORIO =
  "CNPJ é obrigatório e deve ser válido (00.000.000/0000-00).";
export const MSG_CNPJ_INVALIDO = "Informe um CNPJ válido.";

/** Tipos de cadastro que exigem CNPJ. */
export function tipoExigeCnpj(tipo: string | null | undefined): boolean {
  return tipo === "CLIENTE" || tipo === "FORNECEDOR";
}

/** CNPJ válido (filial 0001) a partir da raiz de até 8 dígitos — testes/smoke. */
export function cnpjFromRaiz(raiz: string): string {
  const r = onlyDigits(raiz).padStart(8, "0").slice(-8);
  const base = `${r}0001`;
  const d1 = dvCnpj(base, CNPJ_W1);
  const d2 = dvCnpj(base + String(d1), CNPJ_W2);
  return formatCnpj(`${base}${d1}${d2}`);
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
