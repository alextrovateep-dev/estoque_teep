"use client";

import { ConfirmMotivoPanel } from "@/components/ConfirmMotivoPanel";
import { api } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import { useCallback, useEffect, useState } from "react";

type Mov = {
  id: string;
  operacao: string;
  quantidade: string | number;
  status: string;
  dataMovimento: string;
  observacao?: string | null;
  notaFiscalNumero?: string | null;
  notaFiscalArquivo?: string | null;
  produto: { codigo: string; descricao: string };
  tipo: { nome: string };
  filial: { sigla: string };
  filialDestino?: { sigla: string } | null;
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
  }>;
};

const PAGE_SIZE = 20;

export default function AprovacoesPage() {
  const [data, setData] = useState<Mov[]>([]);
  const [transf, setTransf] = useState<TransfPendente[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [rejeitandoId, setRejeitandoId] = useState<string | null>(null);
  const [rejeitandoTipo, setRejeitandoTipo] = useState<"mov" | "transf" | null>(
    null
  );
  const [motivo, setMotivo] = useState("");

  const load = useCallback(async () => {
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
      setData(movs.data);
      setTotal(movs.total);
      setTransf(tr.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function aprovar(id: string) {
    setActing(id);
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
      setActing(null);
    }
  }

  async function aprovarTransf(id: string) {
    setActing(id);
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
      setActing(null);
    }
  }

  async function confirmarRejeicao() {
    if (!rejeitandoId || !rejeitandoTipo) return;
    const id = rejeitandoId;
    const tipo = rejeitandoTipo;
    setActing(id);
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
      setActing(null);
    }
  }

  const vazio = !loading && data.length === 0 && transf.length === 0;

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

        {transf.map((t) => (
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
              {t.itens.map((i) => (
                <li key={i.id}>
                  <span className="font-mono text-xs">{i.produto.codigo}</span>{" "}
                  {i.produto.descricao} · qtd {Number(i.qtdEnviada)}
                </li>
              ))}
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
                loading={acting === t.id}
                danger
              />
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={acting === t.id}
                  onClick={() => void aprovarTransf(t.id)}
                  className="rounded-lg bg-brand px-3 py-2 text-white disabled:opacity-50"
                >
                  Aprovar
                </button>
                <button
                  type="button"
                  disabled={acting === t.id}
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

        {data.map((m) => (
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
            <div className="mt-1 text-slate-600">
              Qtd: {Number(m.quantidade)} · {m.operacao} · {m.usuario.nome}
            </div>
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
                loading={acting === m.id}
                danger
              />
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={acting === m.id}
                  onClick={() => void aprovar(m.id)}
                  className="rounded-lg bg-brand px-3 py-2 text-white disabled:opacity-50"
                >
                  Aprovar
                </button>
                <button
                  type="button"
                  disabled={acting === m.id}
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
        ))}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-sm text-slate-500">
            Página {page} · {total} movimento{total === 1 ? "" : "s"} +{" "}
            {transf.length} transferência{transf.length === 1 ? "" : "s"}
          </span>
          <button
            disabled={page * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </>
  );
}
