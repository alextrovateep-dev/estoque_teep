"use client";

import { ConfirmMotivoPanel } from "@/components/ConfirmMotivoPanel";
import { api, apiDownload, apiUpload, getStoredUser, User, userFilialIds } from "@/lib/api";
import { userHas } from "@/lib/access";
import { resolveAssetUrl } from "@/lib/assets";
import { matchNomeOuDocumento, onlyDigits } from "@/lib/documento";
import { useSerieFiltro } from "@/hooks/useSerieFiltro";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

type Mov = {
  id: string;
  operacao: string;
  quantidade: string | number;
  status: string;
  dataMovimento: string;
  estornoDeId?: string | null;
  transferenciaItemId?: string | null;
  transferenciaId?: string | null;
  notaFiscalNumero?: string | null;
  notaFiscalArquivo?: string | null;
  transferenciaNotaFiscalNumero?: string | null;
  produto: { codigo: string; descricao: string };
  tipo: { nome: string };
  filial: { sigla: string };
  filialDestino?: { sigla: string } | null;
  cliente?: { id: string; nome: string; tipo: string; documento?: string | null } | null;
  usuario: { nome: string };
  series?: Array<{ unidadeSerie: { numeroSerie: string } }>;
  anexos?: Array<{
    id: string;
    tipo: string;
    arquivo: string;
    label?: string | null;
  }>;
  transferenciaAnexos?: Array<{
    id: string;
    tipo: string;
    arquivo: string;
    label?: string | null;
  }>;
  termoPendente?: boolean;
  retornoPendente?: {
    qtyRestante: number;
    tipoRetornoId: string;
    tipoRetornoNome: string;
  } | null;
  aguardandoRecebimento?: {
    transferenciaId: string;
    destinoFilialId: string;
  } | null;
};

type Produto = { id: string; codigo: string; descricao: string };
type Tipo = { id: string; nome: string; operacao: string };
type Parceiro = {
  id: string;
  nome: string;
  tipo: string;
  documento?: string | null;
  ativo: boolean;
};

type ResumoProduto = {
  produto: { id: string; codigo: string; descricao: string; unidade: string };
  dataInicio: string | null;
  dataFim: string | null;
  entradas: number;
  saidas: number;
  diferenca: number;
  estoqueAtual: number;
  unidade: string;
};

function formatQty(n: number): string {
  return n.toLocaleString("pt-BR", {
    maximumFractionDigits: 4,
  });
}

function formatPeriodo(inicio: string | null, fim: string | null): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  if (inicio && fim) return `${fmt(inicio)}–${fmt(fim)}`;
  if (inicio) return `desde ${fmt(inicio)}`;
  if (fim) return `até ${fmt(fim)}`;
  return "todo o histórico";
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MovimentacoesPage() {
  const [data, setData] = useState<Mov[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [dataInicio, setDataInicio] = useState(() => daysAgoISO(30));
  const [dataFim, setDataFim] = useState(() => todayISO());

  const [produtoId, setProdutoId] = useState("");
  const [produtoLabel, setProdutoLabel] = useState("");
  const [produtoQuery, setProdutoQuery] = useState("");
  const [produtoOpen, setProdutoOpen] = useState(false);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  const [tipoId, setTipoId] = useState("");
  const [tipoLabel, setTipoLabel] = useState("");
  const [tipoQuery, setTipoQuery] = useState("");
  const [tipoOpen, setTipoOpen] = useState(false);
  const [tipos, setTipos] = useState<Tipo[]>([]);

  const [operacaoFiltro, setOperacaoFiltro] = useState<
    "" | "ENTRADA" | "SAIDA" | "TRANSFERENCIA"
  >("");

  const [parceiroModo, setParceiroModo] = useState<
    "" | "CLIENTE" | "FORNECEDOR"
  >("");
  const [parceiroId, setParceiroId] = useState("");
  const [parceiroLabel, setParceiroLabel] = useState("");
  const [parceiroTipoLabel, setParceiroTipoLabel] = useState("");
  const [parceiroQuery, setParceiroQuery] = useState("");
  const [parceiroOpen, setParceiroOpen] = useState(false);
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);

  const {
    serieQ,
    serieFiltro,
    serieAtiva,
    limparSerie,
    aplicarSerie,
    onSerieChange,
    onSerieKeyDown,
  } = useSerieFiltro({
    replacePath: "/movimentacoes",
    bootstrapFromUrl: true,
    onFiltroChange: () => setPage(1),
  });

  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [painelId, setPainelId] = useState<string | null>(null);
  const [painelAcao, setPainelAcao] = useState<
    "rejeitar" | "estornar" | "termo" | null
  >(null);
  const [motivo, setMotivo] = useState("");
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);
  const [termoUploading, setTermoUploading] = useState(false);
  const [resumo, setResumo] = useState<ResumoProduto | null>(null);
  const [resumoLoading, setResumoLoading] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const canManage = Boolean(user && userHas(user, "aprovacoes"));
  const canLancamentos = Boolean(user && userHas(user, "lancamentos"));
  const canTransferencias = Boolean(user && userHas(user, "transferencias"));

  useEffect(() => {
    setUser(getStoredUser());
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("retornoOk") === "1") {
        setMsg("Retorno lançado com sucesso.");
        // preserva ?serie= se o hook já limpou; só remove retornoOk
        window.history.replaceState({}, "", "/movimentacoes");
      }
    }
    Promise.all([
      api<Produto[]>("/produtos"),
      api<Tipo[]>("/tipos-movimentacao?paraFiltro=1"),
      api<Parceiro[]>("/clientes?ativas=0"),
    ])
      .then(([p, t, c]) => {
        setProdutos(p);
        setTipos(t);
        setParceiros(c);
      })
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Falha ao carregar filtros"
        )
      );
  }, []);

  const produtosFiltrados = useMemo(() => {
    const q = produtoQuery.trim().toLowerCase();
    if (!q) return [];
    return produtos
      .filter(
        (p) =>
          p.codigo.toLowerCase().includes(q) ||
          p.descricao.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [produtos, produtoQuery]);

  const tiposFiltrados = useMemo(() => {
    const q = tipoQuery.trim().toLowerCase();
    if (!q) return [];
    return tipos
      .filter(
        (t) =>
          t.nome.toLowerCase().includes(q) ||
          t.operacao.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [tipos, tipoQuery]);

  const parceirosFiltrados = useMemo(() => {
    const q = parceiroQuery.trim();
    if (!q) return [];
    const qDigits = onlyDigits(q);
    const matches = parceiros.filter((c) =>
      matchNomeOuDocumento(c.nome, c.documento, q)
    );
    const noModo = (c: Parceiro) => {
      if (parceiroModo === "FORNECEDOR") return c.tipo === "FORNECEDOR";
      if (parceiroModo === "CLIENTE") return c.tipo !== "FORNECEDOR";
      return true;
    };
    const preferred = matches.filter(noModo);
    const extras =
      qDigits.length >= 11
        ? matches.filter(
            (c) => !noModo(c) && onlyDigits(c.documento || "") === qDigits
          )
        : [];
    return [...preferred, ...extras].slice(0, 20);
  }, [parceiros, parceiroQuery, parceiroModo]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "20",
    });
    if (!serieAtiva) {
      if (dataInicio) params.set("dataInicio", dataInicio);
      if (dataFim) params.set("dataFim", dataFim);
    }
    if (produtoId) params.set("produtoId", produtoId);
    if (tipoId) params.set("tipoId", tipoId);
    if (operacaoFiltro) params.set("operacao", operacaoFiltro);
    if (parceiroId) {
      params.set("clienteId", parceiroId);
    } else if (parceiroModo) {
      params.set("parceiroTipo", parceiroModo);
    }
    if (serieAtiva) {
      params.set("numeroSerie", serieFiltro.trim());
    }

    api<{ data: Mov[]; total: number }>(`/movimentacoes?${params}`)
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        setTotal(r.total);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof Error ? e.message : "Falha ao carregar movimentações"
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    page,
    dataInicio,
    dataFim,
    produtoId,
    tipoId,
    operacaoFiltro,
    parceiroId,
    parceiroModo,
    serieAtiva,
    serieFiltro,
    reloadKey,
  ]);

  useEffect(() => {
    if (!produtoId) {
      setResumo(null);
      return;
    }
    let cancelled = false;
    setResumoLoading(true);
    const params = new URLSearchParams({ produtoId });
    // Com série, a lista ignora período — o resumo acompanha
    if (!serieAtiva) {
      if (dataInicio) params.set("dataInicio", dataInicio);
      if (dataFim) params.set("dataFim", dataFim);
    }
    api<ResumoProduto>(`/movimentacoes/resumo?${params}`)
      .then((r) => {
        if (!cancelled) setResumo(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setResumo(null);
          setError(e instanceof Error ? e.message : "Falha no resumo");
        }
      })
      .finally(() => {
        if (!cancelled) setResumoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [produtoId, dataInicio, dataFim, serieAtiva, reloadKey]);

  function abrirPainel(id: string, acao: "rejeitar" | "estornar" | "termo") {
    setPainelId(id);
    setPainelAcao(acao);
    setMotivo("");
  }

  function fecharPainel() {
    setPainelId(null);
    setPainelAcao(null);
    setMotivo("");
  }

  async function anexarTermo(id: string, file: File) {
    if (actingRef.current) return;
    actingRef.current = true;
    setTermoUploading(true);
    setActing(true);
    setError("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("context", "documento");
      const up = await apiUpload<{ url: string }>("/upload", fd);
      await api(`/movimentacoes/${id}/anexos`, {
        method: "POST",
        body: JSON.stringify({
          tipo: "TERMO_COMODATO",
          arquivo: up.url,
          label: "Termo de recebimento",
        }),
      });
      setMsg("Termo de comodato anexado");
      fecharPainel();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao anexar termo");
    } finally {
      actingRef.current = false;
      setTermoUploading(false);
      setActing(false);
    }
  }

  async function confirmarEstorno(id: string) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/movimentacoes/${id}/estornar`, {
        method: "POST",
        body: JSON.stringify({ observacao: motivo.trim() || null }),
      });
      setMsg("Estorno gerado");
      fecharPainel();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function aprovar(id: string) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      const r = await api<{
        alertaEstoqueMinimo?: boolean;
        alertaEstoqueMaximo?: boolean;
        alertas?: Array<{ mensagem: string }>;
      }>(`/movimentacoes/${id}/aprovar`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const extras =
        r.alertas?.map((a) => a.mensagem).join(" · ") ||
        [
          r.alertaEstoqueMinimo ? "estoque mínimo" : "",
          r.alertaEstoqueMaximo ? "estoque máximo" : "",
        ]
          .filter(Boolean)
          .join(" · ");
      setMsg(extras ? `Aprovado · ${extras}` : "Movimento aprovado");
      fecharPainel();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function confirmarRejeicao(id: string) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/movimentacoes/${id}/rejeitar`, {
        method: "POST",
        body: JSON.stringify({ motivo: motivo.trim() || undefined }),
      });
      setMsg("Movimento rejeitado (saldo intacto)");
      fecharPainel();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  function selecionarProduto(p: Produto) {
    setProdutoId(p.id);
    setProdutoLabel(`${p.codigo} — ${p.descricao}`);
    setProdutoQuery(`${p.codigo} — ${p.descricao}`);
    setProdutoOpen(false);
    setPage(1);
  }

  function limparProduto() {
    setProdutoId("");
    setProdutoLabel("");
    setProdutoQuery("");
    setPage(1);
  }

  function selecionarTipo(t: Tipo) {
    setTipoId(t.id);
    setTipoLabel(t.nome);
    setTipoQuery(t.nome);
    setTipoOpen(false);
    setPage(1);
  }

  function limparTipo() {
    setTipoId("");
    setTipoLabel("");
    setTipoQuery("");
    setPage(1);
  }

  function selecionarParceiro(c: Parceiro) {
    setParceiroId(c.id);
    const label = c.documento ? `${c.nome} · ${c.documento}` : c.nome;
    setParceiroLabel(label);
    setParceiroTipoLabel(
      c.tipo === "FORNECEDOR" ? "Forn." : "Cliente"
    );
    setParceiroQuery(label);
    setParceiroOpen(false);
    setPage(1);
  }

  function limparParceiro() {
    setParceiroId("");
    setParceiroLabel("");
    setParceiroTipoLabel("");
    setParceiroQuery("");
    setPage(1);
  }

  function mudarParceiroModo(modo: "" | "CLIENTE" | "FORNECEDOR") {
    setParceiroModo(modo);
    limparParceiro();
    setPage(1);
  }

  function resetFiltros() {
    setDataInicio(daysAgoISO(30));
    setDataFim(todayISO());
    limparProduto();
    limparTipo();
    limparParceiro();
    setParceiroModo("");
    setOperacaoFiltro("");
    limparSerie();
    setPage(1);
  }

  function buildExportQuery(): string {
    const params = new URLSearchParams();
    if (serieAtiva) {
      params.set("numeroSerie", serieFiltro.trim());
    } else {
      if (dataInicio) params.set("dataInicio", dataInicio);
      if (dataFim) params.set("dataFim", dataFim);
    }
    if (produtoId) params.set("produtoId", produtoId);
    if (tipoId) params.set("tipoId", tipoId);
    if (operacaoFiltro) params.set("operacao", operacaoFiltro);
    if (parceiroId) params.set("clienteId", parceiroId);
    else if (parceiroModo) params.set("parceiroTipo", parceiroModo);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  async function exportMovimentacoes(format: "pdf" | "xlsx") {
    setExporting(format);
    setError("");
    try {
      const { blob, filename } = await apiDownload(
        `/movimentacoes/export.${format}${buildExportQuery()}`,
        {
          fallbackFilename: `teep-movimentacoes.${format === "pdf" ? "pdf" : "xlsx"}`,
        }
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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-2xl font-semibold">Movimentações</h1>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex shrink-0 items-center gap-1"
          title={
            serieAtiva
              ? "Período ignorado enquanto o filtro de série está ativo"
              : undefined
          }
        >
          <input
            type="date"
            value={dataInicio}
            max={dataFim || undefined}
            disabled={serieAtiva}
            onChange={(e) => {
              setDataInicio(e.target.value);
              setPage(1);
            }}
            className="w-[7.75rem] rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
            aria-label="Data início"
          />
          <span className="text-[11px] text-slate-400">–</span>
          <input
            type="date"
            value={dataFim}
            min={dataInicio || undefined}
            disabled={serieAtiva}
            onChange={(e) => {
              setDataFim(e.target.value);
              setPage(1);
            }}
            className="w-[7.75rem] rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
            aria-label="Data fim"
          />
        </div>
        <button
          type="button"
          disabled={!!exporting || (!loading && data.length === 0)}
          onClick={() => void exportMovimentacoes("pdf")}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-brand/40 disabled:opacity-50"
        >
          {exporting === "pdf" ? "Gerando…" : "Exportar PDF"}
        </button>
        <button
          type="button"
          disabled={!!exporting || (!loading && data.length === 0)}
          onClick={() => void exportMovimentacoes("xlsx")}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-brand/40 disabled:opacity-50"
        >
          {exporting === "xlsx" ? "Gerando…" : "Exportar Excel"}
        </button>
      </div>
    </div>

      <div className="mt-3 rounded-xl border bg-white px-3 py-2.5">
        <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-4 lg:grid-cols-12">
          <div className="relative col-span-2 min-w-0 sm:col-span-2 lg:col-span-3">
            <div className="flex gap-1">
              <input
                value={produtoQuery}
                onChange={(e) => {
                  setProdutoQuery(e.target.value);
                  setProdutoId("");
                  setProdutoLabel("");
                  setProdutoOpen(true);
                  setPage(1);
                }}
                onFocus={() => setProdutoOpen(true)}
                onBlur={() => setTimeout(() => setProdutoOpen(false), 150)}
                placeholder="Produto…"
                className="w-full min-w-0 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                autoComplete="off"
              />
              {(produtoId || produtoQuery) && (
                <button
                  type="button"
                  onClick={limparProduto}
                  className="shrink-0 rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-slate-50"
                  title="Limpar produto"
                >
                  ×
                </button>
              )}
            </div>
            {produtoOpen && produtoQuery.trim() && !produtoId && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full min-w-[14rem] overflow-auto rounded-lg border bg-white shadow-lg">
                {produtosFiltrados.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-slate-500">
                    Nenhum produto encontrado
                  </li>
                ) : (
                  produtosFiltrados.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selecionarProduto(p);
                        }}
                      >
                        <span className="font-mono text-xs">{p.codigo}</span> —{" "}
                        {p.descricao}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <div className="relative col-span-1 min-w-0 sm:col-span-1 lg:col-span-2">
            <div className="flex gap-1">
              <input
                value={tipoQuery}
                onChange={(e) => {
                  setTipoQuery(e.target.value);
                  setTipoId("");
                  setTipoLabel("");
                  setTipoOpen(true);
                  setPage(1);
                }}
                onFocus={() => setTipoOpen(true)}
                onBlur={() => setTimeout(() => setTipoOpen(false), 150)}
                placeholder="Tipo…"
                className="w-full min-w-0 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                autoComplete="off"
              />
              {(tipoId || tipoQuery) && (
                <button
                  type="button"
                  onClick={limparTipo}
                  className="shrink-0 rounded-md border border-slate-200 px-1.5 text-slate-500 hover:bg-slate-50"
                  title="Limpar tipo"
                >
                  ×
                </button>
              )}
            </div>
            {tipoOpen && tipoQuery.trim() && !tipoId && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full min-w-[12rem] overflow-auto rounded-lg border bg-white shadow-lg">
                {tiposFiltrados.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-slate-500">
                    Nenhum tipo encontrado
                  </li>
                ) : (
                  tiposFiltrados.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selecionarTipo(t);
                        }}
                      >
                        {t.nome}
                        <span className="ml-1 text-xs text-slate-400">
                          ({t.operacao === "TRANSFERENCIA" ? "A→B" : t.operacao})
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <select
            value={operacaoFiltro}
            onChange={(e) => {
              const v = e.target.value;
              setOperacaoFiltro(
                v === "ENTRADA" || v === "SAIDA" || v === "TRANSFERENCIA"
                  ? v
                  : ""
              );
              setPage(1);
            }}
            className="col-span-1 min-w-0 rounded-md border border-slate-200 px-2 py-1.5 text-sm sm:col-span-1 lg:col-span-1"
            title="Filtrar por operação"
            aria-label="Operação"
          >
            <option value="">Operação</option>
            <option value="ENTRADA">Entrada</option>
            <option value="SAIDA">Saída</option>
            <option value="TRANSFERENCIA">Transferência</option>
          </select>

          <div className="relative col-span-2 min-w-0 sm:col-span-2 lg:col-span-3">
            <div className="flex gap-1">
              <select
                value={parceiroModo}
                onChange={(e) => {
                  const v = e.target.value;
                  mudarParceiroModo(
                    v === "FORNECEDOR"
                      ? "FORNECEDOR"
                      : v === "CLIENTE"
                        ? "CLIENTE"
                        : ""
                  );
                }}
                className="w-[5.5rem] shrink-0 rounded-md border border-slate-200 px-1.5 py-1.5 text-sm"
                title="Filtrar por cliente ou fornecedor"
                aria-label="Tipo de parceiro"
              >
                <option value="">Todos</option>
                <option value="CLIENTE">Cliente</option>
                <option value="FORNECEDOR">Fornecedor</option>
              </select>
              <input
                value={parceiroQuery}
                onChange={(e) => {
                  setParceiroQuery(e.target.value);
                  setParceiroId("");
                  setParceiroLabel("");
                  setParceiroTipoLabel("");
                  setParceiroOpen(true);
                  setPage(1);
                }}
                onFocus={() => setParceiroOpen(true)}
                onBlur={() => setTimeout(() => setParceiroOpen(false), 150)}
                placeholder={
                  parceiroModo === "FORNECEDOR"
                    ? "Fornecedor…"
                    : parceiroModo === "CLIENTE"
                      ? "Cliente…"
                      : "Parceiro…"
                }
                className="w-full min-w-0 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                autoComplete="off"
              />
              {(parceiroId || parceiroQuery) && (
                <button
                  type="button"
                  onClick={limparParceiro}
                  className="shrink-0 rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-slate-50"
                  title="Limpar parceiro"
                >
                  ×
                </button>
              )}
            </div>
            {parceiroOpen && parceiroQuery.trim() && !parceiroId && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full min-w-[14rem] overflow-auto rounded-lg border bg-white shadow-lg">
                {parceirosFiltrados.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-slate-500">
                    Nenhum{" "}
                    {parceiroModo === "FORNECEDOR"
                      ? "fornecedor"
                      : parceiroModo === "CLIENTE"
                        ? "cliente"
                        : "parceiro"}{" "}
                    encontrado
                  </li>
                ) : (
                  parceirosFiltrados.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selecionarParceiro(c);
                        }}
                      >
                        <span className="font-medium">{c.nome}</span>
                        <span className="ml-1 text-[10px] uppercase text-slate-400">
                          {c.tipo}
                          {!c.ativo ? " · inativo" : ""}
                        </span>
                        {c.documento ? (
                          <span className="mt-0.5 block font-mono text-xs text-slate-500">
                            {c.documento}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <div className="col-span-1 flex min-w-0 items-center gap-1 sm:col-span-1 lg:col-span-2">
            <input
              value={serieQ}
              onChange={(e) => onSerieChange(e.target.value)}
              onKeyDown={onSerieKeyDown}
              onBlur={() => {
                if (serieQ.trim().length >= 2) aplicarSerie(serieQ);
              }}
              placeholder="Nº série…"
              className="w-full min-w-0 rounded-md border border-slate-200 px-2 py-1.5 font-mono text-sm"
              autoComplete="off"
              title="Filtra ao digitar (mín. 2 caracteres). Com série, o período é ignorado."
            />
            {(serieQ || serieFiltro) && (
              <button
                type="button"
                onClick={() => limparSerie()}
                className="shrink-0 rounded-md border border-slate-200 px-1.5 text-slate-500 hover:bg-slate-50"
                title="Limpar série"
              >
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            className="col-span-1 justify-self-end self-center rounded-md px-2 py-1.5 text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline sm:col-span-1 lg:col-span-1"
            onClick={resetFiltros}
          >
            Limpar
          </button>
        </div>
        {(produtoId ||
          tipoId ||
          parceiroId ||
          parceiroModo ||
          operacaoFiltro ||
          serieAtiva) && (
          <p className="mt-2 truncate border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
            {[
              produtoId ? `Produto: ${produtoLabel}` : null,
              tipoId ? `Tipo: ${tipoLabel}` : null,
              operacaoFiltro === "ENTRADA"
                ? "Operação: entrada"
                : operacaoFiltro === "SAIDA"
                  ? "Operação: saída"
                  : operacaoFiltro === "TRANSFERENCIA"
                    ? "Operação: transferência"
                    : null,
              parceiroId
                ? `${parceiroTipoLabel || (parceiroModo === "FORNECEDOR" ? "Forn." : "Cliente")}: ${parceiroLabel}`
                : parceiroModo === "FORNECEDOR"
                  ? "Somente fornecedores"
                  : parceiroModo === "CLIENTE"
                    ? "Somente clientes"
                    : null,
              serieAtiva
                ? `Série: ${serieFiltro} (histórico completo)`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>

      {produtoId && (
        <div className="mt-4 rounded-xl border border-brand/20 bg-white px-4 py-4">
          <div className="text-sm font-medium text-slate-900">
            {produtoLabel || resumo?.produto
              ? produtoLabel ||
                `${resumo!.produto.codigo} — ${resumo!.produto.descricao}`
              : "Produto selecionado"}
          </div>
          {resumoLoading && !resumo ? (
            <p className="mt-2 text-sm text-slate-500">Calculando resumo…</p>
          ) : resumo ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">
                    Entradas
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                    {formatQty(resumo.entradas)}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      {resumo.unidade}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">
                    Saídas
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                    {formatQty(resumo.saidas)}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      {resumo.unidade}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">
                    Diferença
                  </div>
                  <div
                    className={`mt-0.5 text-lg font-semibold tabular-nums ${
                      resumo.diferenca > 0
                        ? "text-emerald-700"
                        : resumo.diferenca < 0
                          ? "text-amber-800"
                          : "text-slate-900"
                    }`}
                  >
                    {resumo.diferenca > 0 ? "+" : ""}
                    {formatQty(resumo.diferenca)}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      {resumo.unidade}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">
                    Estoque atual
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                    {formatQty(resumo.estoqueAtual)}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      {resumo.unidade}
                    </span>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Período {formatPeriodo(resumo.dataInicio, resumo.dataFim)} ·
                resumo do produto (entradas e saídas concluídas). A lista abaixo
                segue os filtros.
              </p>
            </>
          ) : null}
        </div>
      )}

      {error && <p className="mt-2 text-red-600">{error}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
      {loading && <p className="mt-2 text-sm text-slate-500">Carregando…</p>}

      <div className="mt-3">
        {!loading && data.length === 0 && (
          <p className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-slate-500">
            Nenhuma movimentação nos filtros selecionados.
          </p>
        )}

        {data.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">
                    Operação
                  </th>
                  <th className="min-w-[14rem] px-3 py-2 font-semibold">
                    Tipo / produto
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">
                    Qtd
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">
                    Filial
                  </th>
                  <th className="min-w-[9rem] px-3 py-2 font-semibold">
                    Parceiro
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">
                    Usuário
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">
                    Data
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => {
                  const filialLabel = m.filialDestino
                    ? `${m.filial.sigla} → ${m.filialDestino.sigla}`
                    : m.filial.sigla;
                  const canConfirmarRecebimento = Boolean(
                    m.aguardandoRecebimento &&
                      canTransferencias &&
                      user &&
                      (user.perfil !== "OPERADOR" ||
                        userFilialIds(user).includes(
                          m.aguardandoRecebimento.destinoFilialId
                        ))
                  );
                  const temAcoes =
                    (canManage && m.status === "PENDENTE") ||
                    (canManage &&
                      m.status === "CONCLUIDO" &&
                      !m.estornoDeId) ||
                    (canLancamentos && !!m.retornoPendente) ||
                    (canLancamentos && !!m.termoPendente) ||
                    canConfirmarRecebimento;
                  const painelAberto = painelId === m.id;
                  const isTransfLinha = Boolean(
                    m.transferenciaItemId ||
                      m.filialDestino ||
                      m.aguardandoRecebimento
                  );
                  const accent =
                    m.operacao === "ENTRADA"
                      ? "border-l-emerald-500"
                      : m.operacao === "SAIDA"
                        ? "border-l-red-500"
                        : "border-l-amber-500";
                  const destaque =
                    m.retornoPendente ||
                    m.termoPendente ||
                    m.aguardandoRecebimento;
                  const nfNumero =
                    m.notaFiscalNumero || m.transferenciaNotaFiscalNumero || null;
                  const anexosVisiveis = (() => {
                    const seen = new Set<string>();
                    const out: Array<{
                      id: string;
                      tipo: string;
                      arquivo: string;
                      label?: string | null;
                    }> = [];
                    const push = (a: {
                      id: string;
                      tipo: string;
                      arquivo: string;
                      label?: string | null;
                    }) => {
                      if (!a.arquivo || seen.has(a.arquivo)) return;
                      seen.add(a.arquivo);
                      out.push(a);
                    };
                    if (m.notaFiscalArquivo) {
                      push({
                        id: `nf-${m.id}`,
                        tipo: "NOTA_FISCAL",
                        arquivo: m.notaFiscalArquivo,
                        label: nfNumero ? `NF ${nfNumero}` : "Nota fiscal",
                      });
                    }
                    for (const a of m.anexos || []) push(a);
                    for (const a of m.transferenciaAnexos || []) push(a);
                    return out;
                  })();

                  return (
                    <Fragment key={m.id}>
                      <tr
                        className={`border-b border-slate-100 border-l-4 ${accent} ${
                          destaque
                            ? "bg-amber-50/40"
                            : "hover:bg-slate-50/70"
                        }`}
                      >
                        <td className="px-3 py-2 align-middle">
                          <div className="flex flex-nowrap items-center gap-1">
                            <span
                              className={
                                m.operacao === "ENTRADA"
                                  ? "rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800"
                                  : m.operacao === "SAIDA"
                                    ? "rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800"
                                    : "rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900"
                              }
                            >
                              {m.operacao === "ENTRADA"
                                ? "ENT."
                                : m.operacao === "SAIDA"
                                  ? "SAÍDA"
                                  : "TRANSF."}
                            </span>
                            {isTransfLinha ? (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                                A→B
                              </span>
                            ) : null}
                            {m.status !== "CONCLUIDO" && (
                              <span
                                className={
                                  m.status === "PENDENTE"
                                    ? "rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                                    : m.status === "REJEITADO" ||
                                        m.status === "ESTORNADO"
                                      ? "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                                      : "rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
                                }
                              >
                                {m.status === "PENDENTE"
                                  ? "Pend."
                                  : m.status === "ESTORNADO"
                                    ? "Est."
                                    : m.status === "REJEITADO"
                                      ? "Rej."
                                      : m.status}
                              </span>
                            )}
                            {m.aguardandoRecebimento && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                                Em trânsito
                              </span>
                            )}
                            {m.termoPendente && (
                              <span className="rounded bg-sky-50 px-1 py-0.5 text-[10px] font-medium text-sky-800">
                                Termo
                              </span>
                            )}
                            {m.retornoPendente && (
                              <span className="rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                                Ret.
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="max-w-[18rem] px-3 py-2 align-middle">
                          <div className="truncate font-medium text-slate-900">
                            {m.tipo.nome}
                          </div>
                          <div className="truncate text-xs text-slate-600">
                            <span className="font-mono text-[11px]">
                              {m.produto.codigo}
                            </span>{" "}
                            {m.produto.descricao}
                          </div>
                          {m.series && m.series.length > 0 ? (
                            <div className="mt-0.5 truncate font-mono text-[10px] text-slate-600">
                              S/N:{" "}
                              {m.series
                                .map((s) => s.unidadeSerie.numeroSerie)
                                .join(", ")}
                            </div>
                          ) : null}
                          {nfNumero &&
                          !anexosVisiveis.some((a) => a.tipo === "NOTA_FISCAL") ? (
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              NF {nfNumero}
                            </div>
                          ) : null}
                          {anexosVisiveis.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 rounded bg-sky-50 px-1.5 py-1 ring-1 ring-sky-100">
                              {anexosVisiveis.map((a) => {
                                const href = resolveAssetUrl(a.arquivo);
                                const label =
                                  a.label ||
                                  (a.tipo === "NOTA_FISCAL"
                                    ? "NF"
                                    : a.tipo === "TERMO_COMODATO"
                                      ? "Termo"
                                      : a.tipo === "LAUDO"
                                        ? "Laudo"
                                        : "Anexo");
                                return href ? (
                                  <a
                                    key={a.id}
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[10px] font-medium text-sky-800 hover:underline"
                                    title={label}
                                  >
                                    {label}
                                  </a>
                                ) : (
                                  <span
                                    key={a.id}
                                    className="text-[10px] text-sky-600"
                                  >
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 align-middle tabular-nums font-semibold text-slate-900">
                          {formatQty(Number(m.quantidade))}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-middle font-medium text-slate-800">
                          {filialLabel}
                        </td>
                        <td className="max-w-[12rem] px-3 py-2 align-middle">
                          {m.cliente ? (
                            <div className="truncate">
                              <span className="text-[10px] font-medium uppercase text-slate-400">
                                {m.cliente.tipo === "FORNECEDOR"
                                  ? "Forn."
                                  : "Cli."}
                              </span>{" "}
                              <span className="text-slate-800">
                                {m.cliente.nome}
                              </span>
                              {m.cliente.documento ? (
                                <div className="truncate font-mono text-[11px] text-slate-500">
                                  {m.cliente.documento}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="max-w-[8rem] truncate px-3 py-2 align-middle text-xs text-slate-600">
                          {m.usuario.nome}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-middle tabular-nums text-xs text-slate-700">
                          {new Date(m.dataMovimento).toLocaleDateString("pt-BR")}
                          <span className="ml-1 text-slate-400">
                            {new Date(m.dataMovimento).toLocaleTimeString(
                              "pt-BR",
                              { hour: "2-digit", minute: "2-digit" }
                            )}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-middle">
                          {temAcoes && !painelAberto ? (
                            <div className="inline-flex flex-wrap items-center gap-2">
                              {canConfirmarRecebimento &&
                                m.aguardandoRecebimento && (
                                  <Link
                                    href={`/transferencias/${m.aguardandoRecebimento.transferenciaId}`}
                                    className="rounded border border-amber-300/80 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                                    title="Abrir Transferências desta carga"
                                  >
                                    Confirmar recebimento
                                  </Link>
                                )}
                              {canLancamentos && m.termoPendente && (
                                <button
                                  type="button"
                                  disabled={acting}
                                  onClick={() => abrirPainel(m.id, "termo")}
                                  className="text-xs font-medium text-sky-800 hover:underline disabled:opacity-50"
                                >
                                  Termo
                                </button>
                              )}
                              {canLancamentos && m.retornoPendente && (
                                <Link
                                  href={`/lancamentos/novo?retornoDe=${encodeURIComponent(m.id)}`}
                                  className="text-xs font-medium text-amber-800 hover:underline"
                                >
                                  Retorno
                                </Link>
                              )}
                              {canManage && m.status === "PENDENTE" && (
                                <>
                                  <button
                                    type="button"
                                    disabled={acting}
                                    onClick={() => aprovar(m.id)}
                                    className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                                  >
                                    Aprovar
                                  </button>
                                  <button
                                    type="button"
                                    disabled={acting}
                                    onClick={() =>
                                      abrirPainel(m.id, "rejeitar")
                                    }
                                    className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
                                  >
                                    Rejeitar
                                  </button>
                                </>
                              )}
                              {canManage &&
                                m.status === "CONCLUIDO" &&
                                !m.estornoDeId && (
                                  <button
                                    type="button"
                                    disabled={acting}
                                    onClick={() =>
                                      abrirPainel(m.id, "estornar")
                                    }
                                    className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
                                  >
                                    Estornar
                                  </button>
                                )}
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                      {painelAberto && (
                        <tr className="border-b border-slate-100 bg-slate-50/50">
                          <td colSpan={8} className="px-3 py-3">
                            {canManage && painelAcao === "rejeitar" && (
                              <ConfirmMotivoPanel
                                title="Confirmar rejeição"
                                confirmLabel="Confirmar rejeição"
                                motivoLabel="Motivo"
                                motivo={motivo}
                                onMotivoChange={setMotivo}
                                onConfirm={() => confirmarRejeicao(m.id)}
                                onCancel={fecharPainel}
                                loading={acting}
                                danger
                              />
                            )}
                            {canManage && painelAcao === "estornar" && (
                              <ConfirmMotivoPanel
                                title={`Estornar ${m.tipo.nome} — ${m.produto.codigo}?`}
                                confirmLabel="Confirmar estorno"
                                motivoLabel="Observação"
                                motivoPlaceholder="Motivo do estorno (opcional)"
                                motivo={motivo}
                                onMotivoChange={setMotivo}
                                onConfirm={() => confirmarEstorno(m.id)}
                                onCancel={fecharPainel}
                                loading={acting}
                                danger
                              >
                                <p className="text-xs text-slate-600">
                                  O saldo será revertido e o movimento original
                                  ficará ESTORNADO.
                                </p>
                              </ConfirmMotivoPanel>
                            )}
                            {canLancamentos && painelAcao === "termo" && (
                              <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
                                <p className="text-sm font-medium text-sky-950">
                                  Anexar termo de comodato assinado
                                </p>
                                <p className="mt-1 text-xs text-sky-900/80">
                                  PDF ou imagem do termo que voltou do cliente.
                                </p>
                                <input
                                  type="file"
                                  accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
                                  disabled={termoUploading || acting}
                                  className="mt-2 w-full max-w-md rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-sky-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-sky-900"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = "";
                                    if (file) void anexarTermo(m.id, file);
                                  }}
                                />
                                <div className="mt-2 flex gap-3">
                                  <button
                                    type="button"
                                    disabled={acting}
                                    onClick={fecharPainel}
                                    className="text-sm text-slate-600 hover:underline disabled:opacity-50"
                                  >
                                    Cancelar
                                  </button>
                                  {termoUploading && (
                                    <span className="text-xs text-sky-800">
                                      Enviando…
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
        >
          Anterior
        </button>
        <span className="text-sm text-slate-500">
          Página {page} · {total} registros
        </span>
        <button
          disabled={page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
    </>
  );
}
