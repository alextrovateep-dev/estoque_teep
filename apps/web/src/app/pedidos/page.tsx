"use client";

import { api } from "@/lib/api";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Row = {
  id: string;
  egestorCodigo: number;
  nomeContato: string;
  dtVenda: string;
  situacao: number;
  situacaoOs: string | null;
  status: string;
  valorTotal: string | number;
  filialAcabado?: { sigla: string } | null;
  _count: { itens: number };
};

function situacaoLabel(row: Row) {
  if (row.situacao === 10) return "Orçamento";
  return row.situacaoOs || "Em espera";
}

function PedidosInner() {
  const searchParams = useSearchParams();
  const tab = searchParams.get("status") === "SEPARADO" ? "SEPARADO" : "ABERTO";
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
        `Sincronizado: ${r.upserted} atualizado(s), ${r.removed} removido(s) da fila.`
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
            Orçamentos em espera no eGestor. Separação baixa o estoque de
            acabados.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={syncing}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {syncing ? "Atualizando…" : "Atualizar do eGestor"}
        </button>
      </div>
      {syncing && (
        <p className="mt-2 text-sm text-slate-500">
          Consultando o eGestor. Há muitas páginas de orçamento; a atualização
          pode levar alguns minutos (limite de 60 consultas por minuto).
        </p>
      )}

      <div className="mt-4 flex gap-2 text-sm">
        <Link
          href="/pedidos"
          className={
            tab === "ABERTO"
              ? "rounded-lg bg-brand px-3 py-1.5 font-medium text-white"
              : "rounded-lg border px-3 py-1.5"
          }
        >
          Em aberto
        </Link>
        <Link
          href="/pedidos?status=SEPARADO"
          className={
            tab === "SEPARADO"
              ? "rounded-lg bg-brand px-3 py-1.5 font-medium text-white"
              : "rounded-lg border px-3 py-1.5"
          }
        >
          Separados
        </Link>
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

      <ul className="mt-6 space-y-2">
        {lista.length === 0 && (
          <li className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            Nenhum pedido nesta lista.
          </li>
        )}
        {lista.map((p) => (
          <li key={p.id}>
            <Link
              href={`/pedidos/${p.id}`}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-brand/40"
            >
              <div>
                <div className="font-medium">
                  #{p.egestorCodigo}
                  <span className="text-slate-400"> — </span>
                  {p.nomeContato}
                </div>
                <div className="text-xs text-slate-500">
                  {situacaoLabel(p)} · {p._count.itens} item(ns)
                  {p.filialAcabado ? ` · ${p.filialAcabado.sigla}` : ""}
                </div>
              </div>
              <span className="text-sm text-brand">Abrir</span>
            </Link>
          </li>
        ))}
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
