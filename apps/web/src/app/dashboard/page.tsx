"use client";

import { AssistenteEstoque } from "@/components/AssistenteEstoque";
import { api, apiDownload, getStoredUser, User } from "@/lib/api";
import { userHas } from "@/lib/access";
import { useSerieFiltro } from "@/hooks/useSerieFiltro";
import {
  localUnidadeSerie,
  UNIDADE_SERIE_STATUS_LABEL,
} from "@/lib/serieLabels";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/** Saudação por horário local (calendário do browser). */
function saudacaoPorHora(date = new Date()): "Bom dia" | "Boa tarde" | "Boa noite" {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

type SerieUnidade = {
  id: string;
  numeroSerie: string;
  status: string;
  produto: { id: string; codigo: string; descricao: string };
  filial: { id: string; nome: string; sigla: string } | null;
  cliente: { id: string; nome: string } | null;
  emTransito?: {
    transferenciaId: string;
    origemSigla: string;
    destinoSigla: string;
  } | null;
};

type Dashboard = {
  escopo: {
    perfil: string;
    filialId: string | null;
    consolidado: boolean;
    timezone?: string;
  };
  kpis: {
    posicoesComSaldo: number;
    skusComSaldo: number;
    quantidadeTotal: number | null;
    valorTotal: number | null;
    alertasMinimo: number;
    alertasMaximo?: number;
    alertasEstoque?: number;
    pendentes: number;
    movimentosHoje: number | null;
    movimentos30d: number | null;
  };
  porOperacao30d?: Record<string, number>;
  alertas: Array<{
    produtoId: string;
    codigo: string;
    descricao: string;
    filialId: string;
    filialSigla: string;
    saldoAtual: number;
    estoqueMinimo: number;
    estoqueMaximo?: number;
    tipo?: "MINIMO" | "MAXIMO";
  }>;
  alertasMeta: {
    total: number;
    retornados: number;
    truncado: boolean;
    limite: number;
  };
  saldos: Array<{
    id: string;
    produtoId?: string;
    codigo: string;
    descricao: string;
    categoriaId?: string;
    categoriaNome?: string;
    filialId: string;
    filialSigla: string;
    filialNome: string;
    saldoAtual: number;
    estoqueMinimo: number;
    estoqueMaximo?: number;
    valor: number | null;
    abaixoMinimo: boolean;
    acimaMaximo?: boolean;
    produtoAtivo: boolean;
    controlaSerie?: boolean;
  }>;
  saldosMeta: {
    total: number;
    retornados: number;
    truncado: boolean;
    limite: number;
  };
  filiais: Array<{ id: string; nome: string; sigla: string }>;
};

type Categoria = { id: string; nome: string; ativo: boolean };

function money(n: number) {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function qty(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [filialId, setFilialId] = useState("");
  const [produtoQ, setProdutoQ] = useState("");
  const [produtoFiltro, setProdutoFiltro] = useState("");
  const [produtoOpen, setProdutoOpen] = useState(false);
  const [categoriaId, setCategoriaId] = useState("");
  const [filialTabelaId, setFilialTabelaId] = useState("");
  const [soAlertas, setSoAlertas] = useState(false);
  const {
    serieQ,
    serieFiltro,
    serieAtiva,
    limparSerie,
    onSerieChange,
    onSerieKeyDown,
  } = useSerieFiltro({ replacePath: "/dashboard", bootstrapFromUrl: true });
  const [seriesMatch, setSeriesMatch] = useState<SerieUnidade[]>([]);
  const [serieTruncado, setSerieTruncado] = useState(false);
  const [serieLoading, setSerieLoading] = useState(false);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  /** Linha expandida: séries EM_ESTOQUE (produto×filial). */
  const [expandSeriesId, setExpandSeriesId] = useState<string | null>(null);
  const [seriesPorLinha, setSeriesPorLinha] = useState<
    Record<string, { loading: boolean; numeros: string[]; error?: string }>
  >({});

  const isOpsManager =
    user?.perfil === "ADMIN" || user?.perfil === "GERENTE";
  const canMovimentacoes = Boolean(user && userHas(user, "movimentacoes"));

  useEffect(() => {
    setUser(getStoredUser());
    api<Categoria[]>("/categorias")
      .then((c) => setCategorias(c.filter((x) => x.ativo)))
      .catch(() => setCategorias([]));
  }, []);

  useEffect(() => {
    if (!serieAtiva) {
      setSeriesMatch([]);
      setSerieTruncado(false);
      setSerieLoading(false);
      return;
    }
    let cancelled = false;
    setSerieLoading(true);
    const params = new URLSearchParams({ q: serieFiltro.trim() });
    const filialEscopo =
      (isOpsManager && filialId) || filialTabelaId || "";
    if (filialEscopo) params.set("filialId", filialEscopo);
    api<{ data: SerieUnidade[]; truncado?: boolean }>(
      `/series?${params}`
    )
      .then((r) => {
        if (cancelled) return;
        setSeriesMatch(r.data || []);
        setSerieTruncado(Boolean(r.truncado));
      })
      .catch(() => {
        if (cancelled) return;
        setSeriesMatch([]);
        setSerieTruncado(false);
      })
      .finally(() => {
        if (!cancelled) setSerieLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serieAtiva, serieFiltro, filialId, filialTabelaId, isOpsManager]);

  useEffect(() => {
    if (!user) return;
    const ac = new AbortController();
    setLoading(true);
    setError("");
    setSelecionados(new Set());
    setFilialTabelaId("");
    setExpandSeriesId(null);
    setSeriesPorLinha({});
    const params = new URLSearchParams();
    if (isOpsManager && filialId) params.set("filialId", filialId);
    api<Dashboard>(`/dashboard${params.toString() ? `?${params}` : ""}`, {
      signal: ac.signal,
    })
      .then((d) => {
        if (!ac.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Falha ao carregar dashboard");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [user, filialId, isOpsManager]);

  const saldosFiltrados = useMemo(() => {
    if (!data) return [];
    const q = produtoFiltro.trim().toLowerCase();
    return data.saldos.filter((s) => {
      if (categoriaId && s.categoriaId !== categoriaId) return false;
      if (filialTabelaId && s.filialId !== filialTabelaId) return false;
      if (soAlertas && !(s.abaixoMinimo || s.acimaMaximo)) return false;
      if (serieAtiva) {
        if (serieLoading) return false;
        const match = seriesMatch.some(
          (u) =>
            u.status === "EM_ESTOQUE" &&
            u.filial?.id === s.filialId &&
            (s.produtoId
              ? u.produto.id === s.produtoId
              : u.produto.codigo === s.codigo)
        );
        if (!match) return false;
      }
      if (!q) return true;
      return (
        s.codigo.toLowerCase().includes(q) ||
        s.descricao.toLowerCase().includes(q)
      );
    });
  }, [
    data,
    produtoFiltro,
    soAlertas,
    categoriaId,
    filialTabelaId,
    serieAtiva,
    seriesMatch,
    serieLoading,
  ]);

  /** Sugestões a partir de todos os saldos carregados (não encolhe a tabela ao digitar). */
  const produtoSugestoes = useMemo(() => {
    if (!data) return [];
    const q = produtoQ.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    const out: { codigo: string; descricao: string }[] = [];
    for (const s of data.saldos) {
      if (categoriaId && s.categoriaId !== categoriaId) continue;
      if (filialTabelaId && s.filialId !== filialTabelaId) continue;
      if (soAlertas && !(s.abaixoMinimo || s.acimaMaximo)) continue;
      if (seen.has(s.codigo)) continue;
      const match =
        s.codigo.toLowerCase().includes(q) ||
        s.descricao.toLowerCase().includes(q);
      if (!match) continue;
      seen.add(s.codigo);
      out.push({ codigo: s.codigo, descricao: s.descricao });
      if (out.length >= 12) break;
    }
    return out;
  }, [data, produtoQ, categoriaId, filialTabelaId, soAlertas]);

  const temFiltroTabela =
    !!produtoFiltro.trim() ||
    !!categoriaId ||
    !!filialTabelaId ||
    soAlertas ||
    serieAtiva;

  const mostrarFiltroFilialTabela =
    !!data &&
    (data.escopo.consolidado || data.filiais.length > 1) &&
    !(isOpsManager && filialId);

  function aplicarProduto(valor: string) {
    const v = valor.trim();
    setProdutoQ(v);
    setProdutoFiltro(v);
    setProdutoOpen(false);
  }

  function selecionarProduto(codigo: string) {
    aplicarProduto(codigo);
  }

  function limparProduto() {
    setProdutoQ("");
    setProdutoFiltro("");
    setProdutoOpen(false);
  }

  useEffect(() => {
    const visible = new Set(saldosFiltrados.map((s) => s.id));
    setSelecionados((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed || next.size !== prev.size ? next : prev;
    });
  }, [saldosFiltrados]);

  const todosVisiveisSelecionados =
    saldosFiltrados.length > 0 &&
    saldosFiltrados.every((s) => selecionados.has(s.id));

  function toggleTodosVisiveis() {
    if (todosVisiveisSelecionados) {
      setSelecionados(new Set());
      return;
    }
    setSelecionados(new Set(saldosFiltrados.map((s) => s.id)));
  }

  function toggleLinha(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleSeriesLinha(s: {
    id: string;
    produtoId?: string;
    filialId: string;
    controlaSerie?: boolean;
  }) {
    if (!s.controlaSerie || !s.produtoId) return;
    if (expandSeriesId === s.id) {
      setExpandSeriesId(null);
      return;
    }
    setExpandSeriesId(s.id);
    const cached = seriesPorLinha[s.id];
    if (cached && !cached.loading && !cached.error) return;
    setSeriesPorLinha((prev) => ({
      ...prev,
      [s.id]: { loading: true, numeros: prev[s.id]?.numeros || [] },
    }));
    try {
      const list = await api<Array<{ numeroSerie: string }>>(
        `/series/disponiveis?produtoId=${encodeURIComponent(s.produtoId)}&filialId=${encodeURIComponent(s.filialId)}`
      );
      setSeriesPorLinha((prev) => ({
        ...prev,
        [s.id]: {
          loading: false,
          numeros: list.map((x) => x.numeroSerie),
        },
      }));
    } catch (e) {
      setSeriesPorLinha((prev) => ({
        ...prev,
        [s.id]: {
          loading: false,
          numeros: [],
          error: e instanceof Error ? e.message : "Erro ao carregar séries",
        },
      }));
    }
  }

  const filialLabel =
    data && data.escopo.filialId
      ? data.filiais.find((f) => f.id === data.escopo.filialId)
      : null;

  async function exportSaldos(format: "pdf" | "xlsx") {
    setExporting(format);
    setError("");
    try {
      const params = new URLSearchParams();
      const escopoFilial =
        (isOpsManager && filialId) || filialTabelaId || "";
      if (escopoFilial) params.set("filialId", escopoFilial);
      // Com série (ou seleção), exporta exatamente as linhas da tabela filtrada
      if (selecionados.size > 0) {
        params.set("ids", [...selecionados].join(","));
      } else if (serieAtiva) {
        if (saldosFiltrados.length === 0) {
          throw new Error(
            "Nenhuma posição em estoque para exportar com este filtro de série"
          );
        }
        params.set("ids", saldosFiltrados.map((s) => s.id).join(","));
      } else {
        if (produtoFiltro.trim()) params.set("q", produtoFiltro.trim());
        if (soAlertas) params.set("soAlertas", "1");
        if (categoriaId) params.set("categoriaId", categoriaId);
      }
      const qs = params.toString() ? `?${params}` : "";
      const { blob, filename } = await apiDownload(
        `/dashboard/saldos/export.${format}${qs}`,
        { fallbackFilename: `teep-saldos.${format === "pdf" ? "pdf" : "xlsx"}` }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na exportação");
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Dashboard / Saldos
          </h1>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {user
              ? `${saudacaoPorHora()} ${user.nome}`
              : "Carregando…"}
            {!data?.escopo.consolidado && filialLabel
              ? ` · ${filialLabel.sigla} — ${filialLabel.nome}`
              : ""}
          </p>
        </div>
        {isOpsManager && data && (
          <select
            className="min-w-[11rem] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800"
            value={filialId}
            onChange={(e) => setFilialId(e.target.value)}
            aria-label="Escopo dos KPIs e saldos"
          >
            <option value="">Todos os estoques</option>
            {data.filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.sigla} — {f.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading && (
        <p className="mt-2 text-sm text-slate-500">Carregando indicadores…</p>
      )}

      {data && !loading && (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {user && userHas(user, "dashboard_kpi_quantidade") && (
              <Kpi
                label="Qtd. total em estoque"
                value={qty(data.kpis.quantidadeTotal ?? 0)}
              />
            )}
            {user && userHas(user, "dashboard_kpi_valor") && (
              <Kpi
                label="Valor de estoque"
                value={money(data.kpis.valorTotal ?? 0)}
              />
            )}
            {user && userHas(user, "dashboard_kpi_movimentos") && (
              <Kpi
                label="Movimentos (30 dias)"
                value={String(data.kpis.movimentos30d ?? 0)}
                href={
                  userHas(user, "movimentacoes")
                    ? "/movimentacoes"
                    : undefined
                }
              />
            )}
          </div>

          {user && userHas(user, "assistente") && (
              <AssistenteEstoque filialId={filialId} />
            )}

          {(data.kpis.alertasEstoque ?? data.kpis.alertasMinimo) > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">
                Alertas de estoque (mín. / máx.)
              </h2>
              {data.alertasMeta.truncado && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Exibindo {data.alertasMeta.retornados} de{" "}
                  {data.alertasMeta.total} alertas (os mais críticos).
                </p>
              )}
              <ul className="mt-3 divide-y rounded-xl border bg-white">
                {data.alertas.map((a) => (
                  <li
                    key={`${a.filialId}-${a.produtoId}-${a.tipo || "MINIMO"}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <div>
                      <span className="font-mono text-xs">{a.codigo}</span>{" "}
                      {a.descricao}
                      <span className="ml-2 text-slate-400">
                        {a.filialSigla}
                      </span>
                      <span className="ml-2 text-xs font-medium text-amber-800">
                        {a.tipo === "MAXIMO" ? "acima do máx." : "abaixo do mín."}
                      </span>
                    </div>
                    <div className="text-amber-800">
                      Saldo {qty(a.saldoAtual)}
                      {a.tipo === "MAXIMO"
                        ? ` / máx. ${a.estoqueMaximo ?? "—"}`
                        : ` / mín. ${a.estoqueMinimo}`}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2 className="text-lg font-semibold text-slate-900">Saldos</h2>
                <p className="text-xs text-slate-400">
                  {selecionados.size > 0
                    ? `Exporta ${selecionados.size} item(ns) selecionado(s)`
                    : "Exporta o que estiver filtrado na tabela"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!!exporting || saldosFiltrados.length === 0}
                  onClick={() => void exportSaldos("pdf")}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-brand/40 disabled:opacity-50"
                >
                  {exporting === "pdf" ? "Gerando…" : "Exportar PDF"}
                </button>
                <button
                  type="button"
                  disabled={!!exporting || saldosFiltrados.length === 0}
                  onClick={() => void exportSaldos("xlsx")}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-brand/40 disabled:opacity-50"
                >
                  {exporting === "xlsx" ? "Gerando…" : "Exportar Excel"}
                </button>
              </div>
            </div>

            <div className="sticky top-0 z-30 mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur-sm sm:grid-cols-2 lg:grid-cols-12">
              <div className="relative sm:col-span-2 lg:col-span-4">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  Produto
                </span>
                <div className="flex gap-1">
                  <input
                    value={produtoQ}
                    onChange={(e) => {
                      const v = e.target.value;
                      setProdutoQ(v);
                      setProdutoOpen(true);
                      // Enquanto digita, não filtra a tabela (evita “pulo” da tela).
                      if (
                        produtoFiltro &&
                        v.trim().toLowerCase() !==
                          produtoFiltro.trim().toLowerCase()
                      ) {
                        setProdutoFiltro("");
                      }
                    }}
                    onFocus={() => setProdutoOpen(true)}
                    onBlur={() => setTimeout(() => setProdutoOpen(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        aplicarProduto(produtoQ);
                      }
                      if (e.key === "Escape") {
                        setProdutoOpen(false);
                      }
                    }}
                    placeholder="Digite e escolha um código…"
                    className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-expanded={produtoOpen && !!produtoQ.trim()}
                  />
                  {(produtoQ || produtoFiltro) && (
                    <button
                      type="button"
                      onClick={limparProduto}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-500 hover:bg-slate-50"
                      title="Limpar produto"
                    >
                      ×
                    </button>
                  )}
                </div>
                {produtoOpen && produtoQ.trim() && (
                  <ul className="absolute z-40 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {produtoSugestoes.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-slate-500">
                        Nenhum código compatível nos saldos carregados
                      </li>
                    ) : (
                      produtoSugestoes.map((p) => (
                        <li key={p.codigo}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selecionarProduto(p.codigo);
                            }}
                          >
                            <span className="font-mono text-xs text-slate-800">
                              {p.codigo}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                              {p.descricao}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                    <li className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
                      Clique na sugestão ou Enter para filtrar a tabela
                    </li>
                  </ul>
                )}
              </div>

              <label className="block sm:col-span-1 lg:col-span-3">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  Nº de série
                </span>
                <div className="flex gap-1">
                  <input
                    value={serieQ}
                    onChange={(e) => onSerieChange(e.target.value)}
                    onKeyDown={onSerieKeyDown}
                    placeholder="Mín. 2 caracteres + Enter"
                    className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
                    autoComplete="off"
                  />
                  {(serieQ || serieFiltro) && (
                    <button
                      type="button"
                      onClick={() => {
                        limparSerie();
                        setSeriesMatch([]);
                        setSerieTruncado(false);
                      }}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-500 hover:bg-slate-50"
                      title="Limpar série"
                    >
                      ×
                    </button>
                  )}
                </div>
              </label>

              <label
                className={
                  mostrarFiltroFilialTabela
                    ? "block lg:col-span-2"
                    : "block lg:col-span-5"
                }
              >
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  Categoria
                </span>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                >
                  <option value="">Todas</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>

              {mostrarFiltroFilialTabela && (
                <label className="block lg:col-span-3">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    Estoque
                  </span>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={filialTabelaId}
                    onChange={(e) => setFilialTabelaId(e.target.value)}
                  >
                    <option value="">Todos</option>
                    {data.filiais.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.sigla} — {f.nome}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2 lg:col-span-12">
                <input
                  type="checkbox"
                  checked={soAlertas}
                  onChange={(e) => setSoAlertas(e.target.checked)}
                />
                Só fora do mín./máx.
              </label>
            </div>

            {serieAtiva && (
              <div className="mt-3 rounded-xl border border-brand/20 bg-brand-light/40 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">
                    Situação da série{" "}
                    <span className="font-mono">{serieFiltro}</span>
                    {serieLoading ? "…" : ""}
                  </p>
                  {canMovimentacoes && (
                    <Link
                      href={`/movimentacoes?serie=${encodeURIComponent(serieFiltro.trim())}`}
                      className="text-xs text-brand underline"
                    >
                      Ver histórico em Movimentações
                    </Link>
                  )}
                </div>
                {!serieLoading && seriesMatch.length === 0 && (
                  <p className="mt-1 text-slate-600">Nenhuma série encontrada.</p>
                )}
                {!serieLoading && seriesMatch.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {seriesMatch.map((u) => (
                      <li
                        key={u.id}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-slate-700"
                      >
                        <span className="font-mono text-xs">{u.numeroSerie}</span>
                        <span className="text-xs text-slate-500">
                          {u.produto.codigo} — {u.produto.descricao}
                        </span>
                        <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-800">
                          {UNIDADE_SERIE_STATUS_LABEL[u.status] || u.status}
                        </span>
                        <span className="text-xs">{localUnidadeSerie(u)}</span>
                        {u.status === "EM_TRANSITO" && u.emTransito && (
                          <Link
                            href={`/transferencias/${u.emTransito.transferenciaId}`}
                            className="text-xs text-brand underline"
                          >
                            Abrir transferência
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {serieTruncado && (
                  <p className="mt-2 text-xs text-amber-800">
                    Mais de 50 resultados — refine o número de série.
                  </p>
                )}
              </div>
            )}

            {data.saldosMeta.truncado && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Exibindo {data.saldosMeta.retornados} de{" "}
                {data.saldosMeta.total} posições (limite{" "}
                {data.saldosMeta.limite}).
                {data.escopo.consolidado
                  ? " Use o filtro Estoque abaixo para ver o restante."
                  : " Refine os filtros ou escolha outro escopo."}
              </p>
            )}
            {soAlertas && data.saldosMeta.truncado && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                O filtro “só fora do mín./máx.” aplica-se apenas às posições
                carregadas na tabela. A lista de alertas acima usa a contagem
                completa.
              </p>
            )}

            <div className="mt-3 overflow-x-auto rounded-xl border bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={todosVisiveisSelecionados}
                        onChange={toggleTodosVisiveis}
                        disabled={saldosFiltrados.length === 0}
                        aria-label="Selecionar todos visíveis"
                        title="Selecionar todos visíveis"
                      />
                    </th>
                    <th className="px-3 py-2">Estoque</th>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2">Categoria</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2">Séries</th>
                    <th className="px-3 py-2 text-right">Mín.</th>
                    <th className="px-3 py-2 text-right">Máx.</th>
                    {user && userHas(user, "dashboard_kpi_valor") && (
                      <th className="px-3 py-2 text-right">Valor</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {saldosFiltrados.map((s) => {
                    const marcada = selecionados.has(s.id);
                    const aberto = expandSeriesId === s.id;
                    const serieState = seriesPorLinha[s.id];
                    const qtdSeriesCarregada = serieState?.numeros.length;
                    const qtdSeriesEstimada = Math.trunc(s.saldoAtual);
                    const qtdSeriesLabel =
                      serieState && !serieState.loading && !serieState.error
                        ? qtdSeriesCarregada
                        : qtdSeriesEstimada;
                    return (
                      <tr
                        key={s.id}
                        className={
                          s.abaixoMinimo || s.acimaMaximo
                            ? "border-t bg-amber-50/60 align-top"
                            : marcada
                              ? "border-t bg-brand/[0.06] align-top"
                              : "border-t align-top"
                        }
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={marcada}
                            onChange={() => toggleLinha(s.id)}
                            aria-label={`Selecionar ${s.codigo}`}
                          />
                        </td>
                        <td className="px-3 py-2">{s.filialSigla}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {s.codigo}
                          {s.controlaSerie ? (
                            <span className="ml-1 rounded bg-teal-50 px-1 text-[10px] uppercase text-teal-800">
                              Série
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          {s.descricao}
                          {!s.produtoAtivo && (
                            <span className="ml-1 text-xs text-slate-400">
                              (inativo)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {s.categoriaNome || "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {qty(s.saldoAtual)}
                          {s.controlaSerie ? (
                            <div className="text-[11px] font-normal text-slate-500">
                              {qtdSeriesLabel} série(s)
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 min-w-[12rem]">
                          {!s.controlaSerie ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <div className="space-y-1">
                              <button
                                type="button"
                                className="text-left text-sm text-teal-800 underline"
                                onClick={() => void toggleSeriesLinha(s)}
                              >
                                {aberto
                                  ? "Ocultar"
                                  : `Ver ${qtdSeriesLabel} série(s)`}
                              </button>
                              {aberto ? (
                                <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-2">
                                  {serieState?.loading ? (
                                    <p className="text-xs text-slate-500">
                                      Carregando…
                                    </p>
                                  ) : serieState?.error ? (
                                    <p className="text-xs text-rose-700">
                                      {serieState.error}
                                    </p>
                                  ) : (serieState?.numeros.length ?? 0) ===
                                    0 ? (
                                    <p className="text-xs text-slate-500">
                                      Nenhuma série EM_ESTOQUE neste estoque
                                      {s.saldoAtual > 0
                                        ? ` (saldo ${qty(s.saldoAtual)} — divergência)`
                                        : ""}
                                      .
                                    </p>
                                  ) : (
                                    <>
                                      <p className="text-xs text-slate-600">
                                        {serieState!.numeros.length} unidade(s)
                                        em {s.filialSigla}
                                      </p>
                                      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                                        {serieState!.numeros.map((sn) => (
                                          <li
                                            key={sn}
                                            className="font-mono text-xs text-slate-800"
                                          >
                                            {sn}
                                          </li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {s.estoqueMinimo || "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {s.estoqueMaximo || "—"}
                        </td>
                        {user && userHas(user, "dashboard_kpi_valor") && (
                          <td className="px-3 py-2 text-right">
                            {money(s.valor ?? 0)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {saldosFiltrados.length === 0 && (
                    <tr>
                      <td
                        colSpan={
                          user && userHas(user, "dashboard_kpi_valor") ? 10 : 9
                        }
                        className="px-3 py-8 text-center text-slate-500"
                      >
                        {serieAtiva && serieLoading
                          ? "Buscando série…"
                          : serieAtiva &&
                              !serieLoading &&
                              seriesMatch.length > 0 &&
                              !seriesMatch.some((u) => u.status === "EM_ESTOQUE")
                            ? "A série não está em estoque — veja a situação acima."
                            : serieAtiva &&
                                !serieLoading &&
                                seriesMatch.some((u) => u.status === "EM_ESTOQUE") &&
                                saldosFiltrados.length === 0
                              ? "Série em estoque, mas a posição não está entre os saldos carregados (escopo/limite). Veja a situação acima."
                              : `Nenhum saldo para exibir${
                                  temFiltroTabela
                                    ? " com os filtros atuais."
                                    : "."
                                }`}{" "}
                        {!temFiltroTabela && isOpsManager && (
                          <Link
                            href="/estoque/init"
                            className="text-brand hover:underline"
                          >
                            Inventário
                          </Link>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Exibindo {saldosFiltrados.length} na tabela
              {temFiltroTabela
                ? ` (filtro sobre ${data.saldos.length} carregados)`
                : ""}
              {selecionados.size > 0
                ? ` · ${selecionados.size} selecionado(s)`
                : ""}
            </p>
          </section>
        </>
      )}
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  accent,
  href,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "warn";
  href?: string;
  onClick?: () => void;
}) {
  const clickable = Boolean(href || onClick);
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {label}
        </div>
        {clickable ? (
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
            aria-hidden
            title="Abrir detalhes"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3 w-3"
            >
              <path
                fillRule="evenodd"
                d="M3 10a.75.75 0 0 1 .75-.75h10.638l-3.96-3.96a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06l3.96-3.96H3.75A.75.75 0 0 1 3 10Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        ) : null}
      </div>
      <div
        className={
          accent === "warn"
            ? "mt-0.5 text-lg font-semibold tabular-nums text-amber-800"
            : "mt-0.5 text-lg font-semibold tabular-nums text-slate-900"
        }
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </>
  );
  const cls = clickable
    ? "rounded-lg border border-slate-200 bg-white px-3 py-2.5 block text-left w-full hover:border-brand/40 hover:bg-slate-50/60 transition-colors"
    : "rounded-lg border border-slate-200 bg-white px-3 py-2.5 block text-left w-full";
  if (href) {
    return (
      <Link href={href} className={cls} title="Ver movimentações">
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
