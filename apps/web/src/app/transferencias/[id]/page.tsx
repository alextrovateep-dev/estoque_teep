"use client";

import { api, getStoredUser, User, userFilialIds } from "@/lib/api";
import { userHas } from "@/lib/access";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type ItemSerie = {
  id: string;
  recebido: boolean | null;
  unidadeSerie: { id: string; numeroSerie: string; status: string };
};

type Item = {
  id: string;
  qtdEnviada: string | number;
  qtdRecebida: string | number | null;
  justificativaDivergencia: string | null;
  produto: { codigo: string; descricao: string; controlaSerie?: boolean };
  series?: ItemSerie[];
};

type Transferencia = {
  id: string;
  status: string;
  guiaTransporte: string | null;
  motivoRejeicao?: string | null;
  criadoEm: string;
  origemFilialId: string;
  destinoFilialId: string;
  origemFilial: { sigla: string; nome: string };
  destinoFilial: { sigla: string; nome: string };
  criadoPor: { nome: string };
  itens: Item[];
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

export default function TransferenciaDetalhePage() {
  const params = useParams();
  const id = String(params.id);
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Transferencia | null>(null);
  const [recebidas, setRecebidas] = useState<Record<string, string>>({});
  const [seriesRec, setSeriesRec] = useState<Record<string, string[]>>({});
  const [justifs, setJustifs] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const t = await api<Transferencia>(`/transferencias/${id}`);
    setData(t);
    const r: Record<string, string> = {};
    const sr: Record<string, string[]> = {};
    for (const i of t.itens) {
      r[i.id] = String(i.qtdRecebida ?? i.qtdEnviada);
      if (i.produto.controlaSerie) {
        sr[i.id] = (i.series || []).map((s) => s.unidadeSerie.numeroSerie);
      }
    }
    setRecebidas(r);
    setSeriesRec(sr);
  }

  useEffect(() => {
    setUser(getStoredUser());
    load().catch((e) => setError(e.message));
  }, [id]);

  const canConferir =
    data?.status === "EM_TRANSITO" &&
    user &&
    (user.perfil !== "OPERADOR" ||
      userFilialIds(user).includes(data.destinoFilialId));

  const canCancel =
    (data?.status === "EM_TRANSITO" ||
      data?.status === "PENDENTE_APROVACAO") &&
    user &&
    userHas(user, "aprovacoes");

  function toggleSerie(itemId: string, numero: string, checked: boolean) {
    setSeriesRec((prev) => {
      const cur = new Set(prev[itemId] || []);
      if (checked) cur.add(numero);
      else cur.delete(numero);
      const next = [...cur];
      setRecebidas((r) => ({ ...r, [itemId]: String(next.length) }));
      return { ...prev, [itemId]: next };
    });
  }

  async function onConferir(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const itens = data.itens.map((i) => {
        const controla = Boolean(i.produto.controlaSerie);
        const seriesRecebidas = controla ? seriesRec[i.id] || [] : undefined;
        const qtdRecebida = controla
          ? seriesRecebidas!.length
          : Number(recebidas[i.id]);
        const enviada = Number(i.qtdEnviada);
        const divergiu =
          Number.isFinite(qtdRecebida) &&
          Math.round(qtdRecebida * 10000) !== Math.round(enviada * 10000);
        return {
          itemId: i.id,
          qtdRecebida,
          seriesRecebidas,
          justificativa: divergiu ? justifs[i.id]?.trim() || null : null,
        };
      });
      const result = await api<{
        temDivergencia: boolean;
        transferencia: Transferencia;
        alertas?: Array<{ mensagem: string }>;
      }>(`/transferencias/${id}/conferir`, {
        method: "POST",
        body: JSON.stringify({ itens }),
      });
      setData(result.transferencia);
      const extras = result.alertas?.map((a) => a.mensagem).join(" · ");
      setMsg(
        (result.temDivergencia
          ? "Conferência parcial registrada (com divergência)."
          : "Conferência concluída — carga recebida.") +
          (extras ? ` · ${extras}` : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  async function onCancelar() {
    if (!confirm("Cancelar esta transferência e devolver o saldo à origem?")) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api<{ transferencia: Transferencia }>(
        `/transferencias/${id}/cancelar`,
        { method: "POST", body: "{}" }
      );
      setData(result.transferencia);
      setMsg("Transferência cancelada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  if (!data && !error) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            href="/transferencias"
            className="text-sm text-teal-800 hover:underline"
          >
            ← Transferências
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            Carga {data ? data.id.slice(0, 8) : ""}
          </h1>
        </div>
        {data ? (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">
            {STATUS_LABEL[data.status] || data.status}
          </span>
        ) : null}
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {msg && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      )}

      {data && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-4 text-sm">
            <p>
              <span className="text-slate-500">Origem:</span>{" "}
              {data.origemFilial.sigla} — {data.origemFilial.nome}
            </p>
            <p>
              <span className="text-slate-500">Destino:</span>{" "}
              {data.destinoFilial.sigla} — {data.destinoFilial.nome}
            </p>
            <p>
              <span className="text-slate-500">Criado por:</span>{" "}
              {data.criadoPor.nome}
            </p>
            {data.guiaTransporte ? (
              <p>
                <span className="text-slate-500">Guia:</span>{" "}
                {data.guiaTransporte}
              </p>
            ) : null}
            {data.motivoRejeicao ? (
              <p className="text-red-700">
                Motivo rejeição: {data.motivoRejeicao}
              </p>
            ) : null}
          </div>

          {canConferir ? (
            <form onSubmit={onConferir} className="space-y-4">
              {data.itens.map((i) => {
                const enviada = Number(i.qtdEnviada);
                const controla = Boolean(i.produto.controlaSerie);
                const rec = controla
                  ? (seriesRec[i.id] || []).length
                  : Number(recebidas[i.id] || 0);
                const divergiu =
                  Number.isFinite(rec) &&
                  Math.round(rec * 10000) !== Math.round(enviada * 10000);
                return (
                  <div
                    key={i.id}
                    className="rounded-xl border bg-white p-4 space-y-3"
                  >
                    <div>
                      <p className="font-medium">
                        {i.produto.codigo} — {i.produto.descricao}
                      </p>
                      <p className="text-sm text-slate-500">
                        Enviado: {enviada}
                        {controla ? " (por série)" : ""}
                      </p>
                    </div>

                    {controla ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          Confirmar séries recebidas ({rec}/{enviada})
                        </p>
                        <ul className="space-y-1">
                          {(i.series || []).map((s) => {
                            const num = s.unidadeSerie.numeroSerie;
                            const checked = (seriesRec[i.id] || []).includes(
                              num
                            );
                            return (
                              <li key={s.id}>
                                <label className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) =>
                                      toggleSerie(i.id, num, e.target.checked)
                                    }
                                  />
                                  <span className="font-mono">{num}</span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="text-xs text-slate-500">
                          Séries não marcadas voltam automaticamente à origem.
                        </p>
                      </div>
                    ) : (
                      <label className="block text-sm">
                        Recebido
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className="mt-1 w-full rounded-lg border px-3 py-2"
                          value={recebidas[i.id] ?? ""}
                          onChange={(e) =>
                            setRecebidas({
                              ...recebidas,
                              [i.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                    )}

                    {divergiu ? (
                      <label className="block text-sm">
                        Justificativa da divergência
                        <textarea
                          required
                          className="mt-1 w-full rounded-lg border px-3 py-2"
                          rows={2}
                          value={justifs[i.id] || ""}
                          onChange={(e) =>
                            setJustifs({
                              ...justifs,
                              [i.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading ? "Salvando…" : "Confirmar recebimento"}
              </button>
            </form>
          ) : (
            <div className="rounded-xl border bg-white overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2">Enviado</th>
                    <th className="px-3 py-2">Recebido</th>
                    <th className="px-3 py-2">Séries</th>
                  </tr>
                </thead>
                <tbody>
                  {data.itens.map((i) => (
                    <tr key={i.id} className="border-t">
                      <td className="px-3 py-2">
                        {i.produto.codigo} — {i.produto.descricao}
                      </td>
                      <td className="px-3 py-2">{String(i.qtdEnviada)}</td>
                      <td className="px-3 py-2">
                        {i.qtdRecebida != null ? String(i.qtdRecebida) : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {(i.series || [])
                          .map((s) => s.unidadeSerie.numeroSerie)
                          .join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canCancel ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void onCancelar()}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Cancelar transferência
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}
