"use client";

import { ConfirmMotivoPanel } from "@/components/ConfirmMotivoPanel";
import { api } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import { useCallback, useEffect, useRef, useState } from "react";

type Mov = {
  id: string;
  operacao: string;
  quantidade: string | number;
  status: string;
  dataMovimento: string;
  observacao?: string | null;
  notaFiscalNumero?: string | null;
  notaFiscalArquivo?: string | null;
  seriesInformadas?: unknown;
  produto: { codigo: string; descricao: string };
  tipo: { nome: string };
  filial: { sigla: string };
  filialDestino?: { sigla: string } | null;
  cliente?: {
    id: string;
    nome: string;
    tipo: string;
    documento?: string | null;
  } | null;
  usuario: { nome: string };
};

type TransfPendente = {
  id: string;
  status: string;
  creditoDestino: string | null;
  guiaTransporte: string | null;
  criadoEm: string;
  origemFilial: { sigla: string; nome: string };
  destinoFilial: { sigla: string; nome: string };
  criadoPor: { nome: string };
  itens: Array<{
    id: string;
    qtdEnviada: string | number;
    produto: { codigo: string; descricao: string };
    series?: Array<{ unidadeSerie: { numeroSerie: string } }>;
  }>;
};

const PAGE_SIZE = 20;

function formatQty(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function operacaoLabel(op: string): string {
  if (op === "ENTRADA") return "Entrada";
  if (op === "SAIDA") return "Saída";
  if (op === "TRANSFERENCIA") return "Transferência";
  return op;
}

function seriesPendentes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
}

export default function AprovacoesPage() {
  const [data, setData] = useState<Mov[]>([]);
  const [transf, setTransf] = useState<TransfPendente[]>([]);
  const [total, setTotal] = useState(0);
  const [transfTotal, setTransfTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [rejeitandoId, setRejeitandoId] = useState<string | null>(null);
  const [rejeitandoTipo, setRejeitandoTipo] = useState<"mov" | "transf" | null>(
    null
  );
  const [motivo, setMotivo] = useState("");
  const actingRef = useRef(false);

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        status: "PENDENTE",
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      const [movs, tr] = await Promise.all([
        api<{ data: Mov[]; total: number }>(`/movimentacoes?${params}`),
        api<{ data: TransfPendente[]; total: number }>(
          "/transferencias/pendentes-aprovacao"
        ),
      ]);
      if (signal?.cancelled) return;
      setData(movs.data);
      setTotal(movs.total);
      setTransf(tr.data);
      setTransfTotal(tr.total);
    } catch (e) {
      if (signal?.cancelled) return;
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  async function aprovar(id: string) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      const r = await api<{
        alertaEstoqueMinimo?: boolean;
        alertaEstoqueMaximo?: boolean;
        alertas?: Array<{ mensagem: string }>;
      }>(`/movimentacoes/${id}/aprovar`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const extras =
        r.alertas?.map((a) => a.mensagem).join(" · ") ||
        [
          r.alertaEstoqueMinimo ? "estoque mínimo" : "",
          r.alertaEstoqueMaximo ? "estoque máximo" : "",
        ]
          .filter(Boolean)
          .join(" · ");
      setMsg(extras ? `Aprovado · ${extras}` : "Movimento aprovado");
      setRejeitandoId(null);
      setRejeitandoTipo(null);
      setMotivo("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function aprovarTransf(id: string) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      const r = await api<{
        transferencia: { status: string };
        creditoDestino?: string;
        alertas?: Array<{ mensagem: string }>;
      }>(`/transferencias/${id}/aprovar`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const extras = r.alertas?.map((a) => a.mensagem).join(" · ");
      setMsg(
        extras
          ? `Transferência aprovada (${r.transferencia.status}) · ${extras}`
          : `Transferência aprovada → ${r.transferencia.status}`
      );
      setRejeitandoId(null);
      setRejeitandoTipo(null);
      setMotivo("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function confirmarRejeicao() {
    if (!rejeitandoId || !rejeitandoTipo) return;
    if (actingRef.current) return;
    const id = rejeitandoId;
    const tipo = rejeitandoTipo;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      if (tipo === "mov") {
        await api(`/movimentacoes/${id}/rejeitar`, {
          method: "POST",
          body: JSON.stringify({ motivo: motivo.trim() || undefined }),
        });
        setMsg("Movimento rejeitado (saldo intacto)");
      } else {
        await api(`/transferencias/${id}/rejeitar`, {
          method: "POST",
          body: JSON.stringify({ motivo: motivo.trim() || undefined }),
        });
        setMsg("Transferência rejeitada (saldo intacto)");
      }
      setRejeitandoId(null);
      setRejeitandoTipo(null);
      setMotivo("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  const showTransf = page === 1;
  const vazio =
    !loading &&
    data.length === 0 &&
    (!showTransf || transf.length === 0);
  const hasPager = total > PAGE_SIZE || (total > 0 && page > 1);

  return (
    <>
      <h1 className="text-2xl font-semibold">Aprovações</h1>
      <p className="mt-1 text-sm text-slate-500">
        Movimentos e transferências pendentes lançados por Operador. Aprovar
        aplica o saldo; rejeitar não altera estoque.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {msg && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      )}
      {loading && <p className="mt-3 text-sm text-slate-500">Carregando…</p>}

      <div className="mt-4 space-y-2">
        {vazio && (
          <p className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-slate-500">
            Nenhuma pendência no momento.
          </p>
        )}

        {showTransf &&
          transf.map((t) => (
            <div
              key={`t-${t.id}`}
              className="rounded-xl border border-amber-200 bg-white p-4 text-sm shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  PENDENTE APROVAÇÃO
                </span>
                <span className="font-medium">Transferência</span>
                <span className="text-slate-400">·</span>
                <span>
                  {t.origemFilial.sigla} → {t.destinoFilial.sigla}
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  {t.creditoDestino === "IMEDIATO"
                    ? "Crédito imediato"
                    : "Aguarda recebimento"}
                </span>
                <span className="ml-auto text-xs text-slate-500">
                  {new Date(t.criadoEm).toLocaleString("pt-BR")}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-slate-700">
                {t.itens.map((i) => {
                  const sns =
                    i.series
                      ?.map((s) => s.unidadeSerie.numeroSerie)
                      .filter(Boolean) || [];
                  return (
                    <li key={i.id}>
                      <span className="font-mono text-xs">
                        {i.produto.codigo}
                      </span>{" "}
                      {i.produto.descricao} · qtd{" "}
                      {formatQty(Number(i.qtdEnviada))}
                      {sns.length > 0 && (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-600">
                          S/N: {sns.join(", ")}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-1 text-slate-600">Por {t.criadoPor.nome}</div>
              {t.guiaTransporte && (
                <div className="mt-1 text-xs text-slate-500">
                  Guia: {t.guiaTransporte}
                </div>
              )}

              {rejeitandoId === t.id && rejeitandoTipo === "transf" ? (
                <ConfirmMotivoPanel
                  title="Confirmar rejeição da transferência"
                  confirmLabel="Confirmar rejeição"
                  motivoLabel="Motivo"
                  motivoPlaceholder="Informe o motivo (recomendado)"
                  motivo={motivo}
                  onMotivoChange={setMotivo}
                  onConfirm={() => void confirmarRejeicao()}
                  onCancel={() => {
                    setRejeitandoId(null);
                    setRejeitandoTipo(null);
                    setMotivo("");
                  }}
                  loading={acting}
                  danger
                />
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void aprovarTransf(t.id)}
                    className="rounded-lg bg-brand px-3 py-2 text-white disabled:opacity-50"
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => {
                      setRejeitandoId(t.id);
                      setRejeitandoTipo("transf");
                      setMotivo("");
                    }}
                    className="rounded-lg border border-red-200 px-3 py-2 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Rejeitar
                  </button>
                </div>
              )}
            </div>
          ))}

        {showTransf && transfTotal > transf.length && (
          <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Exibindo {transf.length} de {transfTotal} transferências pendentes.
            Aprove/rejeite as listadas e atualize a página para ver as demais.
          </p>
        )}

        {data.map((m) => {
          const sns = seriesPendentes(m.seriesInformadas);
          return (
            <div
              key={m.id}
              className="rounded-xl border bg-white p-4 text-sm shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  PENDENTE
                </span>
                <span className="font-medium">{m.tipo.nome}</span>
                <span className="text-slate-400">·</span>
                <span>
                  {m.filialDestino
                    ? `${m.filial.sigla} → ${m.filialDestino.sigla}`
                    : m.filial.sigla}
                </span>
                <span className="ml-auto text-xs text-slate-500">
                  {new Date(m.dataMovimento).toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="mt-2">
                <span className="font-mono text-xs">{m.produto.codigo}</span>{" "}
                {m.produto.descricao}
              </div>
              {sns.length > 0 && (
                <div className="mt-0.5 font-mono text-[10px] text-slate-600">
                  S/N: {sns.join(", ")}
                </div>
              )}
              <div className="mt-1 text-slate-600">
                Qtd: {formatQty(Number(m.quantidade))} ·{" "}
                {operacaoLabel(m.operacao)} · {m.usuario.nome}
              </div>
              {m.cliente && (
                <div className="mt-1 text-slate-600">
                  <span className="text-[10px] font-medium uppercase text-slate-400">
                    {m.cliente.tipo === "FORNECEDOR" ? "Forn." : "Cli."}
                  </span>{" "}
                  {m.cliente.nome}
                  {m.cliente.documento ? ` · ${m.cliente.documento}` : ""}
                </div>
              )}
              {m.observacao && (
                <div className="mt-1 text-xs text-slate-500">{m.observacao}</div>
              )}
              {(m.notaFiscalNumero || m.notaFiscalArquivo) && (
                <div className="mt-1 text-xs text-slate-600">
                  NF: {m.notaFiscalNumero || "—"}
                  {m.notaFiscalArquivo && (
                    <>
                      {" · "}
                      <a
                        href={resolveAssetUrl(m.notaFiscalArquivo) || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand underline"
                      >
                        Ver anexo
                      </a>
                    </>
                  )}
                </div>
              )}

              {rejeitandoId === m.id && rejeitandoTipo === "mov" ? (
                <ConfirmMotivoPanel
                  title="Confirmar rejeição"
                  confirmLabel="Confirmar rejeição"
                  motivoLabel="Motivo"
                  motivoPlaceholder="Informe o motivo (recomendado)"
                  motivo={motivo}
                  onMotivoChange={setMotivo}
                  onConfirm={() => void confirmarRejeicao()}
                  onCancel={() => {
                    setRejeitandoId(null);
                    setRejeitandoTipo(null);
                    setMotivo("");
                  }}
                  loading={acting}
                  danger
                />
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void aprovar(m.id)}
                    className="rounded-lg bg-brand px-3 py-2 text-white disabled:opacity-50"
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => {
                      setRejeitandoId(m.id);
                      setRejeitandoTipo("mov");
                      setMotivo("");
                    }}
                    className="rounded-lg border border-red-200 px-3 py-2 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Rejeitar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(hasPager || transfTotal > 0 || total > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {hasPager && (
            <button
              type="button"
              disabled={page <= 1 || acting}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
            >
              Anterior
            </button>
          )}
          <span className="text-sm text-slate-500">
            {hasPager ? `Página ${page} · ` : ""}
            {total} movimento{total === 1 ? "" : "s"}
            {transfTotal > 0
              ? ` · ${transfTotal} transferência${transfTotal === 1 ? "" : "s"}`
              : ""}
            {page > 1 && transfTotal > 0
              ? " (transferências na página 1)"
              : ""}
          </span>
          {hasPager && (
            <button
              type="button"
              disabled={page * PAGE_SIZE >= total || acting}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
            >
              Próxima
            </button>
          )}
        </div>
      )}
    </>
  );
}
