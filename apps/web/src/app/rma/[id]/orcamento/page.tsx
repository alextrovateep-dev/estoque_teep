"use client";

import { api, apiDownload, getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import {
  rmaModalidadeAquisicaoLabel,
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

  const load = useCallback(async () => {
    let row = await api<OrcPayload>(`/rma/${id}/orcamento`);
    if (row.itens.length === 0 || row.processo.status !== "ABERTO") {
      const arquivo = await api<OrcPayload>(`/rma/${id}/orcamento?arquivo=1`);
      if (arquivo.itens.length > 0) row = arquivo;
    }
    setData(row);
    const next: typeof drafts = {};
    for (const it of row.itens) {
      next[it.id] = {
        linhas: it.linhas.map((l) => ({ ...l })),
        desconto: String(it.orcamento?.desconto ?? 0),
        obs: it.orcamento?.observacaoComercial || "",
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
      await api<OrcPayload>(`/rma/${id}/orcamento`, {
        method: "PUT",
        body: JSON.stringify({ itens }),
      });
      const negociando = itens.some((rowItem) => {
        const it = data.itens.find((i) => i.id === rowItem.itemId);
        return it?.orcamento?.status === "ENVIADO";
      });
      setMsg(
        negociando
          ? "Valores atualizados. Gere o PDF de novo para enviar ao cliente."
          : "Orçamento salvo."
      );
      await load();
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
      await api(`/rma/${id}/orcamento/fechar`, {
        method: "POST",
        body: JSON.stringify({
          itemIds: itensPayload.map((i) => i.itemId),
        }),
      });
      setMsg(
        "Orçamento fechado (aguardando aprovação). Equipe avisada. Gere o PDF e envie ao cliente pelo e-mail do comercial."
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao fechar");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function pdf(itemId?: string) {
    setBusy(true);
    setError("");
    try {
      const base =
        data?.processo.status === "ABERTO"
          ? `/rma/${id}/orcamento.pdf`
          : `/rma/${id}/orcamento/arquivo.pdf`;
      const path = itemId
        ? `${base}?itemId=${encodeURIComponent(itemId)}`
        : base;
      const { blob, filename } = await apiDownload(path, {
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
      setMsg(
        decisao === "aprovar"
          ? "Item aprovado. Equipe avisada por e-mail/sino."
          : "Item recusado. Equipe avisada por e-mail/sino."
      );
      await load();
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
      await api(`/rma/${id}/itens/${itemId}/orcamento/reabrir`, {
        method: "POST",
      });
      setMsg("Orçamento reaberto.");
      await load();
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
  const fechados = data.itens.filter((i) => i.orcamento?.status === "ENVIADO");
  const modalidadeLabel = rmaModalidadeAquisicaoLabel(p.modalidadeAquisicao);

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
          <p className="mt-1 text-sm text-slate-700">
            Modalidade:{" "}
            <span className="font-medium">{modalidadeLabel}</span>
            {p.responsavelComercial?.nome
              ? ` · Comercial: ${p.responsavelComercial.nome}`
              : ""}
          </p>
        </div>
        <Link
          href={`/rma/${id}`}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          ← Voltar ao RMA
        </Link>
      </div>

      <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        {p.status === "ABERTO"
          ? "Feche o orçamento para ir a “Aguardando aprovação”. Gere o PDF e envie ao cliente pelo e-mail do comercial. Negocie, ajuste valores e gere o PDF de novo. O RMA só finaliza depois da aprovação, manutenção e retorno."
          : "Processo fechado — visualização do orçamento em arquivo. Use Documentos no RMA para baixar PDFs."}
      </p>

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
            rmaOrcamentoPodeEditar({
              etapa: it.etapa,
              orcamentoStatus: it.orcamento?.status,
            });
          const tot = totalItem(d.linhas, Number(d.desconto) || 0);
          const podeFecharItem =
            p.status === "ABERTO" &&
            it.etapa === "AGUARDANDO_ORCAMENTO" &&
            (!it.orcamento?.status || it.orcamento.status === "RASCUNHO");
          const podeDecidirItem =
            p.status === "ABERTO" && it.orcamento?.status === "ENVIADO";

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
                      ? `Status: ${rmaOrcamentoStatusLabel(it.orcamento.status)}`
                      : "Sem orçamento salvo"}
                    {" · "}
                    {it.etapa}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void pdf(it.id)}
                    className="rounded border px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                  >
                    PDF
                  </button>
                  {podeFecharItem ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void fecharItens([it.id])}
                      className="rounded bg-amber-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Fechar
                    </button>
                  ) : null}
                  {podeDecidirItem ? (
                    <>
                      <button
                        type="button"
                        disabled={busy || !canDecidir}
                        onClick={() => void decidir(it.id, "aprovar")}
                        className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Aprovar
                      </button>
                      <button
                        type="button"
                        disabled={busy || !canDecidir}
                        onClick={() => void decidir(it.id, "recusar")}
                        className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-700 disabled:opacity-50"
                      >
                        Recusar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void reabrir(it.id)}
                        className="rounded border border-amber-300 px-2.5 py-1 text-xs text-amber-900 disabled:opacity-50"
                      >
                        Reabrir
                      </button>
                    </>
                  ) : null}
                </div>
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
                        onChange={(e) =>
                          updateLinha(it.id, idx, {
                            quantidade: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                    <label className="sm:col-span-3">
                      <span className="text-[11px] text-slate-500">
                        Valor unit.{" "}
                        {l.origem === "SERVICO" ? "(comercial)" : ""}
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        className="mt-0.5 w-full rounded border px-2 py-1"
                        disabled={!editavel || busy}
                        value={l.valorUnitario}
                        onChange={(e) =>
                          updateLinha(it.id, idx, {
                            valorUnitario: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                    <div className="flex items-end justify-end gap-2 sm:col-span-2">
                      <p className="text-sm font-medium">
                        {money(Number(l.quantidade) * Number(l.valorUnitario))}
                      </p>
                      {l.origem === "EXTRA" && editavel ? (
                        <button
                          type="button"
                          disabled={busy}
                          title="Remover linha"
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          onClick={() => {
                            setDrafts((prev) => {
                              const cur = prev[it.id];
                              if (!cur) return prev;
                              return {
                                ...prev,
                                [it.id]: {
                                  ...cur,
                                  linhas: cur.linhas.filter((_, i) => i !== idx),
                                },
                              };
                            });
                          }}
                        >
                          Remover
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

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

              {podeDecidirItem ? (
                <input
                  className="mt-3 w-full rounded border px-2 py-1.5 text-xs"
                  placeholder="Obs. da decisão (opcional)"
                  value={decisaoObs[it.id] || ""}
                  onChange={(e) =>
                    setDecisaoObs((prev) => ({
                      ...prev,
                      [it.id]: e.target.value,
                    }))
                  }
                />
              ) : null}

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
          onClick={() => void fecharItens()}
          className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        >
          Fechar orçamento
        </button>
      </div>

      {fechados.length > 0 ? (
        <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <h2 className="text-base font-semibold text-amber-950">
            Aguardando aprovação ({fechados.length})
          </h2>
          <p className="mt-1 text-xs text-amber-900/80">
            Status interno após fechar. Envie o PDF ao cliente pelo e-mail do
            comercial. Use os atalhos em cada item (PDF / Aprovar / Recusar /
            Reabrir) ou os botões abaixo.
          </p>
          <ul className="mt-3 space-y-2">
            {fechados.map((it) => (
              <li
                key={it.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100 bg-white px-3 py-2 text-sm"
              >
                <span className="font-mono font-semibold">
                  {it.produto.codigo}
                  {it.unidadeSerie?.numeroSerie
                    ? ` · N/S ${it.unidadeSerie.numeroSerie}`
                    : ""}
                  <span className="ml-2 font-sans font-normal text-slate-600">
                    {money(it.total)}
                  </span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void pdf(it.id)}
                    className="rounded border px-2.5 py-1 text-xs disabled:opacity-50"
                  >
                    PDF
                  </button>
                  <button
                    type="button"
                    disabled={busy || p.status !== "ABERTO"}
                    onClick={() => void reabrir(it.id)}
                    className="rounded border border-amber-300 px-2.5 py-1 text-xs text-amber-900 disabled:opacity-50"
                  >
                    Reabrir
                  </button>
                  <button
                    type="button"
                    disabled={busy || !canDecidir || p.status !== "ABERTO"}
                    onClick={() => void decidir(it.id, "aprovar")}
                    className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    disabled={busy || !canDecidir || p.status !== "ABERTO"}
                    onClick={() => void decidir(it.id, "recusar")}
                    className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-700 disabled:opacity-50"
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
