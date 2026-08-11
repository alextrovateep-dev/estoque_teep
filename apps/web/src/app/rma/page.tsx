"use client";

import { api } from "@/lib/api";
import { matchNomeOuDocumento } from "@/lib/documento";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Row = {
  id: string;
  status: string;
  cobrou: boolean | null;
  valorCobrado: string | number | null;
  nfEntradaNumero: string | null;
  nfSaidaNumero: string | null;
  criadoEm: string;
  cliente: { id: string; nome: string; documento?: string | null };
  filial: { id: string; sigla: string; nome: string };
  _count: { itens: number };
};

type Cliente = {
  id: string;
  nome: string;
  tipo: string;
  documento?: string | null;
  ativo: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  ABERTO: "Aberto",
  FECHADO: "Fechado",
  CANCELADO: "Cancelado",
};

export default function RmaListPage() {
  const [data, setData] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [cobrou, setCobrou] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /** Ignora respostas antigas quando o filtro muda rápido. */
  const fetchGen = useRef(0);

  useEffect(() => {
    api<Cliente[]>("/clientes")
      .then((c) =>
        setClientes(
          c.filter((x) => x.ativo !== false && x.tipo !== "FORNECEDOR")
        )
      )
      .catch(() => {
        /* lista de clientes é opcional para o filtro */
      });
  }, []);

  const clientesFiltrados = useMemo(() => {
    return clientes
      .filter((c) => matchNomeOuDocumento(c.nome, c.documento, clienteQuery))
      .slice(0, 20);
  }, [clientes, clienteQuery]);

  useEffect(() => {
    const gen = ++fetchGen.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "20",
    });
    if (status) params.set("status", status);
    if (cobrou) params.set("cobrou", cobrou);
    if (dataInicio) params.set("dataInicio", dataInicio);
    if (dataFim) params.set("dataFim", dataFim);
    if (clienteId) params.set("clienteId", clienteId);

    void api<{ data: Row[]; total: number }>(`/rma?${params}`)
      .then((r) => {
        if (gen !== fetchGen.current) return;
        setData(r.data);
        setTotal(r.total);
      })
      .catch((e) => {
        if (gen !== fetchGen.current) return;
        setError(e instanceof Error ? e.message : "Erro");
      })
      .finally(() => {
        if (gen === fetchGen.current) setLoading(false);
      });
  }, [page, status, cobrou, dataInicio, dataFim, clienteId]);

  function resetPage() {
    setPage(1);
  }

  function limparCliente() {
    setClienteId("");
    setClienteQuery("");
    resetPage();
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">RMA</h1>
          <p className="mt-1 text-sm text-slate-500">
            Entrada no Estoque RMA, laudo, cobrança e devolução ao cliente.
          </p>
        </div>
        <Link
          href="/rma/novo"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Novo RMA
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-xs text-slate-500">De</span>
          <input
            type="date"
            value={dataInicio}
            max={dataFim || undefined}
            onChange={(e) => {
              setDataInicio(e.target.value);
              resetPage();
            }}
            className="w-[9.5rem] rounded-lg border px-2 py-2 text-sm"
            aria-label="Data início"
          />
          <span className="shrink-0 text-xs text-slate-500">até</span>
          <input
            type="date"
            value={dataFim}
            min={dataInicio || undefined}
            onChange={(e) => {
              setDataFim(e.target.value);
              resetPage();
            }}
            className="w-[9.5rem] rounded-lg border px-2 py-2 text-sm"
            aria-label="Data fim"
          />
        </div>

        <div className="relative min-w-[14rem] flex-1 basis-[14rem]">
          <div className="flex gap-1">
            <input
              value={clienteQuery}
              onChange={(e) => {
                setClienteQuery(e.target.value);
                setClienteId("");
                setClienteOpen(true);
                resetPage();
              }}
              onFocus={() => setClienteOpen(true)}
              onBlur={() => setTimeout(() => setClienteOpen(false), 150)}
              placeholder="Cliente: nome ou documento…"
              className="w-full min-w-0 rounded-lg border px-3 py-2 text-sm"
              autoComplete="off"
            />
            {(clienteId || clienteQuery) && (
              <button
                type="button"
                onClick={limparCliente}
                className="shrink-0 rounded-lg border px-2 text-slate-500 hover:bg-slate-50"
                title="Limpar cliente"
              >
                ×
              </button>
            )}
          </div>
          {clienteOpen && clienteQuery.trim() && !clienteId && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-white shadow-lg">
              {clientesFiltrados.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">
                  Nenhum cliente encontrado
                </li>
              ) : (
                clientesFiltrados.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setClienteId(c.id);
                        setClienteQuery(c.nome);
                        setClienteOpen(false);
                        resetPage();
                      }}
                    >
                      {c.nome}
                      {c.documento ? (
                        <span className="ml-1 text-xs text-slate-400">
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

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            resetPage();
          }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Status: todos</option>
          <option value="ABERTO">Aberto</option>
          <option value="FECHADO">Fechado</option>
          <option value="CANCELADO">Cancelado</option>
        </select>
        <select
          value={cobrou}
          onChange={(e) => {
            setCobrou(e.target.value);
            resetPage();
          }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Cobrança: todas</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
          <option value="null">Não informado</option>
        </select>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading && <p className="mt-3 text-sm text-slate-500">Carregando…</p>}

      <div className="mt-4 space-y-2">
        {!loading && data.length === 0 && (
          <p className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-slate-500">
            Nenhum processo RMA.
          </p>
        )}
        {data.map((r) => (
          <Link
            key={r.id}
            href={`/rma/${r.id}`}
            className="block rounded-xl border bg-white px-4 py-3 text-sm shadow-sm hover:border-brand/40"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {STATUS_LABEL[r.status] || r.status}
              </span>
              <span className="font-medium">{r.cliente.nome}</span>
              <span className="text-slate-400">·</span>
              <span className="font-mono text-xs">{r.filial.sigla}</span>
              <span className="ml-auto text-xs text-slate-500">
                {new Date(r.criadoEm).toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="mt-1 text-slate-600">
              {r._count.itens} item{r._count.itens === 1 ? "" : "s"}
              {r.nfEntradaNumero ? ` · NF ent. ${r.nfEntradaNumero}` : ""}
              {r.nfSaidaNumero ? ` · NF saí. ${r.nfSaidaNumero}` : ""}
              {r.cobrou === true
                ? ` · Cobrou R$ ${Number(r.valorCobrado || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                : r.cobrou === false
                  ? " · Sem cobrança"
                  : ""}
            </div>
          </Link>
        ))}
      </div>

      {total > 20 && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-sm text-slate-500">
            Página {page} · {total}
          </span>
          <button
            type="button"
            disabled={page * 20 >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </>
  );
}
