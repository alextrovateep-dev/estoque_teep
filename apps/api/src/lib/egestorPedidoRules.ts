export const EGESTOR_SITUACAO_ORCAMENTO = 10;
export const EGESTOR_SITUACAO_VENDA = 50;
export const EGESTOR_SITUACAO_OS_ESPERA = "em espera";
/** Início da validação TEEP (pedidos abertos ou com data de venda a partir daqui). */
export const EGESTOR_SYNC_DESDE_PADRAO = "2026-08-01";

export type EgestorVendaSummary = {
  codigo: number;
  nomeContato?: string;
  codContato?: number;
  dtVenda?: string;
  dtCad?: string;
  valorTotal?: number;
  situacao?: number;
  situacaoOS?: string;
};

export type EgestorVendaProduto = {
  codigo?: number;
  codProduto?: number;
  tipo?: string;
  tipoProd?: string;
  descricao?: string;
  codigoProprio?: string;
  quant?: number;
};

export function normalizaSituacaoOs(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

/** Orçamento (10) e situação OS “Em espera”. Os dois, sempre. */
export function pedidoEgestorQualifica(row: {
  situacao?: number | null;
  situacaoOS?: string | null;
}): boolean {
  return (
    Number(row.situacao) === EGESTOR_SITUACAO_ORCAMENTO &&
    normalizaSituacaoOs(row.situacaoOS) === EGESTOR_SITUACAO_OS_ESPERA
  );
}

/** Na listagem: orçamento; se situacaoOS já veio e não é espera, nem busca detalhe. */
export function pedidoEgestorCandidatoLista(row: {
  situacao?: number | null;
  situacaoOS?: string | null;
}): boolean {
  if (Number(row.situacao) !== EGESTOR_SITUACAO_ORCAMENTO) return false;
  const os = normalizaSituacaoOs(row.situacaoOS);
  return !os || os === EGESTOR_SITUACAO_OS_ESPERA;
}

export function isoDiaEgestor(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

/** Aberto (dtCad) ou data do pedido (dtVenda) a partir de `desde` (YYYY-MM-DD). */
export function pedidoEgestorNaJanela(
  row: { dtVenda?: string | null; dtCad?: string | null },
  desde: string
): boolean {
  const dias = [isoDiaEgestor(row.dtVenda), isoDiaEgestor(row.dtCad)].filter(
    (d): d is string => Boolean(d)
  );
  if (!dias.length) return false;
  return dias.some((d) => d >= desde);
}

export function isLinhaProdutoEgestor(tipo: unknown): boolean {
  const t = String(tipo ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return t === "produto";
}

/** API real usa `tipo`; dump OpenAPI interno usava `tipoProd`. */
export function tipoLinhaEgestor(p: {
  tipoProd?: unknown;
  tipo?: unknown;
}): unknown {
  return p.tipoProd ?? p.tipo;
}

export function linhasProdutoEgestor<
  T extends { tipoProd?: string; tipo?: string },
>(produtos: T[] | null | undefined): T[] {
  return (produtos || []).filter((p) =>
    isLinhaProdutoEgestor(tipoLinhaEgestor(p))
  );
}

/** Pedido de OS/serviço (só servico, ou carrinho vazio) não entra na fila. */
export function pedidoTemProdutoEgestor(
  produtos:
    | Array<{ tipoProd?: string; tipo?: string }>
    | null
    | undefined
): boolean {
  return linhasProdutoEgestor(produtos).length > 0;
}

export function matchCodigoProduto(
  codigoProprio: string | null | undefined,
  produtoCodigo: string
): boolean {
  return (
    String(codigoProprio ?? "").trim().toLowerCase() ===
    produtoCodigo.trim().toLowerCase()
  );
}
