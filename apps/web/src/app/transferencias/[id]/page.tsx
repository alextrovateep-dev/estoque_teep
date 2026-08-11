"use client";

import { api, getStoredUser, User, userFilialIds } from "@/lib/api";
import { userHas } from "@/lib/access";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

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

function formatQty(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function applyFormState(t: Transferencia) {
  const r: Record<string, string> = {};
  const sr: Record<string, string[]> = {};
  for (const i of t.itens) {
    r[i.id] = String(i.qtdRecebida ?? i.qtdEnviada);
    if (i.produto.controlaSerie) {
      // Na conferência, inicia com todas marcadas; no pós-conferência, usa recebido.
      if (t.status === "EM_TRANSITO") {
        sr[i.id] = (i.series || []).map((s) => s.unidadeSerie.numeroSerie);
      } else {
        sr[i.id] = (i.series || [])
          .filter((s) => s.recebido === true)
          .map((s) => s.unidadeSerie.numeroSerie);
      }
    }
  }
  return { recebidas: r, seriesRec: sr };
}

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
  const [pageLoading, setPageLoading] = useState(true);
  const submitting = useRef(false);

  async function load() {
    const t = await api<Transferencia>(`/transferencias/${id}`);
    setData(t);
    const form = applyFormState(t);
    setRecebidas(form.recebidas);
    setSeriesRec(form.seriesRec);
    setJustifs({});
    return t;
  }

  useEffect(() => {
    setUser(getStoredUser());
    let cancelled = false;
    setPageLoading(true);
    setError("");
    load()
      .catch((e) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Falha ao carregar a carga"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const canConferir =
    data?.status === "EM_TRANSITO" &&
    user &&
    (user.perfil !== "OPERADOR" ||
      userFilialIds(user).includes(data.destinoFilialId));

  const bloqueadoPorFilial =
    data?.status === "EM_TRANSITO" &&
    user?.perfil === "OPERADOR" &&
    !userFilialIds(user).includes(data.destinoFilialId);

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
    if (!data || loading || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");
    setMsg("");
    try {
      for (const i of data.itens) {
        const enviada = Number(i.qtdEnviada);
        const controla = Boolean(i.produto.controlaSerie);
        const qtdRecebida = controla
          ? (seriesRec[i.id] || []).length
          : Number(recebidas[i.id]);
        if (!Number.isFinite(qtdRecebida) || qtdRecebida < 0) {
          setError(`Quantidade inválida em ${i.produto.codigo}`);
          return;
        }
        if (qtdRecebida > enviada + 1e-9) {
          setError(
            `Recebido não pode ser maior que enviado (${i.produto.codigo})`
          );
          return;
        }
        const divergiu =
          Math.round(qtdRecebida * 10000) !== Math.round(enviada * 10000);
        if (divergiu && !justifs[i.id]?.trim()) {
          setError(
            `Informe a justificativa da divergência em ${i.produto.codigo}`
          );
          return;
        }
      }

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
      const form = applyFormState(result.transferencia);
      setRecebidas(form.recebidas);
      setSeriesRec(form.seriesRec);
      setJustifs({});
      const extras = result.alertas?.map((a) => a.mensagem).join(" · ");
      setMsg(
        (result.temDivergencia
          ? "Conferência parcial registrada — qty não recebida voltou à origem."
          : "Conferência concluída — carga recebida.") +
          (extras ? ` · ${extras}` : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na conferência");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  async function onCancelar() {
    if (loading || submitting.current) return;
    if (!confirm("Cancelar esta transferência e devolver o saldo à origem?")) {
      return;
    }
    submitting.current = true;
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
      setError(err instanceof Error ? err.message : "Erro ao cancelar");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  if (pageLoading && !data && !error) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            href="/transferencias"
            className="text-sm text-brand hover:underline"
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

      {bloqueadoPorFilial && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Somente a filial de destino ({data!.destinoFilial.sigla}) pode
          confirmar o recebimento desta carga.
        </p>
      )}

      {data?.status === "PENDENTE_APROVACAO" && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Esta carga ainda aguarda aprovação do Gerente.{" "}
          {user && userHas(user, "aprovacoes") ? (
            <Link href="/aprovacoes" className="font-medium underline">
              Ir para Aprovações
            </Link>
          ) : (
            "Peça ao Gerente para aprovar antes da conferência."
          )}
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
            <p>
              <span className="text-slate-500">Em:</span>{" "}
              {new Date(data.criadoEm).toLocaleString("pt-BR")}
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
            <form onSubmit={(e) => void onConferir(e)} className="space-y-4">
              <p className="text-sm text-slate-500">
                Quantidade não recebida (ou séries não marcadas) volta
                automaticamente ao estoque de origem.
              </p>
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
                    className="space-y-3 rounded-xl border bg-white p-4"
                  >
                    <div>
                      <p className="font-medium">
                        {i.produto.codigo} — {i.produto.descricao}
                      </p>
                      <p className="text-sm text-slate-500">
                        Enviado: {formatQty(enviada)}
                        {controla ? " (por série)" : ""}
                      </p>
                    </div>

                    {controla ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          Confirmar séries recebidas ({rec}/{enviada})
                        </p>
                        {(i.series || []).length === 0 ? (
                          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            Nenhuma série vinculada a este item na carga. Não é
                            possível confirmar unidades serializadas — cancele
                            ou revise o envio.
                          </p>
                        ) : (
                          <>
                            <ul className="space-y-1">
                              {(i.series || []).map((s) => {
                                const num = s.unidadeSerie.numeroSerie;
                                const checked = (
                                  seriesRec[i.id] || []
                                ).includes(num);
                                return (
                                  <li key={s.id}>
                                    <label className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={loading}
                                        onChange={(e) =>
                                          toggleSerie(
                                            i.id,
                                            num,
                                            e.target.checked
                                          )
                                        }
                                      />
                                      <span className="font-mono">{num}</span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                            <p className="text-xs text-slate-500">
                              Séries não marcadas voltam automaticamente à
                              origem.
                            </p>
                          </>
                        )}
                      </div>
                    ) : (
                      <label className="block text-sm">
                        Recebido
                        <input
                          type="number"
                          min={0}
                          max={enviada}
                          step="any"
                          disabled={loading}
                          className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-slate-50"
                          value={recebidas[i.id] ?? ""}
                          onChange={(e) =>
                            setRecebidas({
                              ...recebidas,
                              [i.id]: e.target.value,
                            })
                          }
                        />
                        <span className="mt-1 block text-xs text-slate-500">
                          Máximo {formatQty(enviada)}. O que faltar volta à
                          origem.
                        </span>
                      </label>
                    )}

                    {divergiu ? (
                      <label className="block text-sm">
                        Justificativa da divergência
                        <textarea
                          required
                          disabled={loading}
                          className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-slate-50"
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
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {loading ? "Salvando…" : "Confirmar recebimento"}
              </button>
            </form>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2">Enviado</th>
                    <th className="px-3 py-2">Recebido</th>
                    <th className="px-3 py-2">Séries / justificativa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.itens.map((i) => {
                    const series = i.series || [];
                    const ok = series.filter((s) => s.recebido === true);
                    const nao = series.filter((s) => s.recebido === false);
                    return (
                      <tr key={i.id} className="border-t align-top">
                        <td className="px-3 py-2">
                          {i.produto.codigo} — {i.produto.descricao}
                        </td>
                        <td className="px-3 py-2">
                          {formatQty(Number(i.qtdEnviada))}
                        </td>
                        <td className="px-3 py-2">
                          {i.qtdRecebida != null
                            ? formatQty(Number(i.qtdRecebida))
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {series.length > 0 ? (
                            <div className="space-y-1 font-mono">
                              {ok.length > 0 && (
                                <p className="text-emerald-800">
                                  Recebidas:{" "}
                                  {ok
                                    .map((s) => s.unidadeSerie.numeroSerie)
                                    .join(", ")}
                                </p>
                              )}
                              {nao.length > 0 && (
                                <p className="text-amber-800">
                                  Voltaram à origem:{" "}
                                  {nao
                                    .map((s) => s.unidadeSerie.numeroSerie)
                                    .join(", ")}
                                </p>
                              )}
                              {ok.length === 0 &&
                                nao.length === 0 &&
                                series
                                  .map((s) => s.unidadeSerie.numeroSerie)
                                  .join(", ")}
                            </div>
                          ) : (
                            "—"
                          )}
                          {i.justificativaDivergencia ? (
                            <p className="mt-1 text-slate-600">
                              Justificativa: {i.justificativaDivergencia}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
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
