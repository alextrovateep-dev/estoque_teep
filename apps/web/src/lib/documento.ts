import {
  formatCep as formatCepFull,
  formatCnpj as formatCnpjFull,
  onlyDigits,
} from "@teep/shared";

export { onlyDigits };

/** Máscara progressiva ao digitar (web). */
export function formatCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length === 14) return formatCnpjFull(d);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  }
  return formatCnpjFull(d);
}

/** Máscara progressiva de CEP. */
export function formatCepInput(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function formatCep(value: string): string | null {
  return formatCepFull(value);
}

/** Match por nome ou documento (com/sem pontuação). */
export function matchNomeOuDocumento(
  nome: string,
  documento: string | null | undefined,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const qDigits = onlyDigits(q);
  if (nome.toLowerCase().includes(q)) return true;
  const doc = documento || "";
  if (doc.toLowerCase().includes(q)) return true;
  if (qDigits.length >= 3 && onlyDigits(doc).includes(qDigits)) return true;
  return false;
}
