export type ItemSaidaPedido = {
  produtoId: string;
  quantidade: number;
  series?: string[];
};

export type ItemPedidoExistente = {
  id: string;
  egestorItemCodigo: number | null;
  codigoProprio: string;
};

export type ItemPedidoEntrada = {
  egestorItemCodigo: number;
  codigoProprio: string;
  descricao: string;
  quantidade: number;
  produtoId: string | null;
};

function skuKey(codigo: string) {
  return codigo.trim().toLowerCase();
}

/** Código da linha eGestor, único no pedido (evita colisão no unique). */
export function codigoItemEgestor(
  codigo: unknown,
  idx: number,
  used: Set<number>
): number {
  const n = Number(codigo);
  if (Number.isFinite(n) && Number.isInteger(n) && !used.has(n)) {
    used.add(n);
    return n;
  }
  let fallback = idx + 1;
  while (used.has(fallback)) fallback += 1;
  used.add(fallback);
  return fallback;
}

/**
 * Reusa o UUID da linha TEEP no sync (delete+create gerava "Item do pedido inválido"
 * se a tela ficou aberta). Casa primeiro pelo código da linha eGestor, depois pelo SKU.
 */
export function alinharItensPedidoEgestor(
  existentes: ItemPedidoExistente[],
  entradas: ItemPedidoEntrada[]
): {
  criar: ItemPedidoEntrada[];
  atualizar: Array<ItemPedidoEntrada & { id: string }>;
  removerIds: string[];
} {
  const unused = [...existentes];
  const atualizar: Array<ItemPedidoEntrada & { id: string }> = [];
  const criar: ItemPedidoEntrada[] = [];
  const pending: ItemPedidoEntrada[] = [];

  const take = (pred: (e: ItemPedidoExistente) => boolean) => {
    const i = unused.findIndex(pred);
    if (i < 0) return null;
    return unused.splice(i, 1)[0]!;
  };

  for (const ent of entradas) {
    const hit = take((e) => e.egestorItemCodigo === ent.egestorItemCodigo);
    if (hit) atualizar.push({ id: hit.id, ...ent });
    else pending.push(ent);
  }
  for (const ent of pending) {
    const hit = take((e) => skuKey(e.codigoProprio) === skuKey(ent.codigoProprio));
    if (hit) atualizar.push({ id: hit.id, ...ent });
    else criar.push(ent);
  }

  return { criar, atualizar, removerIds: unused.map((e) => e.id) };
}

/** Agrupa linhas do mesmo SKU (eGestor pode repetir produto). */
export function agruparItensSaidaPedido(
  itens: ItemSaidaPedido[]
): ItemSaidaPedido[] {
  const map = new Map<string, ItemSaidaPedido>();
  for (const item of itens) {
    const prev = map.get(item.produtoId);
    const series = (item.series || []).map((s) => s.trim()).filter(Boolean);
    if (!prev) {
      map.set(item.produtoId, {
        produtoId: item.produtoId,
        quantidade: item.quantidade,
        series: series.length ? [...series] : undefined,
      });
      continue;
    }
    prev.quantidade += item.quantidade;
    if (series.length) {
      prev.series = [...(prev.series || []), ...series];
    }
  }
  return [...map.values()];
}

/**
 * Redistribui as séries da baixa (agrupadas por SKU) nas linhas do pedido.
 * Sobra fica na última linha daquele produto para não sumir da tela.
 */
export function alocarSeriesSeparacao(
  itens: Array<{ id: string; produtoId: string | null; quantidade: number }>,
  seriesPorProduto: Map<string, string[]>
): Record<string, string[]> {
  const pools = new Map<string, string[]>();
  for (const [produtoId, series] of seriesPorProduto) {
    pools.set(
      produtoId,
      series.map((s) => s.trim()).filter(Boolean)
    );
  }
  const out: Record<string, string[]> = {};
  const lastByProduto = new Map<string, string>();
  for (const it of itens) {
    if (!it.produtoId) {
      out[it.id] = [];
      continue;
    }
    const pool = pools.get(it.produtoId) || [];
    const n = Math.max(0, Math.round(Number(it.quantidade) || 0));
    out[it.id] = n > 0 ? pool.splice(0, Math.min(n, pool.length)) : [];
    lastByProduto.set(it.produtoId, it.id);
  }
  for (const [produtoId, lastId] of lastByProduto) {
    const leftover = pools.get(produtoId);
    if (leftover?.length) {
      out[lastId] = [...(out[lastId] || []), ...leftover];
      leftover.length = 0;
    }
  }
  return out;
}
