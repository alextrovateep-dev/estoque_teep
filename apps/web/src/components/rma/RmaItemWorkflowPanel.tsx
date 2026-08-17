"use client";

import { api, apiUpload } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import {
  mensagemBloqueioDiagnostico,
  rmaEtapaEmRecebimento,
  rmaOrcamentoStatusLabel,
} from "@teep/shared";
import { useEffect, useMemo, useRef, useState } from "react";

type TemplateItem = {
  id: string;
  codigo: string;
  titulo: string;
  ajuda?: string | null;
  tipoCampo: string;
  obrigatorio: boolean;
  opcoesJson?: string[] | null;
  exigeFotoSe?: string | null;
};

type Execucao = {
  id: string;
  tipo: string;
  status: string;
  template: { id: string; nome: string; itens: TemplateItem[] };
  respostas: Array<{
    templateItemId: string;
    valorTexto?: string | null;
    valorBool?: boolean | null;
    fotos?: string[] | unknown;
  }>;
};

type PlanoPeca = {
  id?: string;
  produtoId: string;
  quantidade: number | string;
  motivo?: string | null;
  produto?: {
    id: string;
    codigo: string;
    descricao: string;
    precoUnitario: number | string;
  };
};

type PlanoServico = {
  id?: string;
  descricao: string;
  ordem?: number;
  tempoMinutos?: number | null;
};

type ProdutoOpt = {
  id: string;
  codigo: string;
  descricao: string;
  precoUnitario?: number | string;
};

export type RmaItemWorkflowData = {
  id: string;
  etapa?: string;
  produtoId: string;
  checklistExecucoes?: Execucao[];
  diagnostico?: {
    resumoProblema: string;
    observacaoTecnica?: string | null;
  } | null;
  manutencaoPlano?: {
    servicos: PlanoServico[];
    pecas: PlanoPeca[];
  } | null;
  orcamento?: {
    status: string;
    maoDeObra: number | string;
    desconto: number | string;
    observacaoComercial?: string | null;
    linhas: Array<{
      descricao: string;
      produtoId?: string | null;
      quantidade: number | string;
      valorUnitario: number | string;
      origem: string;
      produto?: ProdutoOpt | null;
      tempoMinutos?: number | null;
    }>;
  } | null;
};

function asFotos(raw: unknown): string[] {
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function minutosOuNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

type Props = {
  processoId: string;
  item: RmaItemWorkflowData;
  processoAberto: boolean;
  produtoCodigo: string;
  produtoDescricao: string;
  numeroSerie?: string | null;
  onUpdated: () => Promise<void> | void;
  onError: (msg: string) => void;
};

export function RmaItemWorkflowPanel({
  processoId,
  item,
  processoAberto,
  produtoCodigo,
  produtoDescricao,
  numeroSerie,
  onUpdated,
  onError,
}: Props) {
  const etapa = item.etapa || "AGUARDANDO_RECEBIMENTO";
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  const [produtos, setProdutos] = useState<ProdutoOpt[]>([]);
  const [temChecklistRecebimento, setTemChecklistRecebimento] = useState<
    boolean | null
  >(null);
  const [checklistConsulta, setChecklistConsulta] = useState<
    "loading" | "ok" | "erro"
  >("loading");
  const [checklistRetry, setChecklistRetry] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  function reportError(msg: string) {
    setLocalError(msg);
    onError(msg);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const recv = item.checklistExecucoes?.find((e) => e.tipo === "RECEBIMENTO");
  const lib = item.checklistExecucoes?.find((e) => e.tipo === "LIBERACAO");
  const temParaBloqueio =
    checklistConsulta === "erro" && temChecklistRecebimento === null
      ? false
      : temChecklistRecebimento;
  const bloqueioDiagnostico = mensagemBloqueioDiagnostico({
    execucaoRecebimento: recv ? { status: recv.status } : null,
    temTemplateRecebimento: temParaBloqueio,
  });
  const checklistEntradaPendente = Boolean(bloqueioDiagnostico);
  const checklistAindaVerificando =
    !recv &&
    temChecklistRecebimento === null &&
    checklistConsulta === "loading";
  const checklistConsultaFalhou = checklistConsulta === "erro";

  const [respMap, setRespMap] = useState<
    Record<
      string,
      { valorTexto?: string; valorBool?: boolean | null; fotos: string[] }
    >
  >({});

  const [resumo, setResumo] = useState(item.diagnostico?.resumoProblema || "");
  const [obsTec, setObsTec] = useState(
    item.diagnostico?.observacaoTecnica || ""
  );
  const [servicos, setServicos] = useState<
    Array<{ descricao: string; tempoMinutos: string }>
  >(
    (item.manutencaoPlano?.servicos || []).map((s) => ({
      descricao: s.descricao,
      tempoMinutos: s.tempoMinutos != null ? String(s.tempoMinutos) : "",
    }))
  );
  const [pecas, setPecas] = useState<
    Array<{ produtoId: string; quantidade: string; motivo: string }>
  >(
    (item.manutencaoPlano?.pecas || []).map((p) => ({
      produtoId: p.produtoId,
      quantidade: String(p.quantidade),
      motivo: p.motivo || "",
    }))
  );

  const checklistSyncKey = useMemo(() => {
    const exec =
      etapa === "AGUARDANDO_LIBERACAO"
        ? lib
        : rmaEtapaEmRecebimento(etapa)
          ? recv
          : null;
    if (!exec) return `${item.id}:${etapa}:`;
    const respFp = [...exec.respostas]
      .map(
        (r) =>
          `${r.templateItemId}:${r.valorTexto ?? ""}:${r.valorBool ?? ""}:${asFotos(r.fotos).join(",")}`
      )
      .sort()
      .join("|");
    return `${item.id}:${etapa}:${exec.id}:${exec.status}:${respFp}`;
  }, [item.id, etapa, recv, lib]);

  const planoSyncKey = useMemo(
    () =>
      JSON.stringify({
        id: item.id,
        d: item.diagnostico
          ? {
              r: item.diagnostico.resumoProblema,
              o: item.diagnostico.observacaoTecnica || "",
            }
          : null,
        s: (item.manutencaoPlano?.servicos || []).map((s) => [
          s.descricao,
          s.tempoMinutos ?? null,
        ]),
        p: (item.manutencaoPlano?.pecas || []).map((p) => [
          p.produtoId,
          String(p.quantidade),
          p.motivo || "",
        ]),
      }),
    [item.id, item.diagnostico, item.manutencaoPlano]
  );

  useEffect(() => {
    const exec =
      etapa === "AGUARDANDO_LIBERACAO"
        ? lib
        : rmaEtapaEmRecebimento(etapa)
          ? recv
          : null;
    if (!exec) return;
    const m: typeof respMap = {};
    for (const ti of exec.template.itens) {
      const r = exec.respostas.find((x) => x.templateItemId === ti.id);
      m[ti.id] = {
        valorTexto: r?.valorTexto || "",
        valorBool: r?.valorBool ?? null,
        fotos: asFotos(r?.fotos),
      };
    }
    setRespMap(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklistSyncKey]);

  useEffect(() => {
    setResumo(item.diagnostico?.resumoProblema || "");
    setObsTec(item.diagnostico?.observacaoTecnica || "");
    setServicos(
      (item.manutencaoPlano?.servicos || []).map((s) => ({
        descricao: s.descricao,
        tempoMinutos: s.tempoMinutos != null ? String(s.tempoMinutos) : "",
      }))
    );
    setPecas(
      (item.manutencaoPlano?.pecas || []).map((p) => ({
        produtoId: p.produtoId,
        quantidade: String(p.quantidade),
        motivo: p.motivo || "",
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planoSyncKey]);

  useEffect(() => {
    if (!rmaEtapaEmRecebimento(etapa)) return;
    void api<ProdutoOpt[]>("/produtos")
      .then((list) => setProdutos(list.filter((p) => p)))
      .catch(() => setProdutos([]));
  }, [etapa]);

  useEffect(() => {
    if (!rmaEtapaEmRecebimento(etapa)) return;
    let cancelled = false;
    setChecklistConsulta((c) => (c === "ok" ? "ok" : "loading"));
    void api<Array<{ id: string; itens?: unknown[] }>>(
      `/rma/checklists?produtoId=${encodeURIComponent(item.produtoId)}&tipo=RECEBIMENTO`
    )
      .then((list) => {
        if (cancelled) return;
        setTemChecklistRecebimento(
          list.some((t) =>
            Array.isArray(t.itens) ? t.itens.length > 0 : true
          )
        );
        setChecklistConsulta("ok");
      })
      .catch(() => {
        if (cancelled) return;
        setChecklistConsulta("erro");
      });
    return () => {
      cancelled = true;
    };
  }, [etapa, item.produtoId, open, checklistRetry]);

  async function ensureChecklist(tipo: "RECEBIMENTO" | "LIBERACAO") {
    setBusy(true);
    setLocalError("");
    try {
      await api(
        `/rma/${processoId}/itens/${item.id}/checklist/${tipo}/iniciar`,
        { method: "POST" }
      );
      await onUpdated();
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Erro ao iniciar checklist");
    } finally {
      setBusy(false);
    }
  }

  function payloadRespostas(exec: Execucao) {
    return {
      respostas: exec.template.itens.map((ti) => ({
        templateItemId: ti.id,
        valorTexto: respMap[ti.id]?.valorTexto || null,
        valorBool: respMap[ti.id]?.valorBool ?? null,
        fotos: respMap[ti.id]?.fotos || [],
      })),
    };
  }

  async function salvarChecklist(
    tipo: "RECEBIMENTO" | "LIBERACAO",
    concluir: boolean
  ) {
    const exec = tipo === "RECEBIMENTO" ? recv : lib;
    if (!exec) {
      reportError("Inicie o checklist antes");
      return;
    }
    setBusy(true);
    setLocalError("");
    try {
      const path = concluir
        ? `/rma/${processoId}/itens/${item.id}/checklist/${tipo}/concluir`
        : `/rma/${processoId}/itens/${item.id}/checklist/${tipo}`;
      await api(path, {
        method: concluir ? "POST" : "PUT",
        body: JSON.stringify(payloadRespostas(exec)),
      });
      await onUpdated();
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Erro no checklist");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFoto(templateItemId: string, file: File) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("context", "rma");
      const up = await apiUpload<{ url: string }>("/upload", fd);
      setRespMap((prev) => ({
        ...prev,
        [templateItemId]: {
          ...prev[templateItemId],
          fotos: [...(prev[templateItemId]?.fotos || []), up.url],
        },
      }));
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Falha no upload");
    }
  }

  async function salvarPlano(concluir: boolean): Promise<boolean> {
    if (!resumo.trim()) {
      reportError("Informe o resumo do problema");
      return false;
    }
    const servicosPayload = servicos
      .map((s) => ({
        descricao: s.descricao.trim(),
        tempoMinutos: minutosOuNull(s.tempoMinutos),
      }))
      .filter((s) => s.descricao)
      .map((s, ordem) => ({ ...s, ordem }));
    const pecasPayload = pecas
      .filter((p) => p.produtoId && Number(p.quantidade) > 0)
      .map((p) => ({
        produtoId: p.produtoId,
        quantidade: Number(p.quantidade),
        motivo: p.motivo.trim() || null,
      }));
    for (const p of pecas) {
      if (!p.produtoId) continue;
      const qtd = Number(p.quantidade);
      if (!Number.isFinite(qtd) || qtd <= 0) {
        reportError("Informe a quantidade da peça (maior que zero).");
        return false;
      }
    }
    for (const s of servicos) {
      if (!s.descricao.trim() && s.tempoMinutos.trim()) {
        reportError("Informe a descrição do serviço, ou remova a linha.");
        return false;
      }
    }
    if (concluir && bloqueioDiagnostico) {
      reportError(bloqueioDiagnostico);
      return false;
    }
    if (concluir && servicosPayload.length === 0 && pecasPayload.length === 0) {
      reportError("Informe ao menos um serviço ou uma peça prevista no plano");
      return false;
    }
    setBusy(true);
    setLocalError("");
    try {
      const body = {
        resumoProblema: resumo.trim(),
        observacaoTecnica: obsTec.trim() || null,
        servicos: servicosPayload,
        pecas: pecasPayload,
      };
      const path = concluir
        ? `/rma/${processoId}/itens/${item.id}/diagnostico-plano/concluir`
        : `/rma/${processoId}/itens/${item.id}/diagnostico-plano`;
      await api(path, {
        method: concluir ? "POST" : "PUT",
        body: JSON.stringify(body),
      });
      await onUpdated();
      return true;
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Erro ao salvar plano");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function renderChecklist(
    tipo: "RECEBIMENTO" | "LIBERACAO",
    exec: Execucao | undefined
  ) {
    const readOnly = !processoAberto || exec?.status === "CONCLUIDO";
    return (
      <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-sky-950">
            Checklist {tipo === "RECEBIMENTO" ? "de entrada" : "de liberação"}
            {exec ? (
              <span className="ml-2 text-xs font-medium text-sky-800">
                {exec.status === "CONCLUIDO"
                  ? "Concluído"
                  : exec.status === "EM_PREENCHIMENTO"
                    ? "Em preenchimento"
                    : exec.status}
              </span>
            ) : null}
          </p>
          {!exec &&
          processoAberto &&
          (tipo !== "RECEBIMENTO" ||
            temChecklistRecebimento === true ||
            checklistConsultaFalhou) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void ensureChecklist(tipo)}
              className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100 disabled:opacity-50"
            >
              Iniciar checklist
            </button>
          ) : null}
        </div>
        {!exec ? (
          <>
            <p className="text-sm text-slate-600">
              {tipo !== "RECEBIMENTO"
                ? "Cadastre o checklist do produto em Checklists RMA e inicie aqui."
                : checklistConsultaFalhou && temChecklistRecebimento === null
                  ? "Não foi possível verificar o checklist de entrada. Tente de novo, ou inicie se este produto tiver um."
                  : temChecklistRecebimento === false
                    ? "Não há checklist de entrada para este produto. Pode concluir o diagnóstico."
                    : temChecklistRecebimento === true
                      ? "Inicie e conclua o checklist de entrada antes de concluir o diagnóstico."
                      : "Verificando se há checklist de entrada…"}
            </p>
            {tipo === "RECEBIMENTO" && checklistConsultaFalhou ? (
              <button
                type="button"
                className="mt-2 text-sm text-sky-800 underline"
                onClick={() => {
                  setChecklistConsulta("loading");
                  setChecklistRetry((n) => n + 1);
                }}
              >
                Tentar de novo
              </button>
            ) : null}
          </>
        ) : (
          <ul className="space-y-2">
            {exec.template.itens.map((ti) => {
              const r = respMap[ti.id] || { fotos: [] };
              const opcoes = Array.isArray(ti.opcoesJson) ? ti.opcoesJson : [];
              return (
                <li key={ti.id} className="rounded-lg border bg-white p-3">
                  <p className="font-medium text-slate-800">
                    {ti.codigo}. {ti.titulo}
                    {ti.obrigatorio ? " *" : ""}
                  </p>
                  {ti.ajuda ? (
                    <p className="text-xs text-slate-500">{ti.ajuda}</p>
                  ) : null}
                  {ti.tipoCampo === "SIM_NAO" ? (
                    <div className="mt-2 flex gap-4">
                      {(["SIM", "NAO"] as const).map((v) => (
                        <label key={v} className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            disabled={readOnly || busy}
                            checked={
                              v === "SIM"
                                ? r.valorBool === true
                                : r.valorBool === false
                            }
                            onChange={() =>
                              setRespMap((p) => ({
                                ...p,
                                [ti.id]: { ...r, valorBool: v === "SIM" },
                              }))
                            }
                          />
                          {v === "SIM" ? "Sim" : "Não"}
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {ti.tipoCampo === "TEXTO" ? (
                    <textarea
                      disabled={readOnly || busy}
                      className="mt-2 w-full rounded-lg border px-3 py-2"
                      rows={2}
                      value={r.valorTexto || ""}
                      onChange={(e) =>
                        setRespMap((p) => ({
                          ...p,
                          [ti.id]: { ...r, valorTexto: e.target.value },
                        }))
                      }
                    />
                  ) : null}
                  {ti.tipoCampo === "OPCAO" ? (
                    <select
                      disabled={readOnly || busy}
                      className="mt-2 w-full rounded-lg border px-3 py-2"
                      value={r.valorTexto || ""}
                      onChange={(e) =>
                        setRespMap((p) => ({
                          ...p,
                          [ti.id]: { ...r, valorTexto: e.target.value },
                        }))
                      }
                    >
                      <option value="">—</option>
                      {opcoes.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {(ti.tipoCampo === "FOTO" ||
                    ti.exigeFotoSe ||
                    (r.fotos && r.fotos.length > 0)) && (
                    <div className="mt-2 space-y-1">
                      <div className="flex flex-wrap gap-2">
                        {(r.fotos || []).map((f) => {
                          const href = resolveAssetUrl(f);
                          return href ? (
                            <a
                              key={f}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-800 underline"
                            >
                              foto
                            </a>
                          ) : null;
                        })}
                      </div>
                      {!readOnly ? (
                        <label className="inline-block cursor-pointer rounded-lg border px-2 py-1 text-xs hover:bg-slate-50">
                          + Foto
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={busy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void uploadFoto(ti.id, f);
                            }}
                          />
                        </label>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {exec && exec.status !== "CONCLUIDO" && processoAberto ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void salvarChecklist(tipo, false)}
              className="rounded-lg border bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void salvarChecklist(tipo, true)}
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
            >
              Concluir checklist
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const showRecv = rmaEtapaEmRecebimento(etapa);
  const showPlano = showRecv;
  const showLib = etapa === "AGUARDANDO_LIBERACAO";
  const hasWorkflowUi =
    showRecv || showPlano || showLib || Boolean(item.diagnostico);

  if (!hasWorkflowUi) {
    return null;
  }

  const acaoPrincipal = (() => {
    if (showRecv && recv && recv.status !== "CONCLUIDO") {
      return "Continuar checklist";
    }
    if (showRecv && !recv && temChecklistRecebimento === true) {
      return "Abrir checklist de entrada";
    }
    if (showPlano && processoAberto) {
      return item.diagnostico ? "Editar diagnóstico" : "Diagnóstico e plano";
    }
    if (showLib) {
      return lib?.status === "CONCLUIDO"
        ? "Ver checklist de liberação"
        : "Abrir checklist de liberação";
    }
    if (item.diagnostico) return "Ver diagnóstico";
    return "Editar";
  })();

  const resumoCard: string[] = [];
  if (recv) {
    resumoCard.push(
      `Entrada: ${recv.status === "CONCLUIDO" ? "ok" : "em andamento"}`
    );
  } else if (showRecv && temChecklistRecebimento === true) {
    resumoCard.push("Entrada: pendente");
  }
  if (item.diagnostico) {
    resumoCard.push("Diagnóstico registrado");
  } else if (showPlano) {
    resumoCard.push("Diagnóstico: pendente");
  }
  if (item.orcamento) {
    resumoCard.push(
      `Orçamento: ${rmaOrcamentoStatusLabel(item.orcamento.status)}${
        item.orcamento.status === "ENVIADO"
          ? " · negociar, PDF e gerar de novo"
          : ""
      }`
    );
  }
  if (lib) {
    resumoCard.push(
      `Liberação: ${lib.status === "CONCLUIDO" ? "ok" : "em andamento"}`
    );
  }

  return (
    <div className="min-w-0 border-t border-slate-200 pt-2">
      <div className="flex flex-col gap-2">
        {resumoCard.length > 0 ? (
          <p className="break-words text-[11px] leading-snug text-slate-500">
            {resumoCard.join(" · ")}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setLocalError("");
            setOpen(true);
          }}
          className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 hover:border-brand/40 hover:bg-brand/5"
        >
          <span className="min-w-0 leading-snug">{acaoPrincipal}</span>
          <span className="shrink-0 text-slate-400" aria-hidden>
            →
          </span>
        </button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Processo do item RMA"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[100vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:max-h-[90vh] sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Item do RMA
                  </p>
                  <p className="mt-0.5 font-mono text-base font-semibold text-slate-900">
                    {produtoCodigo}
                    {numeroSerie ? (
                      <span className="text-slate-500"> · N/S {numeroSerie}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">
                    {produtoDescricao}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="shrink-0 rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  Fechar
                </button>
              </div>
            </header>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5"
            >
              {localError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {localError}
                </p>
              ) : null}

              {showRecv ? renderChecklist("RECEBIMENTO", recv) : null}

              {showPlano && processoAberto ? (
                <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-sm">
                  <p className="mb-3 font-semibold text-violet-950">
                    Diagnóstico e plano
                  </p>
                  <label className="block">
                    Resumo do problema *
                    <textarea
                      className="mt-1 w-full rounded-lg border px-3 py-2"
                      rows={3}
                      disabled={busy}
                      value={resumo}
                      onChange={(e) => setResumo(e.target.value)}
                    />
                  </label>
                  <label className="mt-3 block">
                    Observação técnica
                    <textarea
                      className="mt-1 w-full rounded-lg border px-3 py-2"
                      rows={2}
                      disabled={busy}
                      value={obsTec}
                      onChange={(e) => setObsTec(e.target.value)}
                    />
                  </label>
                  <div className="mt-3">
                    <p className="font-medium">Serviços</p>
                    <p className="text-[11px] text-slate-500">
                      Informe o tempo gasto em minutos. O valor fica no
                      orçamento (comercial).
                    </p>
                    {servicos.map((s, idx) => (
                      <div key={idx} className="mt-1 flex flex-wrap gap-1">
                        <input
                          className="min-w-[10rem] flex-1 rounded-lg border px-3 py-1.5"
                          placeholder="Descrição do serviço"
                          value={s.descricao}
                          disabled={busy}
                          onChange={(e) => {
                            const next = [...servicos];
                            next[idx] = { ...s, descricao: e.target.value };
                            setServicos(next);
                          }}
                        />
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="w-24 rounded-lg border px-2 py-1.5"
                          placeholder="Min"
                          title="Tempo em minutos"
                          value={s.tempoMinutos}
                          disabled={busy}
                          onChange={(e) => {
                            const next = [...servicos];
                            next[idx] = {
                              ...s,
                              tempoMinutos: e.target.value,
                            };
                            setServicos(next);
                          }}
                        />
                        <button
                          type="button"
                          className="rounded-lg border px-2"
                          onClick={() =>
                            setServicos(servicos.filter((_, i) => i !== idx))
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="mt-1 text-sm text-violet-800 underline"
                      onClick={() =>
                        setServicos([
                          ...servicos,
                          { descricao: "", tempoMinutos: "" },
                        ])
                      }
                    >
                      + serviço
                    </button>
                  </div>
                  <div className="mt-3">
                    <p className="font-medium">Peças previstas</p>
                    {pecas.map((p, idx) => (
                      <div key={idx} className="mt-1 grid gap-1 sm:grid-cols-3">
                        <select
                          className="rounded-lg border px-2 py-1.5 sm:col-span-2"
                          value={p.produtoId}
                          disabled={busy}
                          onChange={(e) => {
                            const next = [...pecas];
                            next[idx] = { ...p, produtoId: e.target.value };
                            setPecas(next);
                          }}
                        >
                          <option value="">Produto…</option>
                          {produtos.map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.codigo} — {pr.descricao}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-1">
                          <input
                            type="number"
                            min={0.0001}
                            step="any"
                            className="min-w-0 flex-1 rounded-lg border px-2 py-1.5"
                            placeholder="Qtd"
                            value={p.quantidade}
                            disabled={busy}
                            onChange={(e) => {
                              const next = [...pecas];
                              next[idx] = { ...p, quantidade: e.target.value };
                              setPecas(next);
                            }}
                          />
                          <button
                            type="button"
                            className="rounded-lg border px-2"
                            onClick={() =>
                              setPecas(pecas.filter((_, i) => i !== idx))
                            }
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="mt-1 text-sm text-violet-800 underline"
                      onClick={() =>
                        setPecas([
                          ...pecas,
                          { produtoId: "", quantidade: "1", motivo: "" },
                        ])
                      }
                    >
                      + peça
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void salvarPlano(false)}
                      className="rounded-lg border bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      disabled={busy || checklistEntradaPendente}
                      title={
                        checklistAindaVerificando
                          ? "Aguarde a verificação do checklist de entrada"
                          : checklistEntradaPendente
                            ? "Conclua o checklist de entrada acima"
                            : undefined
                      }
                      onClick={() =>
                        void salvarPlano(true).then((ok) => {
                          if (ok) setOpen(false);
                        })
                      }
                      className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
                    >
                      Concluir diagnóstico
                    </button>
                  </div>
                  {checklistEntradaPendente ? (
                    <p className="mt-2 text-xs text-amber-800">
                      {checklistAindaVerificando
                        ? "Aguarde a verificação do checklist de entrada."
                        : "Conclua o checklist de entrada acima para liberar o diagnóstico."}
                    </p>
                  ) : checklistConsultaFalhou && !recv ? (
                    <p className="mt-2 text-xs text-amber-800">
                      Não foi possível verificar o checklist de entrada. Tente
                      de novo acima, ou conclua o diagnóstico.
                    </p>
                  ) : null}
                  {localError ? (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                      {localError}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {item.diagnostico && !showPlano ? (
                <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
                  <p className="font-medium">Diagnóstico</p>
                  <p className="mt-1">{item.diagnostico.resumoProblema}</p>
                  {item.diagnostico.observacaoTecnica ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {item.diagnostico.observacaoTecnica}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showLib ? renderChecklist("LIBERACAO", lib) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
