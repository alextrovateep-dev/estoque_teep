"use client";

import { AssistenteEstoque } from "@/components/AssistenteEstoque";
import { api, apiDownload, getStoredUser, User } from "@/lib/api";
import { userHas } from "@/lib/access";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Dashboard = {
  escopo: {
    perfil: string;
    filialId: string | null;
    consolidado: boolean;
    timezone?: string;
  };
  kpis: {
    posicoesComSaldo: number;
    skusComSaldo: number;
    quantidadeTotal: number;
    valorTotal: number;
    alertasMinimo: number;
    alertasMaximo?: number;
    alertasEstoque?: number;
    pendentes: number;
    movimentosHoje: number;
    movimentos30d: number;
  };
  porOperacao30d?: Record<string, number>;
  alertas: Array<{
    produtoId: string;
    codigo: string;
    descricao: string;
    filialId: string;
    filialSigla: string;
    saldoAtual: number;
    estoqueMinimo: number;
    estoqueMaximo?: number;
    tipo?: "MINIMO" | "MAXIMO";
  }>;
  alertasMeta: {
    total: number;
    retornados: number;
    truncado: boolean;
    limite: number;
  };
  saldos: Array<{
    id: string;
    codigo: string;
    descricao: string;
    categoriaId?: string;
    categoriaNome?: string;
    filialSigla: string;
    filialNome: string;
    saldoAtual: number;
    estoqueMinimo: number;
    estoqueMaximo?: number;
    valor: number;
    abaixoMinimo: boolean;
    acimaMaximo?: boolean;
    produtoAtivo: boolean;
  }>;
  saldosMeta: {
    total: number;
    retornados: number;
    truncado: boolean;
    limite: number;
  };
  filiais: Array<{ id: string; nome: string; sigla: string }>;
};

type Categoria = { id: string; nome: string; ativo: boolean };

function money(n: number) {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function qty(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [filialId, setFilialId] = useState("");
  const [busca, setBusca] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [soAlertas, setSoAlertas] = useState(false);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  const isOpsManager =
    user?.perfil === "ADMIN" || user?.perfil === "GERENTE";

  useEffect(() => {
    setUser(getStoredUser());
    api<Categoria[]>("/categorias")
      .then((c) => setCategorias(c.filter((x) => x.ativo)))
      .catch(() => setCategorias([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    const ac = new AbortController();
    setLoading(true);
    setError("");
    setSelecionados(new Set());
    const params = new URLSearchParams();
    if (isOpsManager && filialId) params.set("filialId", filialId);
    api<Dashboard>(`/dashboard${params.toString() ? `?${params}` : ""}`, {
      signal: ac.signal,
    })
      .then((d) => {
        if (!ac.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [user, filialId, isOpsManager]);

  const saldosFiltrados = useMemo(() => {
    if (!data) return [];
    const q = busca.trim().toLowerCase();
    return data.saldos.filter((s) => {
      if (categoriaId && s.categoriaId !== categoriaId) return false;
      if (soAlertas && !(s.abaixoMinimo || s.acimaMaximo)) return false;
      if (!q) return true;
      return (
        s.codigo.toLowerCase().includes(q) ||
        s.descricao.toLowerCase().includes(q) ||
        s.filialSigla.toLowerCase().includes(q) ||
        s.filialNome.toLowerCase().includes(q) ||
        (s.categoriaNome || "").toLowerCase().includes(q)
      );
    });
  }, [data, busca, soAlertas, categoriaId]);

  useEffect(() => {
    const visible = new Set(saldosFiltrados.map((s) => s.id));
    setSelecionados((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed || next.size !== prev.size ? next : prev;
    });
  }, [saldosFiltrados]);

  const todosVisiveisSelecionados =
    saldosFiltrados.length > 0 &&
    saldosFiltrados.every((s) => selecionados.has(s.id));

  function toggleTodosVisiveis() {
    if (todosVisiveisSelecionados) {
      setSelecionados(new Set());
      return;
    }
    setSelecionados(new Set(saldosFiltrados.map((s) => s.id)));
  }

  function toggleLinha(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filialLabel =
    data && data.escopo.filialId
      ? data.filiais.find((f) => f.id === data.escopo.filialId)
      : null;

  async function exportSaldos(format: "pdf" | "xlsx") {
    setExporting(format);
    setError("");
    try {
      const params = new URLSearchParams();
      if (isOpsManager && filialId) params.set("filialId", filialId);
      if (selecionados.size > 0) {
        params.set("ids", [...selecionados].join(","));
      } else {
        if (busca.trim()) params.set("q", busca.trim());
        if (soAlertas) params.set("soAlertas", "1");
        if (categoriaId) params.set("categoriaId", categoriaId);
      }
      const qs = params.toString() ? `?${params}` : "";
      const { blob, filename } = await apiDownload(
        `/dashboard/saldos/export.${format}${qs}`,
        { fallbackFilename: `teep-saldos.${format === "pdf" ? "pdf" : "xlsx"}` }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na exportação");
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Dashboard / Saldos
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {user ? `Olá, ${user.nome}` : "Carregando…"}
            {data?.escopo.consolidado
              ? " · visão consolidada (todas as filiais)"
              : filialLabel
                ? ` · ${filialLabel.sigla} — ${filialLabel.nome}`
                : ""}
          </p>
        </div>
        {isOpsManager && data && (
          <label className="block sm:w-56">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Filial
            </span>
            <select
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={filialId}
              onChange={(e) => setFilialId(e.target.value)}
            >
              <option value="">Todas (consolidado)</option>
              {data.filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.sigla} — {f.nome}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading && (
        <p className="mt-4 text-sm text-slate-500">Carregando indicadores…</p>
      )}

      {data && !loading && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi
              label="Qtd. total em estoque"
              value={qty(data.kpis.quantidadeTotal)}
            />
            <Kpi
              label="Valor estimado"
              value={money(data.kpis.valorTotal)}
              hint="Saldo × preço cadastrado"
            />
            <Kpi
              label="Movimentos (30 dias)"
              value={String(data.kpis.movimentos30d)}
              hint="Concluídos — ver linha do tempo"
              href={
                user && userHas(user, "movimentacoes")
                  ? "/movimentacoes"
                  : undefined
              }
            />
          </div>

          {user && userHas(user, "assistente") && (
              <AssistenteEstoque filialId={filialId} />
            )}

          {(data.kpis.alertasEstoque ?? data.kpis.alertasMinimo) > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">
                Alertas de estoque (mín. / máx.)
              </h2>
              {data.alertasMeta.truncado && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Exibindo {data.alertasMeta.retornados} de{" "}
                  {data.alertasMeta.total} alertas (os mais críticos).
                </p>
              )}
              <ul className="mt-3 divide-y rounded-xl border bg-white">
                {data.alertas.map((a) => (
                  <li
                    key={`${a.filialId}-${a.produtoId}-${a.tipo || "MINIMO"}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <div>
                      <span className="font-mono text-xs">{a.codigo}</span>{" "}
                      {a.descricao}
                      <span className="ml-2 text-slate-400">
                        {a.filialSigla}
                      </span>
                      <span className="ml-2 text-xs font-medium text-amber-800">
                        {a.tipo === "MAXIMO" ? "acima do máx." : "abaixo do mín."}
                      </span>
                    </div>
                    <div className="text-amber-800">
                      Saldo {qty(a.saldoAtual)}
                      {a.tipo === "MAXIMO"
                        ? ` / máx. ${a.estoqueMaximo ?? "—"}`
                        : ` / mín. ${a.estoqueMinimo}`}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Saldos</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {selecionados.size > 0
                    ? `Exporta ${selecionados.size} item(ns) selecionado(s)`
                    : "Exporta o que estiver filtrado na tabela"}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={soAlertas}
                    onChange={(e) => setSoAlertas(e.target.checked)}
                  />
                  Só fora do mín./máx.
                </label>
                <select
                  className="rounded-lg border px-3 py-2 text-sm sm:w-44"
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                  aria-label="Filtrar por categoria"
                >
                  <option value="">Todas as categorias</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar produto, filial ou categoria…"
                  className="rounded-lg border px-3 py-2 text-sm sm:w-56"
                  autoComplete="off"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!!exporting || saldosFiltrados.length === 0}
                    onClick={() => void exportSaldos("pdf")}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-brand/40 disabled:opacity-50"
                  >
                    {exporting === "pdf" ? "Gerando…" : "Exportar PDF"}
                  </button>
                  <button
                    type="button"
                    disabled={!!exporting || saldosFiltrados.length === 0}
                    onClick={() => void exportSaldos("xlsx")}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-brand/40 disabled:opacity-50"
                  >
                    {exporting === "xlsx" ? "Gerando…" : "Exportar Excel"}
                  </button>
                </div>
              </div>
            </div>

            {data.saldosMeta.truncado && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Exibindo {data.saldosMeta.retornados} de{" "}
                {data.saldosMeta.total} posições (limite{" "}
                {data.saldosMeta.limite}).
                {data.escopo.consolidado
                  ? " Filtre por filial para ver o restante."
                  : " Refine a busca ou aumente o filtro na API."}
              </p>
            )}
            {soAlertas && data.saldosMeta.truncado && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                O filtro “só fora do mín./máx.” aplica-se apenas às posições
                carregadas na tabela. A lista de alertas acima usa a contagem
                completa.
              </p>
            )}

            <div className="mt-3 overflow-x-auto rounded-xl border bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={todosVisiveisSelecionados}
                        onChange={toggleTodosVisiveis}
                        disabled={saldosFiltrados.length === 0}
                        aria-label="Selecionar todos visíveis"
                        title="Selecionar todos visíveis"
                      />
                    </th>
                    <th className="px-3 py-2">Filial</th>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2">Categoria</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2 text-right">Mín.</th>
                    <th className="px-3 py-2 text-right">Máx.</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {saldosFiltrados.map((s) => {
                    const marcada = selecionados.has(s.id);
                    return (
                      <tr
                        key={s.id}
                        className={
                          s.abaixoMinimo || s.acimaMaximo
                            ? "border-t bg-amber-50/60"
                            : marcada
                              ? "border-t bg-brand/[0.06]"
                              : "border-t"
                        }
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={marcada}
                            onChange={() => toggleLinha(s.id)}
                            aria-label={`Selecionar ${s.codigo}`}
                          />
                        </td>
                        <td className="px-3 py-2">{s.filialSigla}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {s.codigo}
                        </td>
                        <td className="px-3 py-2">
                          {s.descricao}
                          {!s.produtoAtivo && (
                            <span className="ml-1 text-xs text-slate-400">
                              (inativo)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {s.categoriaNome || "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {qty(s.saldoAtual)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {s.estoqueMinimo || "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {s.estoqueMaximo || "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {money(s.valor)}
                        </td>
                      </tr>
                    );
                  })}
                  {saldosFiltrados.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-8 text-center text-slate-500"
                      >
                        Nenhum saldo para exibir.{" "}
                        {isOpsManager && (
                          <Link
                            href="/estoque/init"
                            className="text-brand hover:underline"
                          >
                            Inventário
                          </Link>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Exibindo {saldosFiltrados.length} na tabela
              {busca || soAlertas || categoriaId
                ? ` (filtro sobre ${data.saldos.length} carregados)`
                : ""}
              {selecionados.size > 0
                ? ` · ${selecionados.size} selecionado(s)`
                : ""}
            </p>
          </section>
        </>
      )}
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  accent,
  href,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "warn";
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="text-sm text-slate-500">{label}</div>
      <div
        className={
          accent === "warn"
            ? "mt-1 text-xl font-semibold text-amber-800"
            : "mt-1 text-xl font-semibold text-slate-900"
        }
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </>
  );
  const cls =
    "rounded-xl border border-slate-200 bg-white p-4 block text-left w-full hover:border-brand/40";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
