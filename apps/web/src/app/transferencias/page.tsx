"use client";

import { api } from "@/lib/api";
import Link from "next/link";
import { useEffect, useState } from "react";

type Transferencia = {
  id: string;
  status: string;
  guiaTransporte: string | null;
  criadoEm: string;
  origemFilial: { sigla: string; nome: string };
  destinoFilial: { sigla: string; nome: string };
  criadoPor: { nome: string };
  itens: Array<{ id: string }>;
};

const STATUS_LABEL: Record<string, string> = {
  PENDENTE_APROVACAO: "Aguardando aprovação",
  EM_TRANSITO: "Em trânsito",
  CONFERINDO: "Conferindo",
  RECEBIDO: "Recebido",
  PARCIAL: "Parcial",
  CANCELADO: "Cancelado",
  REJEITADO: "Rejeitado",
};

export default function TransferenciasPage() {
  const [lista, setLista] = useState<Transferencia[]>([]);
  const [meta, setMeta] = useState<{
    total: number;
    truncado: boolean;
    take: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{
      data: Transferencia[];
      total: number;
      take: number;
      truncado: boolean;
    }>("/transferencias")
      .then((res) => {
        setLista(res.data);
        setMeta({
          total: res.total,
          truncado: res.truncado,
          take: res.take,
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Confirmar Recebimento</h1>
          <p className="mt-1 text-sm text-slate-500">
            Verificação e confirmação de cargas em trânsito. Novas transferências
            saem de{" "}
            <Link href="/lancamentos/novo" className="text-brand hover:underline">
              Novo Lançamento
            </Link>
            .
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {meta?.truncado && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Exibindo as {meta.take} mais recentes de {meta.total}.
        </p>
      )}
      {loading && (
        <p className="mt-4 text-sm text-slate-500">Carregando…</p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Origem → Destino</th>
              <th className="px-3 py-2">Itens</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Por</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(t.criadoEm).toLocaleString("pt-BR")}
                </td>
                <td className="px-3 py-2">
                  {t.origemFilial.sigla} → {t.destinoFilial.sigla}
                </td>
                <td className="px-3 py-2">{t.itens.length}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      t.status === "PENDENTE_APROVACAO"
                        ? "font-medium text-amber-800"
                        : t.status === "EM_TRANSITO"
                          ? "text-amber-800"
                          : t.status === "PARCIAL"
                            ? "text-orange-700"
                            : t.status === "CANCELADO" ||
                                t.status === "REJEITADO"
                              ? "text-slate-400"
                              : "text-emerald-800"
                    }
                  >
                    {STATUS_LABEL[t.status] || t.status}
                  </span>
                  {t.status === "PENDENTE_APROVACAO" && (
                    <>
                      {" · "}
                      <Link
                        href="/aprovacoes"
                        className="text-brand hover:underline"
                      >
                        Aprovar
                      </Link>
                    </>
                  )}
                </td>
                <td className="px-3 py-2">{t.criadoPor.nome}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/transferencias/${t.id}`}
                    className="text-brand hover:underline"
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && lista.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Nenhuma transferência ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
