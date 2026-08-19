"use client";

import { api } from "@/lib/api";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { SerieCamposPrefixo } from "@/components/SerieCamposPrefixo";

type Filial = { id: string; nome: string; sigla: string };
type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  controlaSerie?: boolean;
};
type EstoqueRow = {
  produtoId: string;
  codigo: string;
  descricao: string;
  controlaSerie: boolean;
  saldoAtual: number;
  novoSaldo: string;
  /** Séries informadas para o Δ (ajuste). */
  series: string[];
  /** Qtd de séries EM_ESTOQUE nesta filial (resumo). */
  seriesEmEstoque: number;
  /** Lista carregada ao expandir (`null` = ainda não buscou). */
  seriesExistentes: string[] | null;
  /** Erro ao carregar a lista de séries desta linha. */
  seriesErro: string | null;
};

type SerieDisponivel = { id: string; numeroSerie: string };

function toRow(
  p: Produto,
  saldo: number,
  seriesEmEstoque: number,
  old?: EstoqueRow
): EstoqueRow {
  const saldoMudou = old && old.saldoAtual !== saldo;
  return {
    produtoId: p.id,
    codigo: p.codigo,
    descricao: p.descricao,
    controlaSerie: Boolean(p.controlaSerie),
    saldoAtual: saldo,
    novoSaldo: saldoMudou || !old ? String(saldo) : old.novoSaldo,
    series: saldoMudou || !old ? [] : old.series,
    seriesEmEstoque,
    seriesExistentes: saldoMudou || !old ? null : old.seriesExistentes,
    seriesErro: saldoMudou || !old ? null : old.seriesErro,
  };
}

export default function InitEstoquePage() {
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [filialId, setFilialId] = useState("");
  const [rows, setRows] = useState<EstoqueRow[]>([]);
  const [confirmarReinit, setConfirmarReinit] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [estoquesTruncado, setEstoquesTruncado] = useState(false);
  const [expandSerie, setExpandSerie] = useState<string | null>(null);
  const [carregandoSeries, setCarregandoSeries] = useState<string | null>(null);
  const [produtoFiltro, setProdutoFiltro] = useState("");
  const loadGen = useRef(0);

  useEffect(() => {
    api<Filial[]>("/filiais")
      .then((f) => {
        setFiliais(f);
        if (f[0]) setFilialId(f[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!filialId) return;
    const gen = ++loadGen.current;
    setCarregandoLista(true);
    setError("");
    setExpandSerie(null);
    setProdutoFiltro("");
    setRows([]);

    Promise.all([
      api<Produto[]>(`/produtos?limit=2000`),
      api<{
        data: Array<{
          produtoId: string;
          saldoAtual: string | number;
          produto: Produto;
        }>;
        truncado?: boolean;
      }>(`/estoques?filialId=${filialId}&limit=2000`),
      api<Array<{ produtoId: string; quantidade: number }>>(
        `/series/resumo-estoque?filialId=${filialId}`
      ).catch(() => null),
    ])
      .then(([produtos, estoquesRes, serieResumo]) => {
        if (gen !== loadGen.current) return;
        setEstoquesTruncado(Boolean(estoquesRes.truncado));
        const saldoMap = new Map(
          estoquesRes.data.map((e) => [e.produtoId, Number(e.saldoAtual)])
        );
        const serieCountMap = new Map<string, number>();
        if (serieResumo) {
          for (const s of serieResumo) {
            serieCountMap.set(s.produtoId, s.quantidade);
          }
        } else {
          // Fallback 1:1 quando o resumo falhar (produto com série).
          for (const e of estoquesRes.data) {
            if (e.produto?.controlaSerie) {
              serieCountMap.set(e.produtoId, Math.trunc(Number(e.saldoAtual)));
            }
          }
        }

        const byId = new Map(produtos.map((p) => [p.id, p]));
        for (const e of estoquesRes.data) {
          if (!byId.has(e.produtoId) && e.produto) {
            byId.set(e.produtoId, {
              id: e.produto.id,
              codigo: e.produto.codigo,
              descricao: e.produto.descricao,
              controlaSerie: e.produto.controlaSerie,
            });
          }
        }
        const merged = Array.from(byId.values()).sort((a, b) =>
          a.codigo.localeCompare(b.codigo, "pt-BR")
        );

        setRows(
          merged.map((p) => {
            const saldo = saldoMap.get(p.id) ?? 0;
            const seriesCount =
              serieCountMap.get(p.id) ??
              (p.controlaSerie ? Math.trunc(saldo) : 0);
            return toRow(p, saldo, seriesCount);
          })
        );
      })
      .catch((e) => {
        if (gen !== loadGen.current) return;
        setError(e.message);
      })
      .finally(() => {
        if (gen !== loadGen.current) return;
        setCarregandoLista(false);
      });
  }, [filialId]);

  // Busca no servidor se o filtro local não achar (além do take de /produtos).
  useEffect(() => {
    const q = produtoFiltro.trim();
    if (!filialId || q.length < 2 || carregandoLista) return;

    const t = setTimeout(() => {
      const localHit = rows.some(
        (r) =>
          r.codigo.toLowerCase().includes(q.toLowerCase()) ||
          r.descricao.toLowerCase().includes(q.toLowerCase())
      );
      if (localHit) return;

      void (async () => {
        try {
          const encontrados = await api<Produto[]>(
            `/produtos?q=${encodeURIComponent(q)}&limit=100`
          );
          if (!encontrados.length) return;

          const have = new Set(rows.map((r) => r.produtoId));
          const extras = encontrados.filter((p) => !have.has(p.id));
          if (!extras.length) return;

          const enriquecidos = await Promise.all(
            extras.map(async (p) => {
              let saldo = 0;
              let seriesEmEstoque = 0;
              try {
                const s = await api<{ saldoAtual: string | number }>(
                  `/estoques/saldo?produtoId=${encodeURIComponent(p.id)}&filialId=${encodeURIComponent(filialId)}`
                );
                saldo = Number(s.saldoAtual) || 0;
              } catch {
                saldo = 0;
              }
              if (p.controlaSerie && saldo > 0) {
                try {
                  const list = await api<SerieDisponivel[]>(
                    `/series/disponiveis?produtoId=${encodeURIComponent(p.id)}&filialId=${encodeURIComponent(filialId)}`
                  );
                  seriesEmEstoque = list.length;
                } catch {
                  seriesEmEstoque = Math.trunc(saldo);
                }
              }
              return toRow(p, saldo, seriesEmEstoque);
            })
          );

          setRows((prev) => {
            const ids = new Set(prev.map((r) => r.produtoId));
            const novos = enriquecidos.filter((r) => !ids.has(r.produtoId));
            if (!novos.length) return prev;
            return [...prev, ...novos].sort((a, b) =>
              a.codigo.localeCompare(b.codigo, "pt-BR")
            );
          });
        } catch {
          /* silencioso — filtro local continua válido */
        }
      })();
    }, 300);
    return () => clearTimeout(t);
    // rows: leitura pontual no timeout; evita re-disparar a cada edição de saldo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoFiltro, filialId, carregandoLista]);

  const rowsVisiveis = useMemo(() => {
    const q = produtoFiltro.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.codigo.toLowerCase().includes(q) ||
        r.descricao.toLowerCase().includes(q)
    );
  }, [rows, produtoFiltro]);

  async function carregarSeriesExistentes(produtoId: string) {
    if (!filialId) return;
    setCarregandoSeries(produtoId);
    setRows((prev) =>
      prev.map((x) =>
        x.produtoId === produtoId ? { ...x, seriesErro: null } : x
      )
    );
    try {
      const list = await api<SerieDisponivel[]>(
        `/series/disponiveis?produtoId=${encodeURIComponent(produtoId)}&filialId=${encodeURIComponent(filialId)}`
      );
      const numeros = list.map((s) => s.numeroSerie);
      setRows((prev) =>
        prev.map((x) =>
          x.produtoId === produtoId
            ? {
                ...x,
                seriesExistentes: numeros,
                seriesEmEstoque: numeros.length,
                seriesErro: null,
              }
            : x
        )
      );
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Erro ao carregar séries";
      setRows((prev) =>
        prev.map((x) =>
          x.produtoId === produtoId
            ? { ...x, seriesErro: msg, seriesExistentes: null }
            : x
        )
      );
    } finally {
      setCarregandoSeries(null);
    }
  }

  function toggleExpand(produtoId: string, controlaSerie: boolean) {
    if (expandSerie === produtoId) {
      setExpandSerie(null);
      return;
    }
    setExpandSerie(produtoId);
    if (!controlaSerie) return;
    const row = rows.find((r) => r.produtoId === produtoId);
    if (row && (row.seriesExistentes === null || row.seriesErro)) {
      void carregarSeriesExistentes(produtoId);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const itens = rows
        .map((r) => {
          const saldo = Number(r.novoSaldo);
          const delta = saldo - r.saldoAtual;
          const base: {
            produtoId: string;
            saldo: number;
            series?: string[];
          } = {
            produtoId: r.produtoId,
            saldo,
          };
          if (r.controlaSerie && delta !== 0) {
            base.series = r.series;
          } else if (r.controlaSerie && r.saldoAtual === 0 && saldo > 0) {
            base.series = r.series;
          }
          return base;
        })
        .filter((i) => !Number.isNaN(i.saldo));

      for (const r of rows) {
        const saldo = Number(r.novoSaldo);
        const delta = saldo - r.saldoAtual;
        if (!r.controlaSerie || delta === 0) continue;
        const need = Math.abs(delta);
        if (r.series.length !== need) {
          throw new Error(
            `${r.codigo}: informe ${need} série(s) para o ajuste (Δ=${delta})`
          );
        }
      }

      const result = await api<{
        resultados: unknown[];
        alertas?: Array<{ mensagem: string }>;
      }>("/estoques/inicializacao", {
        method: "POST",
        body: JSON.stringify({ filialId, itens, confirmarReinit }),
      });
      const extras = result.alertas?.map((a) => a.mensagem).join(" · ");
      setMsg(
        `Inicialização concluída (${result.resultados.length} itens)` +
          (extras ? ` · ${extras}` : "")
      );
      setConfirmarReinit(false);
      setExpandSerie(null);

      const [estoquesRes, serieResumo] = await Promise.all([
        api<{
          data: Array<{
            produtoId: string;
            saldoAtual: string | number;
            produto?: { controlaSerie?: boolean };
          }>;
        }>(`/estoques?filialId=${filialId}&limit=2000`),
        api<Array<{ produtoId: string; quantidade: number }>>(
          `/series/resumo-estoque?filialId=${filialId}`
        ).catch(() => null),
      ]);
      const map = new Map(
        estoquesRes.data.map((e) => [e.produtoId, Number(e.saldoAtual)])
      );
      const serieCountMap = new Map<string, number>();
      if (serieResumo) {
        for (const s of serieResumo) {
          serieCountMap.set(s.produtoId, s.quantidade);
        }
      }
      setRows((prev) =>
        prev.map((r) => {
          const saldo = map.get(r.produtoId) ?? 0;
          const seriesEmEstoque =
            serieCountMap.get(r.produtoId) ??
            (r.controlaSerie ? Math.trunc(saldo) : 0);
          return {
            ...r,
            saldoAtual: saldo,
            novoSaldo: String(saldo),
            series: [],
            seriesEmEstoque,
            seriesExistentes: null,
            seriesErro: null,
          };
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  const filialLabel =
    filiais.find((f) => f.id === filialId)?.sigla || "—";

  return (
    <>
      <h1 className="text-2xl font-semibold">Inventário / Saldo inicial</h1>
      <p className="mt-1 text-sm text-slate-500">
        Escolha o estoque (filial), localize o produto e ajuste o saldo. Produtos
        com série: use o botão para ver as unidades em estoque e informar as
        séries do ajuste (1 série = 1 unidade).
      </p>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[14rem] flex-1 max-w-md text-sm">
            Estoque (filial)
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={filialId}
              onChange={(e) => setFilialId(e.target.value)}
            >
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.sigla} — {f.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[16rem] flex-1 max-w-lg text-sm">
            Produto
            <div className="mt-1 flex gap-1">
              <input
                type="search"
                value={produtoFiltro}
                onChange={(e) => setProdutoFiltro(e.target.value)}
                placeholder="Código ou descrição…"
                className="w-full rounded-lg border px-3 py-2"
                autoComplete="off"
                disabled={carregandoLista}
              />
              {produtoFiltro ? (
                <button
                  type="button"
                  onClick={() => setProdutoFiltro("")}
                  className="shrink-0 rounded-lg border px-2 text-slate-500 hover:bg-slate-50"
                  title="Limpar filtro"
                >
                  ×
                </button>
              ) : null}
            </div>
          </label>
        </div>

        {estoquesTruncado ? (
          <p className="text-sm text-amber-700">
            Lista truncada — nem todos os saldos foram carregados. Use o filtro
            de produto.
          </p>
        ) : null}

        <p className="text-xs text-slate-500">
          {carregandoLista
            ? `Carregando produtos de ${filialLabel}…`
            : produtoFiltro.trim()
              ? `Exibindo ${rowsVisiveis.length} de ${rows.length} produto(s) · estoque ${filialLabel}`
              : `${rowsVisiveis.length} produto(s) · estoque ${filialLabel}`}
        </p>

        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Atual</th>
                <th className="px-3 py-2">Novo saldo</th>
                <th className="px-3 py-2">Séries</th>
              </tr>
            </thead>
            <tbody>
              {carregandoLista && rowsVisiveis.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Carregando…
                  </td>
                </tr>
              ) : rowsVisiveis.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Nenhum produto encontrado neste estoque / filtro.
                  </td>
                </tr>
              ) : (
                rowsVisiveis.map((r) => {
                  const delta = Number(r.novoSaldo) - r.saldoAtual;
                  const needsSeries = r.controlaSerie && delta !== 0;
                  const aberto = expandSerie === r.produtoId;
                  const qtdSeries =
                    r.seriesExistentes?.length ?? r.seriesEmEstoque;

                  return (
                    <tr key={r.produtoId} className="border-t align-top">
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.codigo}
                        {r.controlaSerie ? (
                          <span className="ml-1 rounded bg-teal-50 px-1 text-[10px] uppercase text-teal-800">
                            Série
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{r.descricao}</td>
                      <td className="px-3 py-2">{r.saldoAtual}
                        {r.controlaSerie ? (
                          <div className="text-[11px] text-slate-500">
                            {qtdSeries} série(s) em estoque
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step={r.controlaSerie ? 1 : "any"}
                          className="w-28 rounded border px-2 py-1"
                          value={r.novoSaldo}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((x) => {
                                if (x.produtoId !== r.produtoId) return x;
                                const novoSaldo = e.target.value;
                                const d = Number(novoSaldo) - x.saldoAtual;
                                const n =
                                  x.controlaSerie &&
                                  Number.isFinite(d) &&
                                  d !== 0
                                    ? Math.min(Math.abs(Math.trunc(d)), 200)
                                    : 0;
                                return {
                                  ...x,
                                  novoSaldo,
                                  series: Array.from(
                                    { length: n },
                                    (_, i) => x.series[i] || ""
                                  ),
                                };
                              })
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 min-w-[16rem]">
                        {!r.controlaSerie ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div className="space-y-2">
                            <button
                              type="button"
                              className="text-sm text-teal-800 underline"
                              onClick={() =>
                                toggleExpand(r.produtoId, r.controlaSerie)
                              }
                            >
                              {aberto ? "Ocultar séries" : "Ver séries"}
                              {qtdSeries > 0 ? ` (${qtdSeries})` : ""}
                              {needsSeries
                                ? ` · informar ${Math.abs(delta)} do ajuste`
                                : ""}
                            </button>

                            {aberto ? (
                              <div className="space-y-2 rounded-lg border border-teal-100 bg-teal-50/40 p-2">
                                <div>
                                  <p className="text-xs font-medium text-slate-600">
                                    {(r.seriesExistentes?.length ??
                                      r.seriesEmEstoque) > 0
                                      ? `${r.seriesExistentes?.length ?? r.seriesEmEstoque} unidade(s) em ${filialLabel}`
                                      : `Séries em ${filialLabel}`}
                                  </p>
                                  {carregandoSeries === r.produtoId ||
                                  (r.seriesExistentes === null &&
                                    !r.seriesErro) ? (
                                    <p className="mt-1 text-xs text-slate-500">
                                      Carregando…
                                    </p>
                                  ) : r.seriesErro ? (
                                    <div className="mt-1 space-y-1">
                                      <p className="text-xs text-rose-700">
                                        {r.seriesErro}
                                      </p>
                                      <button
                                        type="button"
                                        className="text-xs text-teal-800 underline"
                                        onClick={() =>
                                          void carregarSeriesExistentes(
                                            r.produtoId
                                          )
                                        }
                                      >
                                        Tentar de novo
                                      </button>
                                    </div>
                                  ) : (r.seriesExistentes?.length ?? 0) ===
                                    0 ? (
                                    <p className="mt-1 text-xs text-slate-500">
                                      Nenhuma série EM_ESTOQUE nesta filial.
                                    </p>
                                  ) : (
                                    <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                                      {r.seriesExistentes!.map((sn) => (
                                        <li
                                          key={sn}
                                          className="font-mono text-xs text-slate-800"
                                        >
                                          {sn}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>

                                {needsSeries ? (
                                  <SerieCamposPrefixo
                                    codigoProduto={r.codigo}
                                    config={null}
                                    series={r.series}
                                    validarNascimento={delta > 0}
                                    onChangeSerie={(i, full) =>
                                      setRows((prev) =>
                                        prev.map((x) => {
                                          if (x.produtoId !== r.produtoId)
                                            return x;
                                          const series = [...x.series];
                                          while (series.length < i + 1)
                                            series.push("");
                                          series[i] = full;
                                          return { ...x, series };
                                        })
                                      )
                                    }
                                  />
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmarReinit}
            onChange={(e) => setConfirmarReinit(e.target.checked)}
          />
          <span>
            <span className="font-medium text-slate-800">
              Permitir alterar produtos que já têm saldo
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Sem este tique, só é possível definir saldo em produtos zerados.
              Marque apenas se quiser mesmo ajustar estoque já existente.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {msg && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {msg}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || carregandoLista || !filialId}
          className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Salvando…" : "Aplicar inventário"}
        </button>
      </form>
    </>
  );
}
