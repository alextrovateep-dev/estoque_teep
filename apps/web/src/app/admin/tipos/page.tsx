"use client";

import { api } from "@/lib/api";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useEffect, useState } from "react";

type Tipo = {
  id: string;
  nome: string;
  operacao: "ENTRADA" | "SAIDA" | "TRANSFERENCIA";
  sistema: boolean;
  ativo: boolean;
  requerCliente: boolean;
  requerAprovacao: boolean;
  permitidoOperador: boolean;
  permitidoGerente: boolean;
  geraAlertaRetorno?: boolean;
  diasAlerta?: number[] | null;
  ehRetornoDeId?: string | null;
  requerTermoComodato?: boolean;
  baixaPorArvore?: boolean;
  descricao?: string | null;
};

const OPERACOES: Array<{ value: Tipo["operacao"]; label: string }> = [
  { value: "ENTRADA", label: "Entrada" },
  { value: "SAIDA", label: "Saída" },
  { value: "TRANSFERENCIA", label: "Transferência" },
];

function operacaoLabel(op: Tipo["operacao"]): string {
  return OPERACOES.find((o) => o.value === op)?.label ?? op;
}

function formatDiasChip(dias?: number[] | null): string | null {
  if (!Array.isArray(dias) || dias.length === 0) return null;
  return dias.join(" · ") + " dias";
}

function alertaChipLabel(dias?: number[] | null): string {
  const fmt = formatDiasChip(dias);
  return fmt ? `Alertas: ${fmt}` : "Alertas retorno";
}

function FlagChip({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "emerald" | "rose" | "amber" | "brand";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-800",
    rose: "bg-rose-100 text-rose-800",
    amber: "bg-amber-100 text-amber-900",
    brand: "bg-brand/10 text-brand",
  };
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export default function TiposPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-slate-500">Carregando…</p>}
    >
      <TiposPageInner />
    </Suspense>
  );
}

function TiposPageInner() {
  const searchParams = useSearchParams();
  const [lista, setLista] = useState<Tipo[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setLista(await api<Tipo[]>("/tipos-movimentacao"));
  }

  useEffect(() => {
    const ok = searchParams.get("ok");
    if (ok === "criado") setMsg("Tipo cadastrado");
    else if (ok === "atualizado") setMsg("Tipo atualizado");
    load().catch((e) =>
      setError(e instanceof Error ? e.message : "Erro ao carregar")
    );
  }, [searchParams]);

  async function toggle(t: Tipo) {
    setError("");
    setMsg("");
    try {
      await api(`/tipos-movimentacao/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !t.ativo }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Tipos de Movimentação
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {lista.length} tipo{lista.length === 1 ? "" : "s"} cadastrado
            {lista.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/admin/tipos/novo"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Cadastrar
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

      <section className="mt-6">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Nome</th>
                <th className="px-3 py-2.5 font-medium">Natureza</th>
                <th className="px-3 py-2.5 font-medium">Flags</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {lista.map((t) => {
                const origemNome = t.ehRetornoDeId
                  ? lista.find((x) => x.id === t.ehRetornoDeId)?.nome
                  : null;
                const opTone =
                  t.operacao === "ENTRADA"
                    ? "emerald"
                    : t.operacao === "SAIDA"
                      ? "rose"
                      : "amber";
                return (
                  <tr
                    key={t.id}
                    className={`border-t border-slate-100 ${
                      !t.ativo ? "opacity-60" : ""
                    }`}
                  >
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium text-slate-800">{t.nome}</div>
                      {t.sistema && (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          Sistema
                        </div>
                      )}
                      {t.descricao && (
                        <div className="mt-0.5 max-w-xs text-xs text-slate-500">
                          {t.descricao}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <FlagChip tone={opTone}>
                        {operacaoLabel(t.operacao)}
                      </FlagChip>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {t.requerAprovacao && (
                          <FlagChip tone="amber">Aprovação</FlagChip>
                        )}
                        {t.geraAlertaRetorno && (
                          <FlagChip tone="amber">
                            {alertaChipLabel(t.diasAlerta)}
                          </FlagChip>
                        )}
                        {t.requerTermoComodato && (
                          <FlagChip tone="brand">Termo comodato</FlagChip>
                        )}
                        {t.baixaPorArvore && (
                          <FlagChip tone="amber">Baixa árvore</FlagChip>
                        )}
                        {origemNome && (
                          <FlagChip tone="emerald">
                            Retorno de: {origemNome}
                          </FlagChip>
                        )}
                        {t.requerCliente && <FlagChip>Cliente</FlagChip>}
                        {!t.requerAprovacao &&
                          !t.geraAlertaRetorno &&
                          !t.requerTermoComodato &&
                          !t.baixaPorArvore &&
                          !origemNome &&
                          !t.requerCliente && (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <FlagChip tone={t.ativo ? "emerald" : "slate"}>
                        {t.ativo ? "Ativo" : "Inativo"}
                      </FlagChip>
                    </td>
                    <td className="px-3 py-3 align-top whitespace-nowrap">
                      <div className="flex gap-3">
                        {!t.sistema && (
                          <Link
                            href={`/admin/tipos/${t.id}`}
                            className="text-sm font-medium text-brand hover:underline"
                          >
                            Editar
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={() => toggle(t)}
                          className="text-sm text-slate-600 hover:underline"
                        >
                          {t.ativo ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
