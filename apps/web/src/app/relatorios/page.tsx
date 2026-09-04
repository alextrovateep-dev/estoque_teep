"use client";

import { api, apiDownload, getStoredUser } from "@/lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Aba = "produtos" | "saldos" | "arvores";

type Filial = { id: string; nome: string; sigla: string };
type Categoria = { id: string; nome: string; ativo: boolean };

type ProdutoRow = {
  id: string;
  codigo: string;
  descricao: string;
  categoriaNome: string;
  precoUnitario: number;
  unidade: string;
  estoqueMinimo: number;
  estoqueMaximo: number;
  ativo: boolean;
  controlaSerie: boolean;
};

type SaldoRow = {
  id: string;
  filialSigla: string;
  codigo: string;
  descricao: string;
  categoriaNome: string;
  saldoAtual: number;
  estoqueMinimo: number;
  estoqueMaximo: number;
  valor: number;
  abaixoMinimo: boolean;
  acimaMaximo: boolean;
  produtoAtivo: boolean;
};

type ArvoreRow = {
  produtoPaiId: string;
  codigo: string;
  descricao: string;
  categoriaNome?: string;
  grupo?: "acabado" | "semi" | "outro";
  precoUnitario: number;
  qtdComponentes: number;
  totalComposicao: number;
  totalBaixa: number;
  componentes: Array<{
    codigo: string;
    descricao: string;
    quantidade: number;
    fantasma: boolean;
    temBom?: boolean;
    precoUnitario: number;
    valorLinha: number;
  }>;
};

const ABAS: Array<{ id: Aba; label: string }> = [
  { id: "produtos", label: "Produtos" },
  { id: "saldos", label: "Estoque / saldos" },
  { id: "arvores", label: "Árvore de produto" },
];

function money(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function qty(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function labelGrupoArvore(grupo: "acabado" | "semi" | "outro" | undefined) {
  if (grupo === "semi") return "Semi-acabados";
  if (grupo === "outro") return "Outros";
  return "Produtos acabados";
}

function parseAba(raw: string | null): Aba {
  if (raw === "produtos" || raw === "saldos" || raw === "arvores") return raw;
  return "saldos";
}

function RelatoriosInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = getStoredUser();
  const isOpsManager =
    user?.perfil === "ADMIN" || user?.perfil === "GERENTE";
  const fetchGen = useRef(0);

  const [aba, setAba] = useState<Aba>(() => parseAba(searchParams.get("aba")));
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [filialId, setFilialId] = useState(searchParams.get("filialId") || "");
  const [categoriaId, setCategoriaId] = useState(
    searchParams.get("categoriaId") || ""
  );
  const [alerta, setAlerta] = useState(searchParams.get("alerta") || "");
  const [ativo, setAtivo] = useState(() => {
    const a = searchParams.get("ativo");
    if (a === null) return "true";
    return a;
  });
  const [produtoPaiId, setProdutoPaiId] = useState(
    searchParams.get("produtoPaiId") || ""
  );
  const [explodir, setExplodir] = useState(
    () =>
      searchParams.get("explodir") === "1" ||
      searchParams.get("explodir") === "true" ||
      Boolean(searchParams.get("produtoPaiId"))
  );

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const [produtos, setProdutos] = useState<ProdutoRow[]>([]);
  const [saldos, setSaldos] = useState<SaldoRow[]>([]);
  const [arvores, setArvores] = useState<ArvoreRow[]>([]);
  const [total, setTotal] = useState(0);
  const [metaLinhas, setMetaLinhas] = useState<string>("");

  const pageSize = aba === "arvores" ? 20 : 50;

  /** Deep-link do assistente / navegação: re-sincroniza estado com a URL. */
  useEffect(() => {
    const nextAba = parseAba(searchParams.get("aba"));
    setAba(nextAba);
    setQ(searchParams.get("q") || "");
    setFilialId(searchParams.get("filialId") || "");
    setCategoriaId(searchParams.get("categoriaId") || "");
    setAlerta(searchParams.get("alerta") || "");
    const ativoParam = searchParams.get("ativo");
    setAtivo(ativoParam === null && nextAba === "produtos" ? "true" : ativoParam || "");
    setProdutoPaiId(searchParams.get("produtoPaiId") || "");
    const exp = searchParams.get("explodir");
    const pai = searchParams.get("produtoPaiId");
    if (exp === "0" || exp === "false") {
      setExplodir(false);
    } else if (exp === "1" || exp === "true") {
      setExplodir(true);
    } else {
      setExplodir(Boolean(pai));
    }
    setPage(1);
  }, [searchParams]);

  useEffect(() => {
    api<Filial[]>("/filiais")
      .then((rows) => {
        if (!isOpsManager && user) {
          const allowed = new Set(
            (user.filialIds?.length
              ? user.filialIds
              : user.filialId
                ? [user.filialId]
                : []) as string[]
          );
          const scoped = rows.filter((f) => allowed.has(f.id));
          setFiliais(scoped);
          if (scoped.length === 1 && !filialId) {
            setFilialId(scoped[0]!.id);
          } else if (filialId && !allowed.has(filialId) && scoped[0]) {
            setFilialId(scoped[0].id);
          }
          return;
        }
        setFiliais(rows);
      })
      .catch(() => undefined);
    api<Categoria[]>("/categorias")
      .then((c) => setCategorias(c.filter((x) => x.ativo)))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só no mount / perfil
  }, [isOpsManager, user?.id]);

  const syncUrl = useCallback(
    (next: Aba) => {
      const params = new URLSearchParams();
      params.set("aba", next);
      if (q.trim()) params.set("q", q.trim());
      if (next === "saldos" && filialId) params.set("filialId", filialId);
      if (categoriaId && (next === "saldos" || next === "produtos")) {
        params.set("categoriaId", categoriaId);
      }
      if (next === "saldos" && alerta) params.set("alerta", alerta);
      if (next === "produtos" && (ativo === "true" || ativo === "false")) {
        params.set("ativo", ativo);
      }
      if (next === "arvores" && produtoPaiId) {
        params.set("produtoPaiId", produtoPaiId);
      }
      if (next === "arvores") {
        params.set("explodir", explodir ? "1" : "0");
      }
      router.replace(`/relatorios?${params.toString()}`, { scroll: false });
    },
    [q, filialId, categoriaId, alerta, ativo, produtoPaiId, explodir, router]
  );

  function selectAba(next: Aba) {
    setAba(next);
    setPage(1);
    setError("");
    if (next !== "arvores") {
      setProdutoPaiId("");
      setExplodir(false);
    }
    syncUrl(next);
  }

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (aba === "saldos") {
      if (filialId) p.set("filialId", filialId);
      if (categoriaId) p.set("categoriaId", categoriaId);
      if (alerta === "min" || alerta === "max" || alerta === "qualquer") {
        p.set("alerta", alerta);
      }
    }
    if (aba === "produtos") {
      if (categoriaId) p.set("categoriaId", categoriaId);
      if (ativo === "true" || ativo === "false") p.set("ativo", ativo);
    }
    if (aba === "arvores" && produtoPaiId) {
      p.set("produtoPaiId", produtoPaiId);
    }
    if (aba === "arvores") {
      p.set("explodir", explodir ? "1" : "0");
    }
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [
    aba,
    q,
    filialId,
    categoriaId,
    alerta,
    ativo,
    produtoPaiId,
    explodir,
    page,
    pageSize,
  ]);

  const load = useCallback(async () => {
    const gen = ++fetchGen.current;
    setLoading(true);
    setError("");
    try {
      if (aba === "produtos") {
        const r = await api<{
          rows: ProdutoRow[];
          total: number;
          meta: { linhas: number; truncado?: boolean; total?: number };
        }>(`/relatorios/produtos?${queryString}`);
        if (gen !== fetchGen.current) return;
        setProdutos(r.rows);
        setSaldos([]);
        setArvores([]);
        setTotal(r.total);
        setMetaLinhas(
          r.meta.truncado
            ? `${r.meta.linhas} de ${r.meta.total} produtos`
            : `${r.meta.linhas} produto(s)`
        );
      } else if (aba === "saldos") {
        const r = await api<{
          rows: SaldoRow[];
          total: number;
          meta: {
            linhas: number;
            quantidadeTotal: number;
            valorTotal: number;
            truncado?: boolean;
            totalPosicoes?: number;
            limite?: number;
          };
        }>(`/relatorios/saldos?${queryString}`);
        if (gen !== fetchGen.current) return;
        setSaldos(r.rows);
        setProdutos([]);
        setArvores([]);
        setTotal(r.total);
        const trunc =
          r.meta.truncado && r.meta.totalPosicoes && r.meta.limite
            ? ` · base limitada a ${r.meta.limite} de ${r.meta.totalPosicoes}`
            : "";
        setMetaLinhas(
          `${r.meta.linhas} linha(s) · qty ${qty(r.meta.quantidadeTotal)} · ${money(r.meta.valorTotal)}${trunc}`
        );
      } else {
        const r = await api<{
          rows: ArvoreRow[];
          total: number;
          meta: {
            linhasPai: number;
            linhasComponente: number;
            truncado?: boolean;
            multinivel?: boolean;
            limite?: number;
          };
        }>(`/relatorios/arvores?${queryString}`);
        if (gen !== fetchGen.current) return;
        setArvores(r.rows);
        setProdutos([]);
        setSaldos([]);
        setTotal(r.total);
        const nivel = r.meta.multinivel ? "multinível" : "1 nível";
        const trunc =
          r.meta.truncado && r.meta.limite
            ? ` · truncado (limite ${r.meta.limite})`
            : r.meta.truncado
              ? " · truncado"
              : "";
        setMetaLinhas(
          `${r.meta.linhasPai} árvore(s) · ${r.meta.linhasComponente} componente(s) · ${nivel}${trunc}`
        );
      }
    } catch (e) {
      if (gen !== fetchGen.current) return;
      setError(e instanceof Error ? e.message : "Erro ao carregar");
      setProdutos([]);
      setSaldos([]);
      setArvores([]);
      setTotal(0);
      setMetaLinhas("");
    } finally {
      if (gen === fetchGen.current) setLoading(false);
    }
  }, [aba, queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportar(format: "pdf" | "xlsx") {
    setExporting(true);
    setError("");
    try {
      const base =
        aba === "produtos"
          ? "/relatorios/produtos"
          : aba === "saldos"
            ? "/relatorios/saldos"
            : "/relatorios/arvores";
      const exportQs = new URLSearchParams(queryString);
      exportQs.delete("page");
      exportQs.delete("pageSize");
      const path = `${base}/export.${format}?${exportQs.toString()}`;
      const { blob, filename } = await apiDownload(path, {
        fallbackFilename: `teep-${aba}.${format}`,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao exportar");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Relatórios
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Consulte e exporte produtos, estoque e árvores de produto (PDF /
            Excel).
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={exporting || loading}
            onClick={() => void exportar("pdf")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand/40 disabled:opacity-50"
          >
            {exporting ? "Gerando…" : "Exportar PDF"}
          </button>
          <button
            type="button"
            disabled={exporting || loading}
            onClick={() => void exportar("xlsx")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand/40 disabled:opacity-50"
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {ABAS.map((t) => {
          const selected = aba === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectAba(t.id)}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                selected
                  ? "border-brand bg-brand/5 font-semibold text-brand ring-2 ring-brand/20"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <label className="min-w-[10rem] flex-1 text-xs">
          <span className="mb-1 block font-medium text-slate-600">Busca</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
            placeholder={
              aba === "arvores"
                ? "Código ou descrição do pai…"
                : "Código ou descrição…"
            }
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>

        {(aba === "produtos" || aba === "saldos") && (
          <label className="min-w-[9rem] text-xs">
            <span className="mb-1 block font-medium text-slate-600">
              Categoria
            </span>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={categoriaId}
              onChange={(e) => {
                setCategoriaId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        {aba === "produtos" && (
          <label className="min-w-[8rem] text-xs">
            <span className="mb-1 block font-medium text-slate-600">Ativo</span>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={ativo}
              onChange={(e) => {
                setAtivo(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="true">Somente ativos</option>
              <option value="false">Somente inativos</option>
            </select>
          </label>
        )}

        {aba === "saldos" && (
          <>
            <label className="min-w-[10rem] text-xs">
              <span className="mb-1 block font-medium text-slate-600">
                Estoque
              </span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={filialId}
                onChange={(e) => {
                  setFilialId(e.target.value);
                  setPage(1);
                }}
              >
                {isOpsManager && (
                  <option value="">Todas (consolidado)</option>
                )}
                {filiais.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.sigla} — {f.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[10rem] text-xs">
              <span className="mb-1 block font-medium text-slate-600">
                Alerta
              </span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={alerta}
                onChange={(e) => {
                  setAlerta(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos</option>
                <option value="min">Abaixo do mínimo</option>
                <option value="max">Acima do máximo</option>
                <option value="qualquer">Fora do mín./máx.</option>
              </select>
            </label>
          </>
        )}

        {aba === "arvores" && (
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs text-slate-700">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={explodir}
              onChange={(e) => {
                setExplodir(e.target.checked);
                setPage(1);
              }}
            />
            <span>
              Multinível
              <span className="ml-1 text-slate-400">
                (inclui subárvores, ex. KIT)
              </span>
            </span>
          </label>
        )}

        <button
          type="button"
          onClick={() => {
            syncUrl(aba);
            void load();
          }}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"
        >
          Atualizar
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{loading ? "Carregando…" : metaLinhas}</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>
              Página {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {aba === "produtos" && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2 text-right">Preço</th>
                <th className="px-3 py-2">Un.</th>
                <th className="px-3 py-2 text-right">Mín.</th>
                <th className="px-3 py-2 text-right">Máx.</th>
                <th className="px-3 py-2">Ativo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {produtos.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Nenhum produto encontrado.
                  </td>
                </tr>
              )}
              {produtos.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-mono text-xs">{r.codigo}</td>
                  <td className="px-3 py-2">{r.descricao}</td>
                  <td className="px-3 py-2 text-slate-600">{r.categoriaNome}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(r.precoUnitario)}
                  </td>
                  <td className="px-3 py-2">{r.unidade}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {r.estoqueMinimo || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {r.estoqueMaximo || "—"}
                  </td>
                  <td className="px-3 py-2">{r.ativo ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === "saldos" && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Filial</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2 text-right">Mín.</th>
                <th className="px-3 py-2 text-right">Máx.</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Alerta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {saldos.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Nenhuma posição encontrada.
                  </td>
                </tr>
              )}
              {saldos.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.abaixoMinimo || r.acimaMaximo
                      ? "bg-amber-50/60"
                      : "hover:bg-slate-50/80"
                  }
                >
                  <td className="px-3 py-2 font-medium">{r.filialSigla}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.codigo}</td>
                  <td className="px-3 py-2">
                    {r.descricao}
                    {!r.produtoAtivo && (
                      <span className="ml-1 text-xs text-slate-400">
                        (inativo)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.categoriaNome}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {qty(r.saldoAtual)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {r.estoqueMinimo || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {r.estoqueMaximo || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(r.valor)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.abaixoMinimo
                      ? "Abaixo mín."
                      : r.acimaMaximo
                        ? "Acima máx."
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === "arvores" && (
        <div className="mt-4 space-y-6">
          {arvores.length === 0 && !loading && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-500">
              Nenhuma árvore encontrada.
            </div>
          )}
          {(["acabado", "semi", "outro"] as const).map((grupoId) => {
            const doGrupo = arvores.filter(
              (p) => (p.grupo || "acabado") === grupoId
            );
            if (doGrupo.length === 0) return null;
            return (
              <section key={grupoId} className="space-y-3">
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {labelGrupoArvore(grupoId)}
                  </h2>
                  <span className="text-xs tabular-nums text-slate-400">
                    {doGrupo.length} árvore(s)
                  </span>
                </div>
                {doGrupo.map((p) => {
                  const somaQtd = p.componentes.reduce(
                    (s, c) => s + Number(c.quantidade || 0),
                    0
                  );
                  const somaValor = p.componentes.reduce(
                    (s, c) => s + Number(c.valorLinha || 0),
                    0
                  );
                  return (
                    <article
                      key={p.produtoPaiId}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                    >
                      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold text-slate-900">
                            {p.codigo}
                          </p>
                          <p className="mt-0.5 text-sm text-slate-600">
                            {p.descricao}
                          </p>
                          {p.categoriaNome ? (
                            <p className="mt-1 text-[11px] text-slate-400">
                              {p.categoriaNome}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-3 text-right text-xs text-slate-500">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">
                              Preço pai
                            </p>
                            <p className="tabular-nums font-medium text-slate-800">
                              {money(p.precoUnitario)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">
                              Composição
                            </p>
                            <p className="tabular-nums font-medium text-slate-800">
                              {money(p.totalComposicao)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">
                              Só baixa
                            </p>
                            <p className="tabular-nums font-medium text-slate-800">
                              {money(p.totalBaixa)}
                            </p>
                          </div>
                        </div>
                      </header>

                      <div className="overflow-x-auto px-2 sm:px-3">
                        <table className="min-w-full text-xs">
                          <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
                            <tr>
                              <th className="px-2 py-2.5">Código</th>
                              <th className="px-2 py-2.5">Componente</th>
                              <th className="px-2 py-2.5 text-right">Qtd</th>
                              <th className="px-2 py-2.5 text-right">Preço</th>
                              <th className="px-2 py-2.5 text-right">Valor</th>
                              <th className="px-2 py-2.5">Fantasma</th>
                              <th className="px-2 py-2.5">Subárvore</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.componentes.map((c) => (
                              <tr
                                key={`${p.produtoPaiId}-${c.codigo}`}
                                className="border-b border-slate-50 last:border-0"
                              >
                                <td className="px-2 py-2 font-mono text-slate-800">
                                  {c.codigo}
                                </td>
                                <td className="px-2 py-2 text-slate-700">
                                  {c.descricao}
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                  {qty(c.quantidade)}
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                  {money(c.precoUnitario)}
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                  {money(c.valorLinha)}
                                </td>
                                <td className="px-2 py-2 text-slate-500">
                                  {c.fantasma ? (
                                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                                      Sim
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="px-2 py-2 text-slate-500">
                                  {c.temBom ? (
                                    <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                                      Sim
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t border-slate-100 bg-slate-50/60 font-medium text-slate-800">
                            <tr>
                              <td className="px-2 py-2.5" colSpan={2}>
                                {p.qtdComponentes} item(ns)
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums">
                                {qty(somaQtd)}
                              </td>
                              <td className="px-2 py-2.5 text-right text-slate-400">
                                —
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums">
                                {money(somaValor)}
                              </td>
                              <td className="px-2 py-2.5" />
                              <td className="px-2 py-2.5" />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function RelatoriosPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-slate-500">Carregando relatórios…</p>
      }
    >
      <RelatoriosInner />
    </Suspense>
  );
}
