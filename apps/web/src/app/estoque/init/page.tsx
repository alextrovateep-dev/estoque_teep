"use client";

import { api } from "@/lib/api";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { SeriesInput } from "@/components/SeriesInput";

type Filial = { id: string; nome: string; sigla: string };
type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  controlaSerie?: boolean;
};
type EstoqueRow = {
  produtoId: string;
  codigo: string;
  descricao: string;
  controlaSerie: boolean;
  saldoAtual: number;
  novoSaldo: string;
  series: string[];
};

export default function InitEstoquePage() {
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [filialId, setFilialId] = useState("");
  const [rows, setRows] = useState<EstoqueRow[]>([]);
  const [confirmarReinit, setConfirmarReinit] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [estoquesTruncado, setEstoquesTruncado] = useState(false);
  const [expandSerie, setExpandSerie] = useState<string | null>(null);
  const [produtoFiltro, setProdutoFiltro] = useState("");

  useEffect(() => {
    api<Filial[]>("/filiais")
      .then((f) => {
        setFiliais(f);
        if (f[0]) setFilialId(f[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!filialId) return;
    setProdutoFiltro("");
    Promise.all([
      api<Produto[]>("/produtos"),
      api<{
        data: Array<{
          produtoId: string;
          saldoAtual: string | number;
          produto: Produto;
        }>;
        truncado?: boolean;
        total?: number;
      }>(`/estoques?filialId=${filialId}&limit=2000`),
    ])
      .then(([produtos, estoquesRes]) => {
        setEstoquesTruncado(Boolean(estoquesRes.truncado));
        const map = new Map(
          estoquesRes.data.map((e) => [e.produtoId, Number(e.saldoAtual)])
        );
        setRows(
          produtos.map((p) => ({
            produtoId: p.id,
            codigo: p.codigo,
            descricao: p.descricao,
            controlaSerie: Boolean(p.controlaSerie),
            saldoAtual: map.get(p.id) ?? 0,
            novoSaldo: String(map.get(p.id) ?? 0),
            series: [],
          }))
        );
      })
      .catch((e) => setError(e.message));
  }, [filialId]);

  const rowsFiltradas = useMemo(() => {
    const q = produtoFiltro.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.codigo.toLowerCase().includes(q) ||
        r.descricao.toLowerCase().includes(q)
    );
  }, [rows, produtoFiltro]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const itens = rows
        .map((r) => {
          const saldo = Number(r.novoSaldo);
          const delta = saldo - r.saldoAtual;
          const base: {
            produtoId: string;
            saldo: number;
            series?: string[];
          } = {
            produtoId: r.produtoId,
            saldo,
          };
          if (r.controlaSerie && delta !== 0) {
            base.series = r.series;
          } else if (r.controlaSerie && r.saldoAtual === 0 && saldo > 0) {
            base.series = r.series;
          }
          return base;
        })
        .filter((i) => !Number.isNaN(i.saldo));

      for (const r of rows) {
        const saldo = Number(r.novoSaldo);
        const delta = saldo - r.saldoAtual;
        if (!r.controlaSerie || delta === 0) continue;
        const need = Math.abs(delta);
        if (r.series.length !== need) {
          throw new Error(
            `${r.codigo}: informe ${need} série(s) para o ajuste (Δ=${delta})`
          );
        }
      }

      const result = await api<{
        resultados: unknown[];
        alertas?: Array<{ mensagem: string }>;
      }>("/estoques/inicializacao", {
        method: "POST",
        body: JSON.stringify({ filialId, itens, confirmarReinit }),
      });
      const extras = result.alertas?.map((a) => a.mensagem).join(" · ");
      setMsg(
        `Inicialização concluída (${result.resultados.length} itens)` +
          (extras ? ` · ${extras}` : "")
      );
      setConfirmarReinit(false);
      const estoquesRes = await api<{
        data: Array<{ produtoId: string; saldoAtual: string | number }>;
      }>(`/estoques?filialId=${filialId}&limit=2000`);
      const map = new Map(
        estoquesRes.data.map((e) => [e.produtoId, Number(e.saldoAtual)])
      );
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          saldoAtual: map.get(r.produtoId) ?? 0,
          novoSaldo: String(map.get(r.produtoId) ?? 0),
          series: [],
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Inventário / Saldo inicial</h1>
      <p className="mt-1 text-sm text-slate-500">
        Produtos com rastreio de série: digite os códigos físicos no ajuste (1
        série = 1 unidade). O sistema valida disponibilidade no estoque.
      </p>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[14rem] flex-1 max-w-md text-sm">
            Filial
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={filialId}
              onChange={(e) => setFilialId(e.target.value)}
            >
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.sigla} — {f.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[16rem] flex-1 max-w-lg text-sm">
            Produto
            <div className="mt-1 flex gap-1">
              <input
                type="search"
                value={produtoFiltro}
                onChange={(e) => setProdutoFiltro(e.target.value)}
                placeholder="Código ou descrição…"
                className="w-full rounded-lg border px-3 py-2"
                autoComplete="off"
              />
              {produtoFiltro ? (
                <button
                  type="button"
                  onClick={() => setProdutoFiltro("")}
                  className="shrink-0 rounded-lg border px-2 text-slate-500 hover:bg-slate-50"
                  title="Limpar filtro"
                >
                  ×
                </button>
              ) : null}
            </div>
          </label>
        </div>

        {estoquesTruncado ? (
          <p className="text-sm text-amber-700">
            Lista truncada — nem todos os saldos foram carregados.
          </p>
        ) : null}

        {produtoFiltro.trim() ? (
          <p className="text-xs text-slate-500">
            Exibindo {rowsFiltradas.length} de {rows.length} produto
            {rows.length === 1 ? "" : "s"}
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Atual</th>
                <th className="px-3 py-2">Novo saldo</th>
                <th className="px-3 py-2">Séries</th>
              </tr>
            </thead>
            <tbody>
              {rowsFiltradas.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Nenhum produto encontrado.
                  </td>
                </tr>
              ) : (
                rowsFiltradas.map((r) => {
                  const delta = Number(r.novoSaldo) - r.saldoAtual;
                  const needsSeries = r.controlaSerie && delta !== 0;
                  return (
                    <tr key={r.produtoId} className="border-t align-top">
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.codigo}
                        {r.controlaSerie ? (
                          <span className="ml-1 rounded bg-teal-50 px-1 text-[10px] uppercase text-teal-800">
                            Série
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{r.descricao}</td>
                      <td className="px-3 py-2">{r.saldoAtual}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step={r.controlaSerie ? 1 : "any"}
                          className="w-28 rounded border px-2 py-1"
                          value={r.novoSaldo}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((x) =>
                                x.produtoId === r.produtoId
                                  ? { ...x, novoSaldo: e.target.value }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 min-w-[14rem]">
                        {needsSeries ? (
                          expandSerie === r.produtoId ? (
                            <SeriesInput
                              value={r.series}
                              onChange={(series) =>
                                setRows((prev) =>
                                  prev.map((x) =>
                                    x.produtoId === r.produtoId
                                      ? { ...x, series }
                                      : x
                                  )
                                )
                              }
                              label={`Séries do Δ (${Math.abs(delta)})`}
                            />
                          ) : (
                            <button
                              type="button"
                              className="text-sm text-teal-800 underline"
                              onClick={() => setExpandSerie(r.produtoId)}
                            >
                              Informar {Math.abs(delta)} série(s)
                              {r.series.length
                                ? ` (${r.series.length})`
                                : ""}
                            </button>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmarReinit}
            onChange={(e) => setConfirmarReinit(e.target.checked)}
          />
          <span>
            <span className="font-medium text-slate-800">
              Permitir alterar produtos que já têm saldo
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Sem este tique, só é possível definir saldo em produtos zerados.
              Marque apenas se quiser mesmo ajustar estoque já existente.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {msg && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {msg}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Salvando…" : "Aplicar inventário"}
        </button>
      </form>
    </>
  );
}
