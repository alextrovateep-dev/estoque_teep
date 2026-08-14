"use client";

import { api, apiUpload } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import { FormEvent, useEffect, useMemo, useState } from "react";

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

type PlanoServico = { id?: string; descricao: string; ordem?: number };

type OrcLinha = {
  descricao: string;
  produtoId?: string | null;
  quantidade: number;
  valorUnitario: number;
  origem: "SERVICO" | "PECA" | "EXTRA";
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
    }>;
  } | null;
};

function asFotos(raw: unknown): string[] {
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function money(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Props = {
  processoId: string;
  item: RmaItemWorkflowData;
  processoAberto: boolean;
  canOrcamento: boolean;
  canDecidirOrcamento: boolean;
  onUpdated: () => Promise<void> | void;
  onError: (msg: string) => void;
};

export function RmaItemWorkflowPanel({
  processoId,
  item,
  processoAberto,
  canOrcamento,
  canDecidirOrcamento,
  onUpdated,
  onError,
}: Props) {
  const etapa = item.etapa || "AGUARDANDO_RECEBIMENTO";
  const [busy, setBusy] = useState(false);
  const [produtos, setProdutos] = useState<ProdutoOpt[]>([]);

  const recv = item.checklistExecucoes?.find((e) => e.tipo === "RECEBIMENTO");
  const lib = item.checklistExecucoes?.find((e) => e.tipo === "LIBERACAO");

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
  const [servicos, setServicos] = useState<string[]>(
    (item.manutencaoPlano?.servicos || []).map((s) => s.descricao)
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

  const [maoDeObra, setMaoDeObra] = useState(
    String(item.orcamento?.maoDeObra ?? "0")
  );
  const [desconto, setDesconto] = useState(
    String(item.orcamento?.desconto ?? "0")
  );
  const [obsCom, setObsCom] = useState(
    item.orcamento?.observacaoComercial || ""
  );
  const [linhas, setLinhas] = useState<OrcLinha[]>(
    (item.orcamento?.linhas || []).map((l) => ({
      descricao: l.descricao,
      produtoId: l.produtoId,
      quantidade: Number(l.quantidade),
      valorUnitario: Number(l.valorUnitario),
      origem: (l.origem as OrcLinha["origem"]) || "EXTRA",
    }))
  );
  const [decisaoObs, setDecisaoObs] = useState("");

  /** Chave estável: load() dos irmãos não apaga rascunho local se o conteúdo do servidor não mudou. */
  const checklistSyncKey = useMemo(() => {
    const exec =
      etapa === "AGUARDANDO_LIBERACAO"
        ? lib
        : ["AGUARDANDO_RECEBIMENTO", "AGUARDANDO_LAUDO"].includes(etapa)
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

  const planoOrcSyncKey = useMemo(
    () =>
      JSON.stringify({
        id: item.id,
        d: item.diagnostico
          ? {
              r: item.diagnostico.resumoProblema,
              o: item.diagnostico.observacaoTecnica || "",
            }
          : null,
        s: (item.manutencaoPlano?.servicos || []).map((s) => s.descricao),
        p: (item.manutencaoPlano?.pecas || []).map((p) => [
          p.produtoId,
          String(p.quantidade),
          p.motivo || "",
        ]),
        o: item.orcamento
          ? {
              st: item.orcamento.status,
              mo: String(item.orcamento.maoDeObra ?? "0"),
              de: String(item.orcamento.desconto ?? "0"),
              oc: item.orcamento.observacaoComercial || "",
              l: item.orcamento.linhas.map((l) => [
                l.descricao,
                l.produtoId || "",
                String(l.quantidade),
                String(l.valorUnitario),
                l.origem,
              ]),
            }
          : null,
      }),
    [item.id, item.diagnostico, item.manutencaoPlano, item.orcamento]
  );

  useEffect(() => {
    const exec =
      etapa === "AGUARDANDO_LIBERACAO"
        ? lib
        : ["AGUARDANDO_RECEBIMENTO", "AGUARDANDO_LAUDO"].includes(etapa)
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
    // checklistSyncKey já embute id/status/respostas persistidas
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync só quando a chave estável muda
  }, [checklistSyncKey]);

  useEffect(() => {
    setResumo(item.diagnostico?.resumoProblema || "");
    setObsTec(item.diagnostico?.observacaoTecnica || "");
    setServicos(
      (item.manutencaoPlano?.servicos || []).map((s) => s.descricao)
    );
    setPecas(
      (item.manutencaoPlano?.pecas || []).map((p) => ({
        produtoId: p.produtoId,
        quantidade: String(p.quantidade),
        motivo: p.motivo || "",
      }))
    );
    setMaoDeObra(String(item.orcamento?.maoDeObra ?? "0"));
    setDesconto(String(item.orcamento?.desconto ?? "0"));
    setObsCom(item.orcamento?.observacaoComercial || "");
    setLinhas(
      (item.orcamento?.linhas || []).map((l) => ({
        descricao: l.descricao,
        produtoId: l.produtoId,
        quantidade: Number(l.quantidade),
        valorUnitario: Number(l.valorUnitario),
        origem: (l.origem as OrcLinha["origem"]) || "EXTRA",
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync só quando a chave estável muda
  }, [planoOrcSyncKey]);

  useEffect(() => {
    if (
      !["AGUARDANDO_RECEBIMENTO", "AGUARDANDO_LAUDO", "AGUARDANDO_ORCAMENTO"].includes(
        etapa
      )
    ) {
      return;
    }
    void api<ProdutoOpt[]>("/produtos")
      .then((list) => setProdutos(list.filter((p) => p)))
      .catch(() => setProdutos([]));
  }, [etapa]);

  const totalOrc = useMemo(() => {
    const sub = linhas.reduce(
      (a, l) => a + Number(l.quantidade) * Number(l.valorUnitario),
      0
    );
    return Math.max(
      0,
      Math.round((sub + Number(maoDeObra || 0) - Number(desconto || 0)) * 100) /
        100
    );
  }, [linhas, maoDeObra, desconto]);

  async function ensureChecklist(tipo: "RECEBIMENTO" | "LIBERACAO") {
    setBusy(true);
    try {
      await api(
        `/rma/${processoId}/itens/${item.id}/checklist/${tipo}/iniciar`,
        { method: "POST" }
      );
      await onUpdated();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao iniciar checklist");
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
      onError("Inicie o checklist antes");
      return;
    }
    setBusy(true);
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
      onError(e instanceof Error ? e.message : "Erro no checklist");
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
      onError(e instanceof Error ? e.message : "Falha no upload");
    }
  }

  async function salvarPlano(concluir: boolean) {
    setBusy(true);
    try {
      const body = {
        resumoProblema: resumo.trim(),
        observacaoTecnica: obsTec.trim() || null,
        servicos: servicos
          .map((s) => s.trim())
          .filter(Boolean)
          .map((descricao, ordem) => ({ descricao, ordem })),
        pecas: pecas
          .filter((p) => p.produtoId && Number(p.quantidade) > 0)
          .map((p) => ({
            produtoId: p.produtoId,
            quantidade: Number(p.quantidade),
            motivo: p.motivo.trim() || null,
          })),
      };
      const path = concluir
        ? `/rma/${processoId}/itens/${item.id}/diagnostico-plano/concluir`
        : `/rma/${processoId}/itens/${item.id}/diagnostico-plano`;
      await api(path, {
        method: concluir ? "POST" : "PUT",
        body: JSON.stringify(body),
      });
      await onUpdated();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao salvar plano");
    } finally {
      setBusy(false);
    }
  }

  async function carregarSugestaoOrc() {
    setBusy(true);
    try {
      const s = await api<{
        linhas: OrcLinha[];
      }>(`/rma/${processoId}/itens/${item.id}/orcamento/sugestao`);
      setLinhas(s.linhas);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao sugerir linhas");
    } finally {
      setBusy(false);
    }
  }

  async function salvarOrcamento(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      await api(`/rma/${processoId}/itens/${item.id}/orcamento`, {
        method: "PUT",
        body: JSON.stringify({
          maoDeObra: Number(maoDeObra) || 0,
          desconto: Number(desconto) || 0,
          observacaoComercial: obsCom.trim() || null,
          linhas,
        }),
      });
      await onUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao salvar orçamento");
    } finally {
      setBusy(false);
    }
  }

  async function enviarOrcamento() {
    setBusy(true);
    try {
      await api(`/rma/${processoId}/itens/${item.id}/orcamento/enviar`, {
        method: "POST",
      });
      await onUpdated();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao enviar orçamento");
    } finally {
      setBusy(false);
    }
  }

  async function decidirOrc(decisao: "aprovar" | "recusar") {
    setBusy(true);
    try {
      await api(`/rma/${processoId}/itens/${item.id}/orcamento/${decisao}`, {
        method: "POST",
        body: JSON.stringify({ observacao: decisaoObs.trim() || null }),
      });
      await onUpdated();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro na decisão");
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
      <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50/60 p-2 text-xs">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-sky-950">
            Checklist {tipo === "RECEBIMENTO" ? "recebimento" : "liberação"}
            {exec ? ` — ${exec.status}` : ""}
          </p>
          {!exec && processoAberto ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void ensureChecklist(tipo)}
              className="rounded border border-sky-300 bg-white px-2 py-0.5 font-medium text-sky-900 hover:bg-sky-100 disabled:opacity-50"
            >
              Iniciar
            </button>
          ) : null}
        </div>
        {!exec ? (
          <p className="text-slate-600">
            Cadastre o template do produto em Cadastros → Checklists RMA, depois
            inicie.
          </p>
        ) : (
          <ul className="space-y-2">
            {exec.template.itens.map((ti) => {
              const r = respMap[ti.id] || { fotos: [] };
              const opcoes = Array.isArray(ti.opcoesJson)
                ? ti.opcoesJson
                : [];
              return (
                <li key={ti.id} className="rounded border bg-white p-2">
                  <p className="font-medium text-slate-800">
                    {ti.codigo}. {ti.titulo}
                    {ti.obrigatorio ? " *" : ""}
                  </p>
                  {ti.ajuda ? (
                    <p className="text-[11px] text-slate-500">{ti.ajuda}</p>
                  ) : null}
                  {ti.tipoCampo === "SIM_NAO" ? (
                    <div className="mt-1 flex gap-3">
                      {(["SIM", "NAO"] as const).map((v) => (
                        <label key={v} className="flex items-center gap-1">
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
                                [ti.id]: {
                                  ...r,
                                  valorBool: v === "SIM",
                                },
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
                      className="mt-1 w-full rounded border px-2 py-1"
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
                      className="mt-1 w-full rounded border px-2 py-1"
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
                    <div className="mt-1 space-y-1">
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
                        <label className="inline-block cursor-pointer rounded border px-2 py-0.5 hover:bg-slate-50">
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
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void salvarChecklist(tipo, false)}
              className="rounded border px-2 py-1 font-medium hover:bg-white disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void salvarChecklist(tipo, true)}
              className="rounded bg-sky-700 px-2 py-1 font-medium text-white hover:bg-sky-800 disabled:opacity-50"
            >
              Concluir checklist
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const showRecv = ["AGUARDANDO_RECEBIMENTO", "AGUARDANDO_LAUDO"].includes(
    etapa
  );
  const showPlano = showRecv;
  const showOrc = etapa === "AGUARDANDO_ORCAMENTO";
  const showDecisaoOrc =
    etapa === "AGUARDANDO_APROVACAO" && item.orcamento?.status === "ENVIADO";
  const showLib = etapa === "AGUARDANDO_LIBERACAO";

  if (!showRecv && !showPlano && !showOrc && !showLib && !showDecisaoOrc && !item.diagnostico) {
    return null;
  }

  return (
    <div className="space-y-2 border-t border-slate-200 pt-2">
      {showRecv ? renderChecklist("RECEBIMENTO", recv) : null}

      {showPlano && processoAberto ? (
        <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-2 text-xs">
          <p className="mb-2 font-semibold text-violet-950">
            Diagnóstico e plano (com peças previstas)
          </p>
          <label className="block">
            Resumo do problema *
            <textarea
              className="mt-0.5 w-full rounded border px-2 py-1"
              rows={2}
              disabled={busy}
              value={resumo}
              onChange={(e) => setResumo(e.target.value)}
            />
          </label>
          <label className="mt-2 block">
            Observação técnica
            <textarea
              className="mt-0.5 w-full rounded border px-2 py-1"
              rows={2}
              disabled={busy}
              value={obsTec}
              onChange={(e) => setObsTec(e.target.value)}
            />
          </label>
          <div className="mt-2">
            <p className="font-medium">Serviços</p>
            {servicos.map((s, idx) => (
              <div key={idx} className="mt-1 flex gap-1">
                <input
                  className="flex-1 rounded border px-2 py-1"
                  value={s}
                  disabled={busy}
                  onChange={(e) => {
                    const next = [...servicos];
                    next[idx] = e.target.value;
                    setServicos(next);
                  }}
                />
                <button
                  type="button"
                  className="rounded border px-2"
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
              className="mt-1 text-violet-800 underline"
              onClick={() => setServicos([...servicos, ""])}
            >
              + serviço
            </button>
          </div>
          <div className="mt-2">
            <p className="font-medium">Peças previstas</p>
            {pecas.map((p, idx) => (
              <div key={idx} className="mt-1 grid gap-1 sm:grid-cols-3">
                <select
                  className="rounded border px-2 py-1 sm:col-span-2"
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
                <input
                  type="number"
                  min={0.0001}
                  step="any"
                  className="rounded border px-2 py-1"
                  placeholder="Qtd"
                  value={p.quantidade}
                  disabled={busy}
                  onChange={(e) => {
                    const next = [...pecas];
                    next[idx] = { ...p, quantidade: e.target.value };
                    setPecas(next);
                  }}
                />
              </div>
            ))}
            <button
              type="button"
              className="mt-1 text-violet-800 underline"
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
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void salvarPlano(false)}
              className="rounded border px-2 py-1 font-medium hover:bg-white disabled:opacity-50"
            >
              Salvar rascunho
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void salvarPlano(true)}
              className="rounded bg-violet-700 px-2 py-1 font-medium text-white hover:bg-violet-800 disabled:opacity-50"
            >
              Enviar ao orçamento
            </button>
          </div>
        </div>
      ) : null}

      {item.diagnostico && !showPlano ? (
        <div className="rounded border bg-slate-50 p-2 text-xs text-slate-700">
          <p className="font-medium">Diagnóstico</p>
          <p>{item.diagnostico.resumoProblema}</p>
        </div>
      ) : null}

      {showOrc && canOrcamento && processoAberto ? (
        <form
          onSubmit={(e) => void salvarOrcamento(e)}
          className="rounded-lg border border-amber-100 bg-amber-50/50 p-2 text-xs"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-amber-950">
              Orçamento{" "}
              {item.orcamento ? `(${item.orcamento.status})` : "(novo)"}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void carregarSugestaoOrc()}
              className="rounded border px-2 py-0.5 hover:bg-white"
            >
              Carregar do plano
            </button>
          </div>
          <ul className="space-y-1">
            {linhas.map((l, idx) => (
              <li key={idx} className="grid gap-1 sm:grid-cols-4">
                <input
                  className="rounded border px-2 py-1 sm:col-span-2"
                  value={l.descricao}
                  onChange={(e) => {
                    const next = [...linhas];
                    next[idx] = { ...l, descricao: e.target.value };
                    setLinhas(next);
                  }}
                />
                <input
                  type="number"
                  className="rounded border px-2 py-1"
                  value={l.quantidade}
                  onChange={(e) => {
                    const next = [...linhas];
                    next[idx] = {
                      ...l,
                      quantidade: Number(e.target.value) || 0,
                    };
                    setLinhas(next);
                  }}
                />
                <input
                  type="number"
                  step="0.01"
                  className="rounded border px-2 py-1"
                  value={l.valorUnitario}
                  onChange={(e) => {
                    const next = [...linhas];
                    next[idx] = {
                      ...l,
                      valorUnitario: Number(e.target.value) || 0,
                    };
                    setLinhas(next);
                  }}
                />
              </li>
            ))}
          </ul>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label>
              Mão de obra
              <input
                type="number"
                step="0.01"
                className="mt-0.5 w-full rounded border px-2 py-1"
                value={maoDeObra}
                onChange={(e) => setMaoDeObra(e.target.value)}
              />
            </label>
            <label>
              Desconto
              <input
                type="number"
                step="0.01"
                className="mt-0.5 w-full rounded border px-2 py-1"
                value={desconto}
                onChange={(e) => setDesconto(e.target.value)}
              />
            </label>
          </div>
          <label className="mt-2 block">
            Observação comercial
            <textarea
              className="mt-0.5 w-full rounded border px-2 py-1"
              rows={2}
              value={obsCom}
              onChange={(e) => setObsCom(e.target.value)}
            />
          </label>
          <p className="mt-2 font-semibold">Total: {money(totalOrc)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded border px-2 py-1 font-medium hover:bg-white disabled:opacity-50"
            >
              Salvar orçamento
            </button>
            {etapa === "AGUARDANDO_ORCAMENTO" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void enviarOrcamento()}
                className="rounded bg-amber-700 px-2 py-1 font-medium text-white hover:bg-amber-800 disabled:opacity-50"
              >
                Enviar ao cliente
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {showDecisaoOrc && processoAberto && !canDecidirOrcamento ? (
        <p className="rounded border border-amber-100 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          Orçamento enviado — aguardando decisão do responsável comercial.
        </p>
      ) : null}

      {showDecisaoOrc && processoAberto && canDecidirOrcamento ? (
        <div className="rounded-lg border border-amber-200 bg-white p-2 text-xs">
          <p className="font-semibold">Aprovação do orçamento (cliente)</p>
          <textarea
            className="mt-1 w-full rounded border px-2 py-1"
            rows={2}
            placeholder="Obs. da decisão"
            value={decisaoObs}
            onChange={(e) => setDecisaoObs(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decidirOrc("aprovar")}
              className="rounded bg-emerald-700 px-2 py-1 font-medium text-white disabled:opacity-50"
            >
              Aprovar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decidirOrc("recusar")}
              className="rounded border border-red-200 px-2 py-1 text-red-700 disabled:opacity-50"
            >
              Recusar
            </button>
          </div>
        </div>
      ) : null}

      {showLib ? renderChecklist("LIBERACAO", lib) : null}
    </div>
  );
}
