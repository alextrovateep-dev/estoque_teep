"use client";

import { api, apiDownload, getStoredUser, userFilialIds } from "@/lib/api";
import { matchNomeOuDocumento } from "@/lib/documento";
import {
  RMA_ITEM_ETAPA,
  RMA_ITEM_ETAPA_LABELS,
} from "@teep/shared";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Filial = { id: string; nome: string; sigla: string };
type Cliente = {
  id: string;
  nome: string;
  tipo: string;
  documento?: string | null;
  ativo: boolean;
};
type Produto = { id: string; codigo: string; descricao: string };

type RmaProdutoRow = {
  itemId: string;
  processoId: string;
  processoCurto: string;
  processoStatus: string;
  processoStatusLabel: string;
  criadoEm: string;
  clienteNome: string;
  filialSigla: string;
  codigo: string;
  descricao: string;
  numeroSerie: string | null;
  quantidade: number;
  itemStatus: string;
  itemStatusLabel: string;
  etapa: string;
  etapaLabel: string;
  nfEntradaNumero: string | null;
  prazoManutencao: string | null;
};

type Meta = {
  linhas: number;
  quantidadeTotal: number;
  truncado: boolean;
  total: number;
  itemStatusFiltro: string;
  processoStatusFiltro: string;
  cliente: string | null;
  produto: string | null;
};

function qty(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

export function RmaProdutosRelatorioTab() {
  const [rows, setRows] = useState<RmaProdutoRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [filialId, setFilialId] = useState("");
  const [etapa, setEtapa] = useState("");
  const [itemStatus, setItemStatus] = useState("em_rma");
  const [processoStatus, setProcessoStatus] = useState("aberto");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);

  const [produtoId, setProdutoId] = useState("");
  const [produtoQuery, setProdutoQuery] = useState("");
  const [produtoOpen, setProdutoOpen] = useState(false);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [error, setError] = useState("");
  const fetchGen = useRef(0);

  const buscaHydrated = useRef(false);
  useEffect(() => {
    const next = q.trim();
    const t = window.setTimeout(() => {
      setQDebounced(next);
      if (!buscaHydrated.current) {
        buscaHydrated.current = true;
        return;
      }
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const user = getStoredUser();
    const allowed = user ? new Set(userFilialIds(user)) : null;
    api<Filial[]>("/filiais")
      .then((list) =>
        setFiliais(
          allowed && allowed.size > 0
            ? list.filter((f) => allowed.has(f.id))
            : list
        )
      )
      .catch(() => setFiliais([]));
    api<Cliente[]>("/clientes")
      .then((c) =>
        setClientes(
          c.filter((x) => x.ativo !== false && x.tipo !== "FORNECEDOR")
        )
      )
      .catch(() => setClientes([]));
    api<Produto[]>("/produtos")
      .then(setProdutos)
      .catch(() => setProdutos([]));
  }, []);

  const clientesFiltrados = useMemo(
    () =>
      clientes
        .filter((c) =>
          matchNomeOuDocumento(c.nome, c.documento, clienteQuery)
        )
        .slice(0, 20),
    [clientes, clienteQuery]
  );

  const produtosFiltrados = useMemo(() => {
    const term = produtoQuery.trim().toLowerCase();
    if (!term) return produtos.slice(0, 20);
    return produtos
      .filter(
        (p) =>
          p.codigo.toLowerCase().includes(term) ||
          p.descricao.toLowerCase().includes(term)
      )
      .slice(0, 20);
  }, [produtos, produtoQuery]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (qDebounced) p.set("q", qDebounced);
    if (filialId) p.set("filialId", filialId);
    if (clienteId) p.set("clienteId", clienteId);
    if (produtoId) p.set("produtoId", produtoId);
    if (etapa) p.set("etapa", etapa);
    if (itemStatus) p.set("itemStatus", itemStatus);
    if (processoStatus) p.set("processoStatus", processoStatus);
    if (dataInicio) p.set("dataInicio", dataInicio);
    if (dataFim) p.set("dataFim", dataFim);
    return p.toString();
  }, [
    page,
    qDebounced,
    filialId,
    clienteId,
    produtoId,
    etapa,
    itemStatus,
    processoStatus,
    dataInicio,
    dataFim,
  ]);

  useEffect(() => {
    const gen = ++fetchGen.current;
    setLoading(true);
    setError("");
    void api<{
      rows: RmaProdutoRow[];
      total: number;
      meta: Meta;
    }>(`/relatorios/rma-produtos?${queryString}`)
      .then((r) => {
        if (gen !== fetchGen.current) return;
        setRows(r.rows);
        setTotal(r.total);
        setMeta(r.meta);
      })
      .catch((e: Error) => {
        if (gen !== fetchGen.current) return;
        setError(e.message || "Erro ao carregar relatório");
        setRows([]);
        setTotal(0);
        setMeta(null);
      })
      .finally(() => {
        if (gen === fetchGen.current) setLoading(false);
      });
  }, [queryString]);

  async function exportar(format: "pdf" | "xlsx") {
    setExporting(format);
    setError("");
    try {
      const p = new URLSearchParams(queryString);
      p.delete("page");
      p.delete("pageSize");
      const { blob, filename } = await apiDownload(
        `/relatorios/rma-produtos/export.${format}?${p.toString()}`,
        {
          fallbackFilename: `teep-rma-produtos.${format === "pdf" ? "pdf" : "xlsx"}`,
        }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na exportação");
    } finally {
      setExporting(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Lista produtos em RMA com nome do cliente e quantidade de itens.
          Filtre por cliente e/ou produto; por padrão mostra processos abertos
          com itens ainda no depósito RMA.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={
              !!exporting || (!loading && total === 0 && rows.length === 0)
            }
            onClick={() => void exportar("pdf")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-brand/40 disabled:opacity-50"
          >
            {exporting === "pdf" ? "Gerando…" : "Exportar PDF"}
          </button>
          <button
            type="button"
            disabled={
              !!exporting || (!loading && total === 0 && rows.length === 0)
            }
            onClick={() => void exportar("xlsx")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-brand/40 disabled:opacity-50"
          >
            {exporting === "xlsx" ? "Gerando…" : "Exportar Excel"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <div className="relative min-w-[12rem] flex-1 text-xs">
          <span className="mb-1 block font-medium text-slate-600">Cliente</span>
          <div className="flex gap-1">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder={
                clienteId ? "Cliente selecionado" : "Filtrar por cliente…"
              }
              value={clienteQuery}
              onChange={(e) => {
                setClienteQuery(e.target.value);
                setClienteOpen(true);
                if (clienteId) setClienteId("");
                setPage(1);
              }}
              onFocus={() => setClienteOpen(true)}
              onBlur={() => setTimeout(() => setClienteOpen(false), 160)}
              autoComplete="off"
            />
            {(clienteId || clienteQuery) && (
              <button
                type="button"
                className="shrink-0 rounded-lg border border-slate-200 px-2 text-slate-500 hover:bg-slate-50"
                title="Limpar cliente"
                onClick={() => {
                  setClienteId("");
                  setClienteQuery("");
                  setPage(1);
                }}
              >
                ×
              </button>
            )}
          </div>
          {clienteOpen && !clienteId && clienteQuery.trim().length >= 1 && (
            <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {clientesFiltrados.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">
                  Nenhum cliente
                </li>
              ) : (
                clientesFiltrados.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setClienteId(c.id);
                        setClienteQuery(c.nome);
                        setClienteOpen(false);
                        setPage(1);
                      }}
                    >
                      {c.nome}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <div className="relative min-w-[14rem] flex-1 text-xs">
          <span className="mb-1 block font-medium text-slate-600">Produto</span>
          <div className="flex gap-1">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder={
                produtoId ? "Produto selecionado" : "Filtrar por produto…"
              }
              value={produtoQuery}
              onChange={(e) => {
                setProdutoQuery(e.target.value);
                setProdutoOpen(true);
                if (produtoId) setProdutoId("");
                setPage(1);
              }}
              onFocus={() => setProdutoOpen(true)}
              onBlur={() => setTimeout(() => setProdutoOpen(false), 160)}
              autoComplete="off"
            />
            {(produtoId || produtoQuery) && (
              <button
                type="button"
                className="shrink-0 rounded-lg border border-slate-200 px-2 text-slate-500 hover:bg-slate-50"
                title="Limpar produto"
                onClick={() => {
                  setProdutoId("");
                  setProdutoQuery("");
                  setPage(1);
                }}
              >
                ×
              </button>
            )}
          </div>
          {produtoOpen && !produtoId && produtoQuery.trim().length >= 1 && (
            <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {produtosFiltrados.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">
                  Nenhum produto
                </li>
              ) : (
                produtosFiltrados.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setProdutoId(p.id);
                        setProdutoQuery(`${p.codigo} — ${p.descricao}`);
                        setProdutoOpen(false);
                        setPage(1);
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

        <label className="min-w-[10rem] flex-1 text-xs">
          <span className="mb-1 block font-medium text-slate-600">
            Busca livre
          </span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
            placeholder="Série, NF, código…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
        </label>

        <label className="w-36 text-xs">
          <span className="mb-1 block font-medium text-slate-600">Estoque</span>
          <select
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-brand"
            value={filialId}
            onChange={(e) => {
              setFilialId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.sigla}
              </option>
            ))}
          </select>
        </label>

        <label className="w-44 text-xs">
          <span className="mb-1 block font-medium text-slate-600">Etapa</span>
          <select
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-brand"
            value={etapa}
            onChange={(e) => {
              setEtapa(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {RMA_ITEM_ETAPA.filter((e) => e !== "AGUARDANDO_LAUDO").map(
              (e) => (
                <option key={e} value={e}>
                  {RMA_ITEM_ETAPA_LABELS[e]}
                </option>
              )
            )}
          </select>
        </label>

        <label className="w-40 text-xs">
          <span className="mb-1 block font-medium text-slate-600">
            Status item
          </span>
          <select
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-brand"
            value={itemStatus}
            onChange={(e) => {
              setItemStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="em_rma">Em RMA (padrão)</option>
            <option value="todos">Todos (exceto cancel.)</option>
            <option value="EM_ESTOQUE">Em estoque RMA</option>
            <option value="SEM_MANUTENCAO">Sem manutenção</option>
            <option value="DEVOLVIDO">Devolvido</option>
            <option value="DESCARTADO">Descartado</option>
            <option value="ABERTO">Aberto</option>
          </select>
        </label>

        <label className="w-36 text-xs">
          <span className="mb-1 block font-medium text-slate-600">
            Processo
          </span>
          <select
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-brand"
            value={processoStatus}
            onChange={(e) => {
              setProcessoStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="aberto">Aberto (padrão)</option>
            <option value="todos">Todos</option>
            <option value="FECHADO">Fechado</option>
            <option value="CANCELADO">Cancelado</option>
          </select>
        </label>

        <label className="w-36 text-xs">
          <span className="mb-1 block font-medium text-slate-600">De</span>
          <input
            type="date"
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-brand"
            value={dataInicio}
            onChange={(e) => {
              setDataInicio(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="w-36 text-xs">
          <span className="mb-1 block font-medium text-slate-600">Até</span>
          <input
            type="date"
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-brand"
            value={dataFim}
            onChange={(e) => {
              setDataFim(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {meta && !loading && (
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Itens (linhas)
            </div>
            <div className="font-semibold tabular-nums text-slate-900">
              {meta.linhas.toLocaleString("pt-BR")}
              {meta.truncado
                ? ` / ${meta.total.toLocaleString("pt-BR")}`
                : ""}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Qtd. itens
            </div>
            <div className="font-semibold tabular-nums text-slate-900">
              {qty(meta.quantidadeTotal)}
            </div>
          </div>
          {meta.cliente && (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Cliente
              </div>
              <div className="font-medium text-slate-900">{meta.cliente}</div>
            </div>
          )}
          {meta.produto && (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Produto
              </div>
              <div className="font-medium text-slate-900">{meta.produto}</div>
            </div>
          )}
          <div className="self-center text-xs text-slate-500">
            {meta.itemStatusFiltro} · {meta.processoStatusFiltro}
          </div>
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">RMA</th>
              <th className="px-3 py-2 font-medium">Aberto em</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Estoque</th>
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Descrição</th>
              <th className="px-3 py-2 font-medium">Série</th>
              <th className="px-3 py-2 font-medium text-right">Qtd. itens</th>
              <th className="px-3 py-2 font-medium">Etapa</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">NF entrada</th>
              <th className="px-3 py-2 font-medium">Prazo</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={12}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Carregando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={12}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Nenhum produto em RMA com os filtros atuais.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.itemId}
                  className="border-b border-slate-50 hover:bg-slate-50/80"
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/rma/${r.processoId}`}
                      className="text-brand hover:underline"
                    >
                      {r.processoCurto}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {r.criadoEm}
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2" title={r.clienteNome}>
                    {r.clienteNome}
                  </td>
                  <td className="px-3 py-2">{r.filialSigla}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.codigo}</td>
                  <td
                    className="max-w-[14rem] truncate px-3 py-2"
                    title={r.descricao}
                  >
                    {r.descricao}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.numeroSerie || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {qty(r.quantidade)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {r.etapaLabel}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.itemStatusLabel}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.nfEntradaNumero || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {r.prazoManutencao || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-slate-500">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
