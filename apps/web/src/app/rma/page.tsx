"use client";

import { api } from "@/lib/api";
import { matchNomeOuDocumento } from "@/lib/documento";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  RMA_ITEM_ETAPA,
  RMA_ITEM_ETAPA_LABELS,
  RMA_PROCESSO_STATUS,
} from "@teep/shared";

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
  responsavelComercial?: { id: string; nome: string } | null;
  itens?: Array<{ id: string; status: string; etapa?: string; cobrou?: boolean | null }>;
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

const PROCESSO_STATUS_SET = new Set<string>(RMA_PROCESSO_STATUS);

function resumoEtapasItens(
  itens?: Array<{ etapa?: string }>
): string {
  if (!itens?.length) return "";
  const counts = new Map<string, number>();
  for (const i of itens) {
    const e = i.etapa || "AGUARDANDO_RECEBIMENTO";
    counts.set(e, (counts.get(e) || 0) + 1);
  }
  return [...counts.entries()]
    .map(
      ([e, n]) =>
        `${n} ${(RMA_ITEM_ETAPA_LABELS as Record<string, string>)[e] || e}`
    )
    .join(" · ");
}

const MS_8_DIAS = 8 * 24 * 60 * 60 * 1000;

/** Tom lúdico/sutil: fechado verde · aberto neutro · aberto >8d âmbar (atrasado). */
function tomCardRma(status: string, criadoEm: string) {
  if (status === "FECHADO") {
    return {
      card: "border-emerald-200/80 bg-emerald-50/50 hover:border-emerald-300",
      badge: "bg-emerald-100 text-emerald-800",
      dot: "bg-emerald-500",
    };
  }
  if (status === "ABERTO") {
    const atrasado = Date.now() - new Date(criadoEm).getTime() > MS_8_DIAS;
    if (atrasado) {
      return {
        card: "border-amber-200/70 bg-amber-50/40 hover:border-amber-300",
        badge: "bg-amber-100 text-amber-900",
        dot: "bg-amber-400",
      };
    }
    return {
      card: "border-slate-200 bg-white hover:border-brand/40",
      badge: "bg-slate-100 text-slate-700",
      dot: "bg-slate-400",
    };
  }
  // CANCELADO e outros
  return {
    card: "border-slate-200 bg-slate-50/40 hover:border-slate-300",
    badge: "bg-slate-200/80 text-slate-700",
    dot: "bg-slate-400",
  };
}

export default function RmaListPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-slate-500">Carregando…</p>}
    >
      <RmaListPageInner />
    </Suspense>
  );
}

function RmaListPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [etapa, setEtapa] = useState("");
  const [cobrou, setCobrou] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(false);
  /** Ignora respostas antigas quando o filtro muda rápido. */
  const fetchGen = useRef(0);

  useEffect(() => {
    const ok = searchParams.get("ok");
    if (ok === "criado") {
      setFlash("RMA aberto com sucesso.");
      router.replace("/rma", { scroll: false });
    } else if (ok === "laudos") {
      setFlash("Laudos notificados.");
      router.replace("/rma", { scroll: false });
    }
  }, [searchParams, router]);

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
    if (etapa) params.set("etapa", etapa);
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
  }, [page, status, etapa, cobrou, dataInicio, dataFim, clienteId]);

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
          value={status || etapa}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              setStatus("");
              setEtapa("");
            } else if (PROCESSO_STATUS_SET.has(v)) {
              setStatus(v);
              setEtapa("");
            } else {
              setStatus("");
              setEtapa(v);
            }
            resetPage();
          }}
          className="rounded-lg border px-3 py-2 text-sm"
          aria-label="Filtrar por status ou etapa"
        >
          <option value="">Status: todos</option>
          <optgroup label="Processo">
            {RMA_PROCESSO_STATUS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s] || s}
              </option>
            ))}
          </optgroup>
          <optgroup label="Etapa do item">
            {RMA_ITEM_ETAPA.map((e) => (
              <option key={e} value={e}>
                {RMA_ITEM_ETAPA_LABELS[e]}
              </option>
            ))}
          </optgroup>
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

      {flash && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {flash}
        </p>
      )}
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
        {data.map((r) => {
          const tom = tomCardRma(r.status, r.criadoEm);
          return (
            <Link
              key={r.id}
              href={`/rma/${r.id}`}
              className={`block rounded-xl border px-4 py-3 text-sm shadow-sm transition-colors ${tom.card}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${tom.badge}`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${tom.dot}`}
                    aria-hidden
                  />
                  {STATUS_LABEL[r.status] || r.status}
                </span>
                <span className="font-medium text-slate-900">
                  {r.cliente.nome}
                </span>
                <span className="text-slate-400">·</span>
                <span className="font-mono text-xs text-slate-600">
                  {r.filial.sigla}
                </span>
                <span className="ml-auto text-xs text-slate-500">
                  {new Date(r.criadoEm).toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="mt-1 text-slate-600">
                {r._count.itens} item{r._count.itens === 1 ? "" : "s"}
                {r.nfEntradaNumero ? ` · NF ent. ${r.nfEntradaNumero}` : ""}
                {r.nfSaidaNumero ? ` · NF saí. ${r.nfSaidaNumero}` : ""}
                {(() => {
                  const cobrados = (r.itens || []).filter((i) => i.cobrou === true);
                  if (cobrados.length > 0) {
                    return ` · ${cobrados.length} com cobrança`;
                  }
                  return "";
                })()}
              </div>
              {r.status === "ABERTO" && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  {r.responsavelComercial?.nome && (
                    <span>
                      Comercial:{" "}
                      <span className="font-medium text-slate-800">
                        {r.responsavelComercial.nome}
                      </span>
                    </span>
                  )}
                  {resumoEtapasItens(r.itens) && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                      {resumoEtapasItens(r.itens)}
                    </span>
                  )}
                </div>
              )}
            </Link>
          );
        })}
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
