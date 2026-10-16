/** Busca de produto em saldos: código exato ganha de prefixo (TMP-1144-W ≠ TMP-1144-WE). */
export function temCodigoProdutoExato(
  rows: Array<{ codigo: string }>,
  qRaw: string
): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return false;
  return rows.some((s) => s.codigo.toLowerCase() === q);
}

export function matchSaldoProduto(
  s: { codigo: string; descricao: string },
  qRaw: string,
  codigoExato: boolean
): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  if (codigoExato) return s.codigo.toLowerCase() === q;
  return (
    s.codigo.toLowerCase().includes(q) ||
    s.descricao.toLowerCase().includes(q)
  );
}
