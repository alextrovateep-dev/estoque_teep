export type ItemSaidaPedido = {
  produtoId: string;
  quantidade: number;
  series?: string[];
};

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
