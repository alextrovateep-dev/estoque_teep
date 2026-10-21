/** Busca de produto em saldos: código exato ganha de prefixo (TMP-1144-W ≠ TMP-1144-WE). */

/** Códigos já fechados (vírgula/ponto-e-vírgula). */
export function tokensCodigoProduto(qRaw: string): string[] {
  return qRaw
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Trecho depois da última vírgula — o que a lista de sugestão deve buscar. */
export function tokenDigitandoCodigoProduto(qRaw: string): string {
  const sep = Math.max(qRaw.lastIndexOf(","), qRaw.lastIndexOf(";"));
  if (sep < 0) return qRaw.trim();
  return qRaw.slice(sep + 1).trim();
}

export function juntarCodigosProduto(codigos: string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of codigos) {
    const t = c.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(", ");
}

/** Códigos já escolhidos, sem o trecho ainda sendo digitado. */
export function tokensCodigoProdutoTravados(
  qRaw: string,
  rows?: Array<{ codigo: string }>
): string[] {
  const parts = tokensCodigoProduto(qRaw);
  if (/[,;]\s*$/.test(qRaw)) return parts;
  if (parts.length <= 1) return [];
  const last = parts[parts.length - 1]!;
  if (rows && temCodigoProdutoExato(rows, last)) return parts;
  return parts.slice(0, -1);
}

/** Selecionou um código: troca o trecho atual e deixa vírgula para o próximo. */
export function aplicarCodigoProdutoLista(atual: string, codigo: string): string {
  const selected = codigo.trim();
  if (!selected) return atual;
  const endsSep = /[,;]\s*$/.test(atual);
  const parts = tokensCodigoProduto(atual);
  const locked = endsSep ? parts : parts.slice(0, Math.max(0, parts.length - 1));
  const next = juntarCodigosProduto([...locked, selected]);
  return next ? `${next}, ` : "";
}

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

/** Vários códigos (vírgula): OR, cada um com a regra de código exato. */
export function matchSaldoProdutoLista(
  s: { codigo: string; descricao: string },
  qRaw: string,
  rows: Array<{ codigo: string }>
): boolean {
  const tokens = tokensCodigoProduto(qRaw);
  if (tokens.length === 0) return true;
  return tokens.some((t) =>
    matchSaldoProduto(s, t, temCodigoProdutoExato(rows, t))
  );
}
