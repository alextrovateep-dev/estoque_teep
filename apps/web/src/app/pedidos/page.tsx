"use client";

import { api } from "@/lib/api";
import {
  isPedidoStatus,
  PEDIDO_STATUS,
  PEDIDO_STATUS_LABELS,
  type PedidoStatus,
} from "@teep/shared";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Row = {
  id: string;
  egestorCodigo: number;
  nomeContato: string;
  clienteId?: string | null;
  cliente?: { id: string; nome: string } | null;
  dtVenda: string;
  status: string;
  filialAcabado?: { sigla: string } | null;
  liberadoEm?: string | null;
  rastreio?: string | null;
  nfNumero?: string | null;
  _count: { itens: number };
};

function tabFromQuery(raw: string | null): PedidoStatus {
  if (raw === "AGUARDANDO") return "SEPARADO";
  return raw && isPedidoStatus(raw) ? raw : "ABERTO";
}

function hrefTab(status: PedidoStatus) {
  return status === "ABERTO" ? "/pedidos" : `/pedidos?status=${status}`;
}

function dataCurta(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function PedidosInner() {
  const searchParams = useSearchParams();
  const tab = tabFromQuery(searchParams.get("status"));
  const [lista, setLista] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function load(status: string) {
    setError("");
    const data = await api<Row[]>(`/pedidos?status=${status}`);
    setLista(data);
  }

  useEffect(() => {
    load(tab).catch((e) =>
      setError(e instanceof Error ? e.message : "Erro ao carregar")
    );
  }, [tab]);

  async function syncNow() {
    setSyncing(true);
    setError("");
    setMsg("");
    try {
      const r = await api<{ upserted: number; removed: number }>(
        "/pedidos/sync",
        { method: "POST" }
      );
      setMsg(
        `Sincronizado: ${r.upserted} atualizado(s), ${r.removed} removido(s).`
      );
      await load(tab);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no sync");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pedidos</h1>
          <p className="mt-1 text-sm text-slate-500">
            Em aberto → separar → enviado.
          </p>
        </div>
        {tab === "ABERTO" && (
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={syncing}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {syncing ? "Atualizando…" : "Atualizar do eGestor"}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {PEDIDO_STATUS.map((st) => (
          <Link
            key={st}
            href={hrefTab(st)}
            className={
              tab === st
                ? "rounded-lg bg-brand px-3 py-1.5 font-medium text-white"
                : "rounded-lg border px-3 py-1.5"
            }
          >
            {PEDIDO_STATUS_LABELS[st]}
          </Link>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {msg && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      )}

      <ul className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {lista.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-slate-500">
            Nenhum pedido nesta lista.
          </li>
        )}
        {lista.map((p) => {
          const cliente = p.cliente?.nome || p.nomeContato;
          const extra =
            tab === "SEPARADO"
              ? "Aguardando envio"
              : tab === "ENVIADO"
                ? [p.rastreio ? `Rastreio ${p.rastreio}` : null, p.nfNumero ? `NF ${p.nfNumero}` : null]
                    .filter(Boolean)
                    .join(" · ")
                : dataCurta(p.dtVenda);
          return (
            <li key={p.id}>
              <Link
                href={`/pedidos/${p.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    #{p.egestorCodigo}
                    <span className="font-normal text-slate-500">
                      {" "}
                      · {cliente}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {p._count.itens} item(ns)
                    {p.filialAcabado ? ` · ${p.filialAcabado.sigla}` : ""}
                    {extra ? ` · ${extra}` : ""}
                    {tab === "ABERTO" && !p.clienteId ? " · Sem cliente" : ""}
                  </div>
                </div>
                <span className="shrink-0 text-sm text-brand">Abrir</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function PedidosPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
      <PedidosInner />
    </Suspense>
  );
}
