"use client";

import { api } from "@/lib/api";
import Link from "next/link";
import { FormEvent, useState } from "react";

type Unidade = {
  id: string;
  numeroSerie: string;
  status: string;
  produto: { id: string; codigo: string; descricao: string };
  filial: { id: string; nome: string; sigla: string } | null;
  cliente: { id: string; nome: string } | null;
};

type HistoricoMov = {
  id: string;
  dataMovimento: string;
  operacao: string;
  quantidade: string | number;
  status: string;
  tipo: { nome: string; operacao: string };
  filial: { sigla: string; nome: string };
  filialDestino: { sigla: string; nome: string } | null;
  cliente: { nome: string } | null;
  usuario: { nome: string };
};

const STATUS_LABEL: Record<string, string> = {
  EM_ESTOQUE: "Em estoque",
  EM_TRANSITO: "Em trânsito",
  SAIDO: "Saído",
};

export default function SeriesPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Unidade[]>([]);
  const [selected, setSelected] = useState<Unidade | null>(null);
  const [historico, setHistorico] = useState<HistoricoMov[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSearch(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError("");
    setSelected(null);
    setHistorico([]);
    try {
      const data = await api<Unidade[]>(
        `/series?q=${encodeURIComponent(q.trim())}`
      );
      setRows(data);
      if (data.length === 0) setError("Nenhuma série encontrada");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function openHistorico(u: Unidade) {
    setSelected(u);
    setError("");
    try {
      const res = await api<{ unidade: Unidade; historico: HistoricoMov[] }>(
        `/series/${u.id}/historico`
      );
      setHistorico(res.historico);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
      setHistorico([]);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Buscar número de série</h1>
      <p className="mt-1 text-sm text-slate-500">
        Localize onde está a unidade e veja o histórico de movimentações.
      </p>

      <form
        onSubmit={(e) => void onSearch(e)}
        className="mt-4 flex max-w-xl flex-wrap gap-2"
      >
        <input
          className="min-w-[12rem] flex-1 rounded-lg border px-3 py-2"
          placeholder="Número de série (mín. 2 caracteres)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading || q.trim().length < 2}
          className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Buscando…" : "Buscar"}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2">Série</th>
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Local</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">
                    {u.numeroSerie}
                  </td>
                  <td className="px-3 py-2">
                    {u.produto.codigo} — {u.produto.descricao}
                  </td>
                  <td className="px-3 py-2">
                    {STATUS_LABEL[u.status] || u.status}
                  </td>
                  <td className="px-3 py-2">
                    {u.status === "EM_ESTOQUE" && u.filial
                      ? `${u.filial.sigla} — ${u.filial.nome}`
                      : u.status === "SAIDO" && u.cliente
                        ? u.cliente.nome
                        : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-teal-800 underline"
                      onClick={() => void openHistorico(u)}
                    >
                      Histórico
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="mt-6 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">
            Histórico — {selected.numeroSerie}{" "}
            <span className="font-normal text-slate-500">
              ({selected.produto.codigo})
            </span>
          </h2>
          {historico.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Sem movimentos.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {historico.map((m) => (
                <li key={m.id} className="border-t pt-2 first:border-0 first:pt-0">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{m.tipo.nome}</span>
                    <span className="text-slate-500">
                      {new Date(m.dataMovimento).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <p className="text-slate-600">
                    {m.filial.sigla}
                    {m.filialDestino ? ` → ${m.filialDestino.sigla}` : ""}
                    {m.cliente ? ` · ${m.cliente.nome}` : ""}
                    {" · "}
                    {m.usuario.nome}
                    {" · "}
                    <Link
                      href="/movimentacoes"
                      className="text-teal-800 underline"
                    >
                      {m.id.slice(0, 8)}
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
