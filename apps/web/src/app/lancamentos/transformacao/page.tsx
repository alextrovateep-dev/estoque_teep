"use client";

import { api, getStoredUser, userFilialIds } from "@/lib/api";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Filial = { id: string; nome: string; sigla: string };
type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  controlaSerie?: boolean;
};
type SerieHit = {
  id: string;
  numeroSerie: string;
  status: string;
  produto: { id: string; codigo: string; descricao: string };
  filial: { id: string; sigla: string; nome: string } | null;
};
type PreviewLinha = {
  produtoFilhoId: string;
  codigo: string;
  descricao: string;
  qtdNecessaria: number;
  saldoDisponivel: number;
  faltante: number;
};
type TransformacaoRow = {
  id: string;
  criadoEm: string;
  numeroSerieOrigem: string;
  numeroSerieDestino: string;
  filial: { sigla: string; nome: string };
  produtoOrigem: { codigo: string; descricao: string };
  produtoDestino: { codigo: string; descricao: string };
  usuario: { nome: string };
};

export default function TransformacaoPage() {
  const user = useMemo(() => getStoredUser(), []);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [filialId, setFilialId] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [produtoOrigemId, setProdutoOrigemId] = useState("");
  const [produtoDestinoId, setProdutoDestinoId] = useState("");
  const [serieQ, setSerieQ] = useState("");
  const [serieHits, setSerieHits] = useState<SerieHit[]>([]);
  const [numeroSerieOrigem, setNumeroSerieOrigem] = useState("");
  const [numeroSerieDestino, setNumeroSerieDestino] = useState("");
  const [observacao, setObservacao] = useState("");
  const [preview, setPreview] = useState<{
    linhas: PreviewLinha[];
    okSaldo: boolean;
    faltantes: { codigo: string; faltante: number }[];
  } | null>(null);
  const [historico, setHistorico] = useState<TransformacaoRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    api<Filial[]>("/filiais")
      .then((rows) => {
        const allowed = new Set(user ? userFilialIds(user) : []);
        const scoped =
          user?.perfil === "OPERADOR" && allowed.size > 0
            ? rows.filter((f) => allowed.has(f.id))
            : rows;
        setFiliais(scoped);
        if (scoped[0] && !filialId) setFilialId(scoped[0].id);
      })
      .catch(() => undefined);
    api<Produto[]>("/produtos?limit=2000")
      .then((rows) => setProdutos(rows.filter((p) => p.controlaSerie)))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const loadHistorico = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ pageSize: "15" });
      if (filialId) qs.set("filialId", filialId);
      const r = await api<{ rows: TransformacaoRow[] }>(
        `/transformacoes?${qs}`
      );
      setHistorico(r.rows);
    } catch {
      /* ignore */
    }
  }, [filialId]);

  useEffect(() => {
    void loadHistorico();
  }, [loadHistorico]);

  useEffect(() => {
    if (serieQ.trim().length < 2 || !produtoOrigemId) {
      setSerieHits([]);
      return;
    }
    const t = setTimeout(() => {
      const qs = new URLSearchParams({
        q: serieQ.trim(),
        produtoId: produtoOrigemId,
        status: "EM_ESTOQUE",
      });
      if (filialId) qs.set("filialId", filialId);
      api<{ data: SerieHit[]; truncado?: boolean }>(`/series?${qs}`)
        .then((r) => setSerieHits(r.data || []))
        .catch(() => setSerieHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [serieQ, produtoOrigemId, filialId]);

  useEffect(() => {
    if (!filialId || !produtoDestinoId) {
      setPreview(null);
      return;
    }
    const qs = new URLSearchParams({
      filialId,
      produtoDestinoId,
    });
    if (produtoOrigemId) qs.set("produtoOrigemId", produtoOrigemId);
    api<{
      linhas: PreviewLinha[];
      okSaldo: boolean;
      faltantes: { codigo: string; faltante: number }[];
    }>(`/transformacoes/preview?${qs}`)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [filialId, produtoOrigemId, produtoDestinoId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOkMsg("");
    if (!filialId || !produtoOrigemId || !produtoDestinoId || !numeroSerieOrigem) {
      setError("Preencha estoque, produtos e série de origem.");
      return;
    }
    if (produtoOrigemId === produtoDestinoId) {
      setError("Origem e destino devem ser produtos diferentes.");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ mensagem: string; destino: { numeroSerie: string } }>(
        "/transformacoes",
        {
          method: "POST",
          body: JSON.stringify({
            filialId,
            produtoOrigemId,
            numeroSerieOrigem,
            produtoDestinoId,
            numeroSerieDestino: numeroSerieDestino.trim() || null,
            observacao: observacao.trim() || null,
          }),
        }
      );
      setOkMsg(r.mensagem);
      setNumeroSerieOrigem("");
      setNumeroSerieDestino("");
      setSerieQ("");
      setObservacao("");
      void loadHistorico();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na transformação");
    } finally {
      setBusy(false);
    }
  }

  const origem = produtos.find((p) => p.id === produtoOrigemId);
  const destino = produtos.find((p) => p.id === produtoDestinoId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Transformação de produto
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Acabado A (N/S) sai do estoque e nasce o produto B com N/S novo. A
          árvore de B define os componentes a baixar. Sem estorno automático.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          <Link href="/lancamentos/novo" className="text-brand hover:underline">
            Novo Lançamento
          </Link>
          {" · "}
          <Link href="/cadastros/arvore" className="text-brand hover:underline">
            Árvore de produto
          </Link>
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label className="block text-xs font-medium text-slate-600">
          Estoque
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={filialId}
            onChange={(e) => setFilialId(e.target.value)}
            required
          >
            <option value="">Selecione…</option>
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.sigla} — {f.nome}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-600">
            Produto origem (A)
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={produtoOrigemId}
              onChange={(e) => {
                setProdutoOrigemId(e.target.value);
                setNumeroSerieOrigem("");
                setSerieQ("");
              }}
              required
            >
              <option value="">Selecione…</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} — {p.descricao}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Produto destino (B)
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={produtoDestinoId}
              onChange={(e) => setProdutoDestinoId(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} — {p.descricao}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-xs font-medium text-slate-600">
          Buscar série de origem
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Digite o N/S…"
            value={serieQ}
            onChange={(e) => setSerieQ(e.target.value)}
            disabled={!produtoOrigemId}
          />
        </label>
        {serieHits.length > 0 && (
          <ul className="max-h-36 overflow-y-auto rounded-lg border border-slate-100 text-sm">
            {serieHits.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-slate-50"
                  onClick={() => {
                    setNumeroSerieOrigem(s.numeroSerie);
                    setSerieQ(s.numeroSerie);
                    setSerieHits([]);
                  }}
                >
                  <span className="font-mono font-medium">{s.numeroSerie}</span>
                  {s.filial ? (
                    <span className="ml-2 text-xs text-slate-400">
                      {s.filial.sigla}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          Série origem selecionada:{" "}
          <span className="font-mono font-medium text-slate-800">
            {numeroSerieOrigem || "—"}
          </span>
        </p>

        <label className="block text-xs font-medium text-slate-600">
          Série destino (opcional — vazio = gera automática)
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
            value={numeroSerieDestino}
            onChange={(e) => setNumeroSerieDestino(e.target.value)}
            placeholder="Deixe em branco para alocar"
          />
        </label>

        <label className="block text-xs font-medium text-slate-600">
          Observação
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={500}
          />
        </label>

        {preview && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Componentes a baixar (árvore de {destino?.codigo || "B"})
            </p>
            {preview.linhas.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                Nenhum componente além da origem (ou só fantasmas). Só A será
                baixado.
              </p>
            ) : (
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-1">Código</th>
                    <th className="py-1 text-right">Precisa</th>
                    <th className="py-1 text-right">Disp.</th>
                    <th className="py-1 text-right">Falta</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.linhas.map((l) => (
                    <tr key={l.produtoFilhoId} className="border-t border-slate-100">
                      <td className="py-1.5 font-mono">{l.codigo}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {l.qtdNecessaria}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {l.saldoDisponivel}
                      </td>
                      <td
                        className={`py-1.5 text-right tabular-nums ${
                          l.faltante > 0 ? "font-semibold text-red-600" : ""
                        }`}
                      >
                        {l.faltante}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!preview.okSaldo && (
              <p className="mt-2 text-sm text-red-600">
                Saldo insuficiente:{" "}
                {preview.faltantes
                  .map((f) => `${f.codigo} (−${f.faltante})`)
                  .join(", ")}
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {okMsg && <p className="text-sm text-emerald-700">{okMsg}</p>}

        <button
          type="submit"
          disabled={
            busy ||
            !numeroSerieOrigem ||
            (preview !== null && !preview.okSaldo)
          }
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy
            ? "Processando…"
            : origem && destino
              ? `Transformar ${origem.codigo} → ${destino.codigo}`
              : "Confirmar transformação"}
        </button>
      </form>

      <section>
        <h2 className="text-sm font-semibold text-slate-800">
          Últimas transformações
        </h2>
        {historico.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhuma ainda.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {historico.map((h) => (
              <li key={h.id} className="px-3 py-2.5">
                <p className="font-medium text-slate-800">
                  <span className="font-mono">{h.produtoOrigem.codigo}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span className="font-mono">{h.produtoDestino.codigo}</span>
                </p>
                <p className="text-xs text-slate-500">
                  N/S {h.numeroSerieOrigem} → {h.numeroSerieDestino} ·{" "}
                  {h.filial.sigla} · {h.usuario.nome} ·{" "}
                  {new Date(h.criadoEm).toLocaleString("pt-BR")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
