"use client";

import { api, apiDownload, getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type LinhaDraft = {
  descricao: string;
  produtoId: string | null;
  quantidade: number;
  valorUnitario: number;
  origem: "SERVICO" | "PECA" | "EXTRA";
  tempoMinutos: number | null;
};

type ItemOrc = {
  id: string;
  status: string;
  etapa: string;
  produto: { id: string; codigo: string; descricao: string };
  unidadeSerie?: { numeroSerie: string } | null;
  diagnostico?: {
    resumoProblema: string;
    observacaoTecnica?: string | null;
  } | null;
  orcamento: {
    id: string;
    status: string;
    desconto: number;
    observacaoComercial?: string | null;
  } | null;
  linhas: LinhaDraft[];
  total: number;
};

type OrcPayload = {
  processo: {
    id: string;
    status: string;
    nfEntradaNumero?: string | null;
    cliente: { id: string; nome: string; documento?: string | null };
    filial: { sigla: string; nome: string };
    responsavelComercial?: { id: string; nome: string } | null;
  };
  itens: ItemOrc[];
};

function money(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatTempo(min: number | null | undefined) {
  if (min == null || min < 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function totalItem(linhas: LinhaDraft[], desconto: number) {
  const sub = linhas.reduce(
    (a, l) => a + Number(l.quantidade) * Number(l.valorUnitario),
    0
  );
  return Math.max(0, Math.round((sub - desconto) * 100) / 100);
}

export default function RmaOrcamentoPage() {
  const params = useParams();
  const id = String(params.id || "");
  const user = getStoredUser();
  const can = user
    ? userHas(user, "rma") || userHas(user, "rma_cobranca")
    : false;

  const [data, setData] = useState<OrcPayload | null>(null);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      { linhas: LinhaDraft[]; desconto: string; obs: string; send: boolean }
    >
  >({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [decisaoObs, setDecisaoObs] = useState<Record<string, string>>({});

  const canDecidir =
    user?.perfil === "ADMIN" ||
    user?.perfil === "GERENTE" ||
    (data?.processo.responsavelComercial?.id != null &&
      user?.id === data.processo.responsavelComercial.id);

  const load = useCallback(async () => {
    const row = await api<OrcPayload>(`/rma/${id}/orcamento`);
    setData(row);
    const next: typeof drafts = {};
    for (const it of row.itens) {
      const editavel =
        it.etapa === "AGUARDANDO_ORCAMENTO" &&
        (!it.orcamento || it.orcamento.status === "RASCUNHO");
      next[it.id] = {
        linhas: it.linhas.map((l) => ({ ...l })),
        desconto: String(it.orcamento?.desconto ?? 0),
        obs: it.orcamento?.observacaoComercial || "",
        send: editavel,
      };
    }
    setDrafts(next);
  }, [id]);

  useEffect(() => {
    if (!can || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load()
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Erro ao carregar")
      )
      .finally(() => setLoading(false));
  }, [can, id, load]);

  const totalGeral = useMemo(() => {
    if (!data) return 0;
    return data.itens.reduce((acc, it) => {
      const d = drafts[it.id];
      if (!d) return acc + it.total;
      return acc + totalItem(d.linhas, Number(d.desconto) || 0);
    }, 0);
  }, [data, drafts]);

  async function salvar() {
    if (!data) return;
    const itens = data.itens
      .filter((it) => {
        const st = it.orcamento?.status;
        return (
          it.etapa === "AGUARDANDO_ORCAMENTO" &&
          (!st || st === "RASCUNHO") &&
          drafts[it.id]
        );
      })
      .map((it) => {
        const d = drafts[it.id]!;
        return {
          itemId: it.id,
          desconto: Number(d.desconto) || 0,
          observacaoComercial: d.obs.trim() || null,
          linhas: d.linhas,
        };
      });
    if (itens.length === 0) {
      setError("Nenhum item em rascunho para salvar");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const row = await api<OrcPayload>(`/rma/${id}/orcamento`, {
        method: "PUT",
        body: JSON.stringify({ itens }),
      });
      setData(row);
      setMsg("Orçamento salvo.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function enviar() {
    if (!data) return;
    const itensPayload = data.itens
      .filter((it) => drafts[it.id]?.send)
      .filter(
        (it) =>
          it.etapa === "AGUARDANDO_ORCAMENTO" &&
          (!it.orcamento || it.orcamento.status === "RASCUNHO")
      )
      .map((it) => {
        const d = drafts[it.id]!;
        return {
          itemId: it.id,
          desconto: Number(d.desconto) || 0,
          observacaoComercial: d.obs.trim() || null,
          linhas: d.linhas,
        };
      });
    if (itensPayload.length === 0) {
      setError("Marque ao menos um item em rascunho para enviar");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/orcamento`, {
        method: "PUT",
        body: JSON.stringify({ itens: itensPayload }),
      });
      await api(`/rma/${id}/orcamento/enviar`, {
        method: "POST",
        body: JSON.stringify({
          itemIds: itensPayload.map((i) => i.itemId),
        }),
      });
      setMsg("Orçamento enviado ao cliente (status ENVIADO).");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setBusy(false);
    }
  }

  async function pdf() {
    setBusy(true);
    setError("");
    try {
      const { blob, filename } = await apiDownload(`/rma/${id}/orcamento.pdf`, {
        fallbackFilename: `orcamento-rma-${id.slice(0, 8)}.pdf`,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao gerar PDF");
    } finally {
      setBusy(false);
    }
  }

  async function decidir(itemId: string, decisao: "aprovar" | "recusar") {
    setBusy(true);
    setError("");
    try {
      await api(`/rma/${id}/itens/${itemId}/orcamento/${decisao}`, {
        method: "POST",
        body: JSON.stringify({
          observacao: (decisaoObs[itemId] || "").trim() || null,
        }),
      });
      setMsg(decisao === "aprovar" ? "Item aprovado." : "Item recusado.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro na decisão");
    } finally {
      setBusy(false);
    }
  }

  if (!can) {
    return <p className="text-sm text-slate-600">Sem permissão.</p>;
  }
  if (loading) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }
  if (!data) {
    return (
      <p className="text-sm text-red-700">
        {error || "Orçamento não encontrado."}{" "}
        <Link href={`/rma/${id}`} className="underline">
          Voltar
        </Link>
      </p>
    );
  }

  const p = data.processo;
  const enviados = data.itens.filter((i) => i.orcamento?.status === "ENVIADO");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Orçamento RMA
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {p.cliente.nome}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {p.cliente.documento ? `${p.cliente.documento} · ` : ""}
            Estoque {p.filial.sigla}
            {p.nfEntradaNumero ? ` · NF ${p.nfEntradaNumero}` : ""}
            {" · "}
            {p.id.slice(0, 8)}
          </p>
        </div>
        <Link
          href={`/rma/${id}`}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          ← Voltar ao RMA
        </Link>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {msg ? (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {data.itens.length === 0 ? (
          <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">
            Nenhum item com diagnóstico/orçamento ainda. Conclua o diagnóstico
            no item primeiro.
          </p>
        ) : null}

        {data.itens.map((it) => {
          const d = drafts[it.id];
          if (!d) return null;
          const editavel =
            p.status === "ABERTO" &&
            it.etapa === "AGUARDANDO_ORCAMENTO" &&
            (!it.orcamento || it.orcamento.status === "RASCUNHO");
          const tot = totalItem(d.linhas, Number(d.desconto) || 0);

          return (
            <section
              key={it.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-semibold text-slate-900">
                    {it.produto.codigo}
                    {it.unidadeSerie?.numeroSerie
                      ? ` · N/S ${it.unidadeSerie.numeroSerie}`
                      : ""}
                  </p>
                  <p className="text-sm text-slate-600">{it.produto.descricao}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {it.orcamento
                      ? `Status: ${it.orcamento.status}`
                      : "Sem orçamento salvo"}
                    {" · "}
                    {it.etapa}
                  </p>
                </div>
                {editavel ? (
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={d.send}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [it.id]: { ...d, send: e.target.checked },
                        }))
                      }
                    />
                    Incluir no envio
                  </label>
                ) : null}
              </div>

              {it.diagnostico ? (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <span className="font-medium">Diagnóstico: </span>
                  {it.diagnostico.resumoProblema}
                </p>
              ) : null}

              <ul className="mt-3 space-y-2">
                {d.linhas.map((l, idx) => (
                  <li
                    key={idx}
                    className="grid gap-2 rounded-lg border border-slate-100 p-2 text-sm sm:grid-cols-12"
                  >
                    <div className="sm:col-span-5">
                      <p className="font-medium text-slate-800">{l.descricao}</p>
                      <p className="text-[11px] text-slate-400">
                        {l.origem}
                        {l.origem === "SERVICO"
                          ? ` · tempo ${formatTempo(l.tempoMinutos)}`
                          : ""}
                      </p>
                    </div>
                    <label className="sm:col-span-2">
                      <span className="text-[11px] text-slate-500">Qtd</span>
                      <input
                        type="number"
                        className="mt-0.5 w-full rounded border px-2 py-1"
                        disabled={!editavel || busy}
                        value={l.quantidade}
                        onChange={(e) => {
                          const next = [...d.linhas];
                          next[idx] = {
                            ...l,
                            quantidade: Number(e.target.value) || 0,
                          };
                          setDrafts((prev) => ({
                            ...prev,
                            [it.id]: { ...d, linhas: next },
                          }));
                        }}
                      />
                    </label>
                    <label className="sm:col-span-3">
                      <span className="text-[11px] text-slate-500">
                        Valor unit. {l.origem === "SERVICO" ? "(comercial)" : ""}
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        className="mt-0.5 w-full rounded border px-2 py-1"
                        disabled={!editavel || busy}
                        value={l.valorUnitario}
                        onChange={(e) => {
                          const next = [...d.linhas];
                          next[idx] = {
                            ...l,
                            valorUnitario: Number(e.target.value) || 0,
                          };
                          setDrafts((prev) => ({
                            ...prev,
                            [it.id]: { ...d, linhas: next },
                          }));
                        }}
                      />
                    </label>
                    <div className="flex items-end justify-end sm:col-span-2">
                      <p className="text-sm font-medium">
                        {money(Number(l.quantidade) * Number(l.valorUnitario))}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-sm">
                  Desconto
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                    disabled={!editavel || busy}
                    value={d.desconto}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [it.id]: { ...d, desconto: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="text-sm">
                  Observação comercial
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                    disabled={!editavel || busy}
                    value={d.obs}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [it.id]: { ...d, obs: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <p className="mt-2 text-right text-sm font-semibold">
                Total item: {money(tot)}
              </p>
            </section>
          );
        })}
      </div>

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
        <p className="mr-auto text-sm font-semibold">
          Total geral: {money(totalGeral)}
        </p>
        <button
          type="button"
          disabled={busy || p.status !== "ABERTO"}
          onClick={() => void salvar()}
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Salvar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void pdf()}
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Gerar PDF
        </button>
        <button
          type="button"
          disabled={busy || p.status !== "ABERTO"}
          onClick={() => void enviar()}
          className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        >
          Enviar ao cliente
        </button>
      </div>

      {enviados.length > 0 ? (
        <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <h2 className="text-base font-semibold text-amber-950">
            Aprovação por item
          </h2>
          <p className="mt-1 text-xs text-amber-900/80">
            Marque a decisão de cada orçamento enviado.
          </p>
          <ul className="mt-3 space-y-3">
            {enviados.map((it) => (
              <li
                key={it.id}
                className="rounded-lg border border-amber-100 bg-white p-3 text-sm"
              >
                <p className="font-mono font-semibold">
                  {it.produto.codigo}
                  {it.unidadeSerie?.numeroSerie
                    ? ` · N/S ${it.unidadeSerie.numeroSerie}`
                    : ""}
                </p>
                <p className="text-slate-600">Total: {money(it.total)}</p>
                <input
                  className="mt-2 w-full rounded border px-2 py-1 text-xs"
                  placeholder="Obs. da decisão (opcional)"
                  value={decisaoObs[it.id] || ""}
                  onChange={(e) =>
                    setDecisaoObs((prev) => ({
                      ...prev,
                      [it.id]: e.target.value,
                    }))
                  }
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !canDecidir || p.status !== "ABERTO"}
                    onClick={() => void decidir(it.id, "aprovar")}
                    className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    disabled={busy || !canDecidir || p.status !== "ABERTO"}
                    onClick={() => void decidir(it.id, "recusar")}
                    className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 disabled:opacity-50"
                  >
                    Recusar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
