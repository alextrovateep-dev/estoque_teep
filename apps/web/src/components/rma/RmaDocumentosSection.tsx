"use client";

import { apiDownload } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import { rmaOrcamentoStatusLabel } from "@teep/shared";
import Link from "next/link";
import { useMemo, useState } from "react";

type ChecklistResposta = {
  templateItemId: string;
  valorTexto?: string | null;
  valorBool?: boolean | null;
  fotos?: string[] | unknown;
};

type ChecklistItem = {
  id: string;
  codigo: string;
  titulo: string;
  tipoCampo: string;
  ordem?: number;
};

type Execucao = {
  tipo: string;
  status: string;
  concluidoEm?: string | null;
  preenchidoPor?: { nome: string } | null;
  template: { itens: ChecklistItem[] };
  respostas: ChecklistResposta[];
};

export type RmaDocumentoItem = {
  id: string;
  status: string;
  etapa?: string;
  produto: { codigo: string; descricao: string };
  unidadeSerie?: { numeroSerie: string } | null;
  checklistExecucoes?: Execucao[];
  diagnostico?: {
    resumoProblema: string;
    observacaoTecnica?: string | null;
  } | null;
  orcamento?: {
    status: string;
    observacaoComercial?: string | null;
    linhas?: Array<{
      descricao: string;
      quantidade: number | string;
      valorUnitario: number | string;
      origem?: string;
    }>;
  } | null;
};

type DocTipo = "entrada" | "liberacao" | "orcamento";

type ViewerState = {
  item: RmaDocumentoItem;
  tipo: DocTipo;
} | null;

function asFotos(fotos: unknown): string[] {
  if (!Array.isArray(fotos)) return [];
  return fotos.map((x) => String(x || "").trim()).filter(Boolean);
}

function formatResposta(opts: {
  tipoCampo: string;
  valorTexto?: string | null;
  valorBool?: boolean | null;
}): string {
  const t = String(opts.tipoCampo || "").toUpperCase();
  if (t === "SIM_NAO") {
    if (opts.valorBool === true) return "Sim";
    if (opts.valorBool === false) return "Não";
    return "—";
  }
  if (t === "FOTO") return "";
  return (opts.valorTexto || "").trim() || "—";
}

function temLaudoEntrada(item: RmaDocumentoItem): boolean {
  const recv = item.checklistExecucoes?.find((e) => e.tipo === "RECEBIMENTO");
  return Boolean(item.diagnostico) || Boolean(recv);
}

function temLaudoLiberacao(item: RmaDocumentoItem): boolean {
  const lib = item.checklistExecucoes?.find((e) => e.tipo === "LIBERACAO");
  return Boolean(lib && lib.status === "CONCLUIDO");
}

function temOrcamento(item: RmaDocumentoItem): boolean {
  return Boolean(item.orcamento);
}

function money(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Props = {
  processoId: string;
  itens: RmaDocumentoItem[];
  processoAberto: boolean;
};

export function RmaDocumentosSection({
  processoId,
  itens,
  processoAberto,
}: Props) {
  const [viewer, setViewer] = useState<ViewerState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const comDocs = useMemo(
    () =>
      itens.filter(
        (i) =>
          i.status !== "CANCELADO" &&
          (temLaudoEntrada(i) || temLaudoLiberacao(i) || temOrcamento(i))
      ),
    [itens]
  );

  async function baixar(path: string, key: string) {
    setError("");
    setBusy(key);
    try {
      const { blob, filename } = await apiDownload(path, {
        fallbackFilename: "documento-rma.pdf",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao baixar PDF");
    } finally {
      setBusy(null);
    }
  }

  if (comDocs.length === 0) {
    return (
      <section className="mt-3 rounded-xl border bg-white p-3 sm:p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Documentos
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          Quando houver laudo de entrada, laudo de liberação ou orçamento, eles
          aparecem aqui — inclusive depois do RMA fechado.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-3 rounded-xl border bg-white p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Documentos
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Laudos e orçamentos gerados — disponíveis para consulta e PDF
            {processoAberto ? "" : " (processo fechado)"}.
          </p>
        </div>
        {comDocs.some(temOrcamento) ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/rma/${processoId}/orcamento`}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
            >
              Ver orçamento
            </Link>
            <button
              type="button"
              disabled={busy === "orc-all"}
              onClick={() =>
                void baixar(
                  `/rma/${processoId}/orcamento/arquivo.pdf`,
                  "orc-all"
                )
              }
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {busy === "orc-all" ? "Gerando…" : "PDF orçamento (arquivo)"}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="space-y-3">
        {comDocs.map((item) => {
          const sn = item.unidadeSerie?.numeroSerie;
          const entrada = temLaudoEntrada(item);
          const liberacao = temLaudoLiberacao(item);
          const orc = temOrcamento(item);
          return (
            <li
              key={item.id}
              className="rounded-lg border border-slate-200 bg-slate-50/50 p-3"
            >
              <p className="text-sm font-medium text-slate-800">
                <span className="font-mono text-xs">{item.produto.codigo}</span>
                {sn ? (
                  <span className="ml-2 font-mono text-xs text-slate-600">
                    N/S {sn}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {item.produto.descricao}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {entrada ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
                      onClick={() => setViewer({ item, tipo: "entrada" })}
                    >
                      Ver laudo entrada
                    </button>
                    <button
                      type="button"
                      disabled={busy === `e-${item.id}`}
                      className="rounded-lg border bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                      onClick={() =>
                        void baixar(
                          `/rma/${processoId}/itens/${item.id}/laudo/RECEBIMENTO/pdf`,
                          `e-${item.id}`
                        )
                      }
                    >
                      {busy === `e-${item.id}` ? "…" : "PDF entrada"}
                    </button>
                  </>
                ) : null}
                {liberacao ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
                      onClick={() => setViewer({ item, tipo: "liberacao" })}
                    >
                      Ver laudo saída
                    </button>
                    <button
                      type="button"
                      disabled={busy === `l-${item.id}`}
                      className="rounded-lg border bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                      onClick={() =>
                        void baixar(
                          `/rma/${processoId}/itens/${item.id}/laudo/LIBERACAO/pdf`,
                          `l-${item.id}`
                        )
                      }
                    >
                      {busy === `l-${item.id}` ? "…" : "PDF saída"}
                    </button>
                  </>
                ) : null}
                {orc ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
                      onClick={() => setViewer({ item, tipo: "orcamento" })}
                    >
                      Ver orçamento
                      <span className="ml-1 text-slate-400">
                        ({rmaOrcamentoStatusLabel(item.orcamento?.status)})
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={busy === `o-${item.id}`}
                      className="rounded-lg border bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                      onClick={() =>
                        void baixar(
                          `/rma/${processoId}/orcamento/arquivo.pdf?itemId=${item.id}`,
                          `o-${item.id}`
                        )
                      }
                    >
                      {busy === `o-${item.id}` ? "…" : "PDF orçamento"}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {viewer ? (
        <DocumentoViewer
          state={viewer}
          onClose={() => setViewer(null)}
          onPdf={(path) => void baixar(path, "viewer")}
          processoId={processoId}
          busy={busy === "viewer"}
        />
      ) : null}
    </section>
  );
}

function DocumentoViewer({
  state,
  onClose,
  onPdf,
  processoId,
  busy,
}: {
  state: NonNullable<ViewerState>;
  onClose: () => void;
  onPdf: (path: string) => void;
  processoId: string;
  busy: boolean;
}) {
  const { item, tipo } = state;
  const titulo =
    tipo === "entrada"
      ? "Laudo de entrada"
      : tipo === "liberacao"
        ? "Laudo de saída"
        : "Orçamento";

  const execTipo = tipo === "entrada" ? "RECEBIMENTO" : "LIBERACAO";
  const exec =
    tipo === "orcamento"
      ? null
      : item.checklistExecucoes?.find((e) => e.tipo === execTipo);

  const pdfPath =
    tipo === "entrada"
      ? `/rma/${processoId}/itens/${item.id}/laudo/RECEBIMENTO/pdf`
      : tipo === "liberacao"
        ? `/rma/${processoId}/itens/${item.id}/laudo/LIBERACAO/pdf`
        : `/rma/${processoId}/orcamento/arquivo.pdf?itemId=${item.id}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-base font-semibold text-slate-900">{titulo}</h4>
            <p className="mt-0.5 font-mono text-xs text-slate-600">
              {item.produto.codigo}
              {item.unidadeSerie?.numeroSerie
                ? ` · N/S ${item.unidadeSerie.numeroSerie}`
                : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onPdf(pdfPath)}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {busy ? "Gerando…" : "Baixar PDF"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
            >
              Fechar
            </button>
          </div>
        </div>

        {tipo === "orcamento" && item.orcamento ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-xs text-slate-500">
              Status: {rmaOrcamentoStatusLabel(item.orcamento.status)}
            </p>
            {item.orcamento.observacaoComercial ? (
              <p>
                <span className="font-medium">Obs. comercial:</span>{" "}
                {item.orcamento.observacaoComercial}
              </p>
            ) : null}
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="py-1.5 font-medium">Descrição</th>
                  <th className="py-1.5 text-right font-medium">Qtd</th>
                  <th className="py-1.5 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(item.orcamento.linhas || []).map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5">{l.descricao}</td>
                    <td className="py-1.5 text-right">{l.quantidade}</td>
                    <td className="py-1.5 text-right">
                      {money(Number(l.valorUnitario))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(item.orcamento.linhas || []).length === 0 ? (
              <p className="text-xs text-slate-500">Sem linhas no orçamento.</p>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            {tipo === "entrada" && item.diagnostico ? (
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="font-medium">Diagnóstico</p>
                <p className="mt-1 whitespace-pre-wrap">
                  {item.diagnostico.resumoProblema}
                </p>
                {item.diagnostico.observacaoTecnica ? (
                  <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">
                    {item.diagnostico.observacaoTecnica}
                  </p>
                ) : null}
              </div>
            ) : null}
            {exec?.preenchidoPor?.nome || exec?.concluidoEm ? (
              <p className="text-xs text-slate-500">
                {exec.preenchidoPor?.nome
                  ? `Preenchido por ${exec.preenchidoPor.nome}`
                  : ""}
                {exec.concluidoEm
                  ? ` · ${new Date(exec.concluidoEm).toLocaleString("pt-BR")}`
                  : ""}
              </p>
            ) : null}
            {exec ? (
              <ol className="space-y-3">
                {[...(exec.template.itens || [])]
                  .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
                  .map((ti) => {
                    const r = exec.respostas.find(
                      (x) => x.templateItemId === ti.id
                    );
                    const resp = formatResposta({
                      tipoCampo: ti.tipoCampo,
                      valorTexto: r?.valorTexto,
                      valorBool: r?.valorBool,
                    });
                    const fotos = asFotos(r?.fotos);
                    return (
                      <li
                        key={ti.id}
                        className="rounded-lg border bg-white p-3"
                      >
                        <p className="font-medium text-slate-800">
                          {ti.codigo}. {ti.titulo}
                        </p>
                        {resp ? (
                          <p className="mt-1 whitespace-pre-wrap text-slate-700">
                            {resp}
                          </p>
                        ) : null}
                        {fotos.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {fotos.map((f) => {
                              const href = resolveAssetUrl(f);
                              return href ? (
                                <a
                                  key={f}
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block h-28 w-36 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={href}
                                    alt=""
                                    className="h-full w-full object-contain"
                                  />
                                </a>
                              ) : null;
                            })}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
              </ol>
            ) : tipo !== "entrada" || !item.diagnostico ? (
              <p className="text-sm text-slate-500">
                Nenhum checklist registrado.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
