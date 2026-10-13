"use client";

import { api, apiDownload, getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import { formatMoney } from "@/lib/money";
import {
  rmaItemEntraNoPdfOrcamento,
  rmaItemEntraNoPdfOrcamentoComercial,
  rmaOrcamentoPodeEditar,
  rmaOrcamentoStatusLabel,
} from "@teep/shared";
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
    modalidadeAquisicao?: string | null;
    cliente: { id: string; nome: string; documento?: string | null };
    filial: { sigla: string; nome: string };
    responsavelComercial?: { id: string; nome: string } | null;
  };
  itens: ItemOrc[];
};

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

function linhasZeradas(linhas: LinhaDraft[]): string[] {
  return linhas
    .filter(
      (l) =>
        l.descricao.trim() &&
        Number(l.quantidade) > 0 &&
        Number(l.valorUnitario) <= 0
    )
    .map((l) => l.descricao.trim());
}

function emptyExtraLine(): LinhaDraft {
  return {
    descricao: "",
    produtoId: null,
    quantidade: 1,
    valorUnitario: 0,
    origem: "EXTRA",
    tempoMinutos: null,
  };
}

function origemLinhaLabel(origem: LinhaDraft["origem"]) {
  if (origem === "SERVICO") return "Serviço";
  if (origem === "PECA") return "Peça";
  return "Extra";
}

function orcamentoBadgeClass(status: string | undefined) {
  if (status === "APROVADO") {
    return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  }
  if (status === "RECUSADO") {
    return "bg-red-50 text-red-700 ring-red-200";
  }
  if (status === "ENVIADO") {
    return "bg-sky-50 text-sky-800 ring-sky-200";
  }
  if (status === "RASCUNHO") {
    return "bg-amber-50 text-amber-900 ring-amber-200";
  }
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function DiagnosticoBloco({
  texto,
  extra,
}: {
  texto: string;
  extra?: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const longo = texto.length > 220 || Boolean(extra);
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Diagnóstico
      </p>
      <p
        className={`mt-1 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap ${
          aberto || !longo ? "" : "line-clamp-3"
        }`}
      >
        {texto}
      </p>
      {extra && aberto ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-500 whitespace-pre-wrap">
          {extra}
        </p>
      ) : null}
      {longo ? (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-brand hover:underline"
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? "Ver menos" : "Ver mais"}
        </button>
      ) : null}
    </div>
  );
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
    Record<string, { linhas: LinhaDraft[]; desconto: string; obs: string }>
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

  const applyOrcamento = useCallback((row: OrcPayload) => {
    setData(row);
    const next: Record<
      string,
      { linhas: LinhaDraft[]; desconto: string; obs: string }
    > = {};
    for (const it of row.itens) {
      next[it.id] = {
        linhas: it.linhas.map((l) => ({ ...l })),
        desconto: String(it.orcamento?.desconto ?? 0),
        obs: it.orcamento?.observacaoComercial || "",
      };
    }
    setDrafts(next);
  }, []);

  const load = useCallback(async () => {
    const row = await api<OrcPayload>(`/rma/${id}/orcamento`);
    applyOrcamento(row);
  }, [id, applyOrcamento]);

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

  function confirmarLinhasZeradas(
    itens: Array<{ label: string; linhas: LinhaDraft[] }>
  ): boolean {
    const avisos: string[] = [];
    for (const it of itens) {
      const z = linhasZeradas(it.linhas);
      if (z.length) {
        avisos.push(`${it.label}: ${z.join(", ")}`);
      }
    }
    if (avisos.length === 0) return true;
    return window.confirm(
      `Há linhas com valor R$ 0,00:\n\n${avisos.join("\n")}\n\nFechar mesmo assim?`
    );
  }

  async function salvar() {
    if (!data) return;
    const itens = data.itens
      .filter((it) =>
        rmaOrcamentoPodeEditar({
          etapa: it.etapa,
          orcamentoStatus: it.orcamento?.status,
        })
      )
      .filter((it) => drafts[it.id])
      .map((it) => {
        const d = drafts[it.id]!;
        return {
          itemId: it.id,
          desconto: Number(d.desconto) || 0,
          observacaoComercial: d.obs.trim() || null,
          linhas: d.linhas.filter(
            (l) => l.origem !== "EXTRA" || l.descricao.trim()
          ),
        };
      });
    if (itens.length === 0) {
      setError("Nenhum item editável para salvar");
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
      applyOrcamento(row);
      const negociando = itens.some((rowItem) => {
        const it = row.itens.find((i) => i.id === rowItem.itemId);
        return it?.orcamento?.status === "ENVIADO";
      });
      setMsg(
        negociando
          ? "Valores atualizados. Gere o PDF de novo para enviar ao cliente."
          : "Orçamento salvo."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function fecharItens(itemIds?: string[]) {
    if (!data) return;
    const filtroIds = itemIds ? new Set(itemIds) : null;
    const candidatos = data.itens.filter((it) => {
      if (filtroIds && !filtroIds.has(it.id)) return false;
      const st = it.orcamento?.status;
      const d = drafts[it.id];
      return (
        it.etapa === "AGUARDANDO_ORCAMENTO" &&
        (!st || st === "RASCUNHO") &&
        d &&
        d.linhas.some((l) => l.origem !== "EXTRA" || l.descricao.trim())
      );
    });
    if (candidatos.length === 0) {
      setError(
        itemIds?.length
          ? "Este item não está em rascunho para fechar."
          : "Não há item em rascunho para fechar."
      );
      return;
    }

    const itensPayload = candidatos.map((it) => {
      const d = drafts[it.id]!;
      return {
        itemId: it.id,
        desconto: Number(d.desconto) || 0,
        observacaoComercial: d.obs.trim() || null,
        linhas: d.linhas.filter(
          (l) => l.origem !== "EXTRA" || l.descricao.trim()
        ),
      };
    });

    if (
      !confirmarLinhasZeradas(
        candidatos.map((it) => ({
          label: `${it.produto.codigo}${
            it.unidadeSerie?.numeroSerie
              ? ` · ${it.unidadeSerie.numeroSerie}`
              : ""
          }`,
          linhas: drafts[it.id]!.linhas,
        }))
      )
    ) {
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
      const row = await api<OrcPayload>(`/rma/${id}/orcamento/fechar`, {
        method: "POST",
        body: JSON.stringify({
          itemIds: itensPayload.map((i) => i.itemId),
        }),
      });
      applyOrcamento(row);
      setMsg(
        "Orçamento fechado (aguardando aprovação). Equipe avisada. Gere o PDF e envie ao cliente pelo e-mail do comercial."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao fechar");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function pdf(itemId?: string, kind: "interno" | "comercial" = "interno") {
    setBusy(true);
    setError("");
    try {
      const base =
        kind === "comercial"
          ? `/rma/${id}/orcamento/comercial.pdf`
          : data?.processo.status === "ABERTO"
            ? `/rma/${id}/orcamento.pdf`
            : `/rma/${id}/orcamento/arquivo.pdf`;
      const path = itemId
        ? `${base}?itemId=${encodeURIComponent(itemId)}`
        : base;
      const { blob, filename } = await apiDownload(path, {
        fallbackFilename:
          kind === "comercial"
            ? `orcamento-comercial-rma-${id.slice(0, 8)}.pdf`
            : `orcamento-rma-${id.slice(0, 8)}.pdf`,
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

  async function aprovarSemCobranca(itemId: string) {
    const obs = (decisaoObs[itemId] || "").trim();
    if (!obs) {
      setError("Informe a observação da aprovação sem cobrança.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/rma/${id}/sem-cobranca`, {
        method: "POST",
        body: JSON.stringify({ itemIds: [itemId], observacao: obs }),
      });
      setMsg("Laudo aprovado sem cobrança. O item segue o fluxo.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro na aprovação");
    } finally {
      setBusy(false);
    }
  }

  async function decidir(itemId: string, decisao: "aprovar" | "recusar") {
    setBusy(true);
    setError("");
    try {
      const row = await api<OrcPayload>(
        `/rma/${id}/itens/${itemId}/orcamento/${decisao}`,
        {
          method: "POST",
          body: JSON.stringify({
            observacao: (decisaoObs[itemId] || "").trim() || null,
          }),
        }
      );
      applyOrcamento(row);
      setMsg(
        decisao === "aprovar"
          ? "Item aprovado. Equipe avisada por e-mail/sino."
          : "Item recusado. Equipe avisada por e-mail/sino."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro na decisão");
    } finally {
      setBusy(false);
    }
  }

  async function reabrir(itemId: string) {
    setBusy(true);
    setError("");
    try {
      const row = await api<OrcPayload>(
        `/rma/${id}/itens/${itemId}/orcamento/reabrir`,
        { method: "POST" }
      );
      applyOrcamento(row);
      setMsg("Orçamento reaberto.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao reabrir");
    } finally {
      setBusy(false);
    }
  }

  function updateLinha(
    itemId: string,
    idx: number,
    patch: Partial<LinhaDraft>
  ) {
    setDrafts((prev) => {
      const d = prev[itemId];
      if (!d) return prev;
      const next = [...d.linhas];
      next[idx] = { ...next[idx]!, ...patch };
      return { ...prev, [itemId]: { ...d, linhas: next } };
    });
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
  const pdfOpts = (it: ItemOrc) => ({
    etapa: it.etapa,
    orcamentoStatus: it.orcamento?.status,
  });
  const qtdRascunhoFechar = data.itens.filter(
    (it) =>
      p.status === "ABERTO" &&
      it.etapa === "AGUARDANDO_ORCAMENTO" &&
      (!it.orcamento?.status || it.orcamento.status === "RASCUNHO")
  ).length;
  const algumEditavel = data.itens.some(
    (it) =>
      p.status === "ABERTO" &&
      rmaOrcamentoPodeEditar({
        etapa: it.etapa,
        orcamentoStatus: it.orcamento?.status,
      })
  );
  const pdfInternoGeral = data.itens.some((it) =>
    rmaItemEntraNoPdfOrcamento(pdfOpts(it))
  );
  const pdfComercialGeral = data.itens.some((it) =>
    rmaItemEntraNoPdfOrcamentoComercial(pdfOpts(it))
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Orçamento RMA
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">
            {p.cliente.nome}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {[p.cliente.documento, p.filial.sigla, p.nfEntradaNumero ? `NF ${p.nfEntradaNumero}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Link
          href={`/rma/${id}`}
          className="shrink-0 rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          ← Voltar ao RMA
        </Link>
      </div>

      {p.status !== "ABERTO" ? (
        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Processo fechado — valores só para consulta. PDFs ficam em Documentos no RMA.
        </p>
      ) : null}

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

      <div className="mt-6 space-y-5">
        {data.itens.length === 0 ? (
          <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">
            Nenhum item com orçamento ainda.
          </p>
        ) : null}

        {data.itens.map((it) => {
          const d = drafts[it.id];
          if (!d) return null;
          const editavel =
            p.status === "ABERTO" &&
            rmaOrcamentoPodeEditar({
              etapa: it.etapa,
              orcamentoStatus: it.orcamento?.status,
            });
          const tot = totalItem(d.linhas, Number(d.desconto) || 0);
          const podeFecharItem =
            qtdRascunhoFechar > 1 &&
            p.status === "ABERTO" &&
            it.etapa === "AGUARDANDO_ORCAMENTO" &&
            (!it.orcamento?.status || it.orcamento.status === "RASCUNHO");
          const podeDecidirItem =
            p.status === "ABERTO" && it.orcamento?.status === "ENVIADO";
          const stOrc = it.orcamento?.status;

          return (
            <section
              key={it.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-semibold text-slate-900">
                      {it.produto.codigo}
                      {it.unidadeSerie?.numeroSerie
                        ? ` · N/S ${it.unidadeSerie.numeroSerie}`
                        : ""}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${orcamentoBadgeClass(stOrc)}`}
                    >
                      {it.orcamento
                        ? rmaOrcamentoStatusLabel(it.orcamento.status)
                        : "Sem orçamento salvo"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {it.produto.descricao}
                  </p>
                </div>
                {podeFecharItem ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void fecharItens([it.id])}
                    className="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Fechar só este item
                  </button>
                ) : null}
              </div>

              {it.diagnostico ? (
                <div className="mt-4">
                  <DiagnosticoBloco
                    texto={it.diagnostico.resumoProblema}
                    extra={it.diagnostico.observacaoTecnica}
                  />
                </div>
              ) : null}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      <th className="pb-2 pr-3 font-medium">Item</th>
                      <th className="w-20 pb-2 pr-3 font-medium">Qtd</th>
                      <th className="w-32 pb-2 pr-3 font-medium">Valor unit.</th>
                      <th className="w-28 pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.linhas.map((l, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-50 align-top"
                      >
                        <td className="py-2.5 pr-3">
                          {l.origem === "EXTRA" && editavel ? (
                            <input
                              className="w-full rounded border px-2 py-1 font-medium"
                              placeholder="Descrição da linha extra"
                              disabled={busy}
                              value={l.descricao}
                              onChange={(e) =>
                                updateLinha(it.id, idx, {
                                  descricao: e.target.value,
                                })
                              }
                            />
                          ) : (
                            <p className="font-medium text-slate-800">
                              {l.descricao}
                            </p>
                          )}
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {origemLinhaLabel(l.origem)}
                            {l.origem === "SERVICO"
                              ? ` · ${formatTempo(l.tempoMinutos)}`
                              : ""}
                            {l.origem === "EXTRA" && editavel ? (
                              <>
                                {" · "}
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="text-red-600 hover:underline disabled:opacity-50"
                                  onClick={() => {
                                    setDrafts((prev) => {
                                      const cur = prev[it.id];
                                      if (!cur) return prev;
                                      return {
                                        ...prev,
                                        [it.id]: {
                                          ...cur,
                                          linhas: cur.linhas.filter(
                                            (_, i) => i !== idx
                                          ),
                                        },
                                      };
                                    });
                                  }}
                                >
                                  Remover
                                </button>
                              </>
                            ) : null}
                          </p>
                        </td>
                        <td className="py-2.5 pr-3">
                          <input
                            type="number"
                            className="w-full rounded border px-2 py-1"
                            disabled={!editavel || busy}
                            value={l.quantidade}
                            onChange={(e) =>
                              updateLinha(it.id, idx, {
                                quantidade: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="py-2.5 pr-3">
                          <input
                            type="number"
                            step="0.01"
                            className="w-full rounded border px-2 py-1"
                            disabled={!editavel || busy}
                            value={l.valorUnitario}
                            onChange={(e) =>
                              updateLinha(it.id, idx, {
                                valorUnitario: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="py-2.5 text-right font-medium tabular-nums">
                          {formatMoney(
                            Number(l.quantidade) * Number(l.valorUnitario)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {editavel ? (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 text-sm font-medium text-brand hover:underline disabled:opacity-50"
                  onClick={() =>
                    setDrafts((prev) => {
                      const cur = prev[it.id];
                      if (!cur) return prev;
                      return {
                        ...prev,
                        [it.id]: {
                          ...cur,
                          linhas: [...cur.linhas, emptyExtraLine()],
                        },
                      };
                    })
                  }
                >
                  + Linha extra
                </button>
              ) : null}

              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-12">
                <label className="text-sm sm:col-span-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Desconto
                  </span>
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
                <label className="text-sm sm:col-span-6">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Observação comercial
                  </span>
                  <textarea
                    rows={2}
                    className="mt-1 w-full resize-y rounded-lg border px-3 py-2"
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
                <div className="flex flex-col justify-end sm:col-span-3 sm:text-right">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Total do item
                  </span>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formatMoney(tot)}
                  </p>
                </div>
              </div>

              {podeDecidirItem ? (
                <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Decisão do cliente
                  </p>
                  <input
                    className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                    placeholder="Observação da decisão (obrigatória em Sem cobrança)"
                    value={decisaoObs[it.id] || ""}
                    onChange={(e) =>
                      setDecisaoObs((prev) => ({
                        ...prev,
                        [it.id]: e.target.value,
                      }))
                    }
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !canDecidir}
                      onClick={() => void decidir(it.id, "aprovar")}
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Aprovar
                    </button>
                    <button
                      type="button"
                      disabled={busy || !canDecidir}
                      onClick={() => void aprovarSemCobranca(it.id)}
                      className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-800 disabled:opacity-50"
                    >
                      Sem cobrança
                    </button>
                    <button
                      type="button"
                      disabled={busy || !canDecidir}
                      onClick={() => void decidir(it.id, "recusar")}
                      className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                    >
                      Recusar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void reabrir(it.id)}
                      className="rounded-lg border bg-white px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
                    >
                      Reabrir
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
        <p className="mr-auto text-sm font-semibold tabular-nums">
          Total geral: {formatMoney(totalGeral)}
        </p>
        {algumEditavel ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void salvar()}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Salvar
          </button>
        ) : null}
        {pdfInternoGeral ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void pdf(undefined, "interno")}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            PDF interno
          </button>
        ) : null}
        {pdfComercialGeral ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void pdf(undefined, "comercial")}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            PDF comercial
          </button>
        ) : null}
        {qtdRascunhoFechar > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void fecharItens()}
            className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            Fechar orçamento
          </button>
        ) : null}
      </div>
    </>
  );
}
