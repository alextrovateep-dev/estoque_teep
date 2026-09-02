/** Famílias de unidade com conversão entre si (fator → unidade base da família). */
export type UnidadeMedidaDef = {
  codigo: string;
  label: string;
  familia: "contagem" | "comprimento" | "massa" | "volume";
  /** Multiplicador para converter 1 unidade deste código → base da família. */
  fatorBase: number;
};

export const UNIDADES_MEDIDA: readonly UnidadeMedidaDef[] = [
  { codigo: "UN", label: "Unidade", familia: "contagem", fatorBase: 1 },
  { codigo: "PC", label: "Peça", familia: "contagem", fatorBase: 1 },
  { codigo: "PCT", label: "Pacote", familia: "contagem", fatorBase: 1 },
  { codigo: "CX", label: "Caixa", familia: "contagem", fatorBase: 1 },
  { codigo: "M", label: "Metro", familia: "comprimento", fatorBase: 1 },
  { codigo: "CM", label: "Centímetro", familia: "comprimento", fatorBase: 0.01 },
  { codigo: "MM", label: "Milímetro", familia: "comprimento", fatorBase: 0.001 },
  { codigo: "KG", label: "Quilograma", familia: "massa", fatorBase: 1 },
  { codigo: "G", label: "Grama", familia: "massa", fatorBase: 0.001 },
  { codigo: "L", label: "Litro", familia: "volume", fatorBase: 1 },
  { codigo: "ML", label: "Mililitro", familia: "volume", fatorBase: 0.001 },
] as const;

const ALIAS: Record<string, string> = {
  UNID: "UN",
  UNIDADE: "UN",
  UND: "UN",
  MT: "M",
  MTS: "M",
  METRO: "M",
  METROS: "M",
  CENTIMETRO: "CM",
  CENTIMETROS: "CM",
  MILIMETRO: "MM",
  MILIMETROS: "MM",
  QUILO: "KG",
  QUILOGRAMA: "KG",
  GRAMA: "G",
  GRAMAS: "G",
  LITRO: "L",
  LITROS: "L",
  MILILITRO: "ML",
  MILILITROS: "ML",
};

const MAP = new Map<string, UnidadeMedidaDef>(
  UNIDADES_MEDIDA.map((u) => [u.codigo, u])
);

/** Normaliza código de unidade (maiúsculas, sem pontos, aliases comuns). */
export function normalizarUnidade(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\./g, "");
  if (!s) return "UN";
  return ALIAS[s] ?? s.slice(0, 10);
}

export function unidadeLabel(codigo: string): string {
  const n = normalizarUnidade(codigo);
  return MAP.get(n)?.label ?? n;
}

export function familiaUnidade(codigo: string): UnidadeMedidaDef["familia"] | null {
  const n = normalizarUnidade(codigo);
  return MAP.get(n)?.familia ?? null;
}

export function unidadesConvertiveis(de: string, para: string): boolean {
  const a = normalizarUnidade(de);
  const b = normalizarUnidade(para);
  if (a === b) return true;
  const fa = familiaUnidade(a);
  const fb = familiaUnidade(b);
  return fa !== null && fa === fb;
}

function fatorParaBase(codigo: string): number | null {
  const n = normalizarUnidade(codigo);
  const def = MAP.get(n);
  if (!def) return null;
  return def.fatorBase;
}

/** Converte quantidade entre unidades da mesma família. Retorna null se incompatível. */
export function converterQuantidade(
  qty: number,
  de: string,
  para: string
): number | null {
  if (!Number.isFinite(qty)) return null;
  const origem = normalizarUnidade(de);
  const destino = normalizarUnidade(para);
  if (origem === destino) return qty;
  if (!unidadesConvertiveis(origem, destino)) return null;
  const fDe = fatorParaBase(origem);
  const fPara = fatorParaBase(destino);
  if (fDe == null || fPara == null) return null;
  const emBase = qty * fDe;
  return emBase / fPara;
}

/** Unidades da mesma família que `codigo` (inclui o próprio). */
export function unidadesDaFamilia(codigo: string): UnidadeMedidaDef[] {
  const fam = familiaUnidade(codigo);
  if (!fam) return [];
  return UNIDADES_MEDIDA.filter((u) => u.familia === fam);
}

export function formatQtyUnidade(
  qty: number,
  unidade: string,
  opts?: { maxDecimals?: number }
): string {
  const u = normalizarUnidade(unidade);
  const n = qty.toLocaleString("pt-BR", {
    maximumFractionDigits: opts?.maxDecimals ?? 4,
  });
  return `${n} ${u}`;
}

/** Preço por unidade de estoque → equivalente na unidade de exibição. */
export function precoPorUnidadeExibicao(
  precoUnitario: number,
  unidadeEstoque: string,
  unidadeExibicao: string
): number | null {
  const fator = converterQuantidade(1, unidadeEstoque, unidadeExibicao);
  if (fator == null) return null;
  return precoUnitario * fator;
}
