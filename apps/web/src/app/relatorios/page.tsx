"use client";

import { api, apiDownload, getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import { ArvoreComponentesTabela } from "@/components/relatorios/ArvoreComponentesTabela";
import { MovimentacoesRelatorioTab } from "@/components/relatorios/MovimentacoesRelatorioTab";
import { RmaProdutosRelatorioTab } from "@/components/relatorios/RmaProdutosRelatorioTab";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Aba = "saldos" | "movimentacoes" | "produtos" | "arvores" | "rma-produtos";

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
  precoUnitario: number;
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
    produtoFilhoId?: string;
    codigo: string;
    descricao: string;
    quantidade: number;
    fantasma: boolean;
    temBom?: boolean;
    precoUnitario: number;
    valorLinha: number;
  }>;
};

type ArvoreSugestao = {
  produtoPaiId: string;
  codigo: string;
  descricao: string;
  qtdComponentes: number;
};

const ABAS: Array<{ id: Aba; label: string }> = [
  { id: "saldos", label: "Estoque / saldos" },
  { id: "movimentacoes", label: "Movimentações" },
  { id: "produtos", label: "Produtos" },
  { id: "arvores", label: "Árvore de produto" },
  { id: "rma-produtos", label: "Produtos em RMA" },
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

function parseAba(
  raw: string | null,
  podeRelatorios: boolean,
  podeMovimentacoes: boolean
): Aba {
  if (raw === "movimentacoes" && podeMovimentacoes) return "movimentacoes";
  if (
    (raw === "produtos" ||
      raw === "saldos" ||
      raw === "arvores" ||
      raw === "rma-produtos") &&
    podeRelatorios
  ) {
    return raw;
  }
  if (!podeRelatorios && podeMovimentacoes) return "movimentacoes";
  return "saldos";
}

function RelatoriosInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = getStoredUser();
  const isOpsManager =
    user?.perfil === "ADMIN" || user?.perfil === "GERENTE";
  const podeRelatoriosGerais = Boolean(
    user && (user.perfil === "ADMIN" || userHas(user, "relatorios"))
  );
  const podeMovimentacoes = Boolean(
    user && (user.perfil === "ADMIN" || userHas(user, "movimentacoes"))
  );

  const abasDisponiveis = useMemo(() => {
    return ABAS.filter((t) => {
      if (t.id === "movimentacoes") return podeMovimentacoes;
      return podeRelatoriosGerais;
    });
  }, [podeRelatoriosGerais, podeMovimentacoes]);

  const fetchGen = useRef(0);

  const [aba, setAba] = useState<Aba>(() =>
    parseAba(searchParams.get("aba"), podeRelatoriosGerais, podeMovimentacoes)
  );
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
  const [produtoPaiLabel, setProdutoPaiLabel] = useState("");
  const [paiBusca, setPaiBusca] = useState(searchParams.get("q") || "");
  const [paiOpen, setPaiOpen] = useState(false);
  const [paiSugestoes, setPaiSugestoes] = useState<ArvoreSugestao[]>([]);
  const [paiBuscando, setPaiBuscando] = useState(false);
  const [arvoresSelecionadas, setArvoresSelecionadas] = useState<Set<string>>(
    () => new Set()
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
    const nextAba = parseAba(
      searchParams.get("aba"),
      podeRelatoriosGerais,
      podeMovimentacoes
    );
    setAba(nextAba);
    setFilialId(searchParams.get("filialId") || "");
    setCategoriaId(searchParams.get("categoriaId") || "");
    setAlerta(searchParams.get("alerta") || "");
    const ativoParam = searchParams.get("ativo");
    setAtivo(ativoParam === null && nextAba === "produtos" ? "true" : ativoParam || "");
    const paiId = searchParams.get("produtoPaiId") || "";
    setProdutoPaiId(paiId);
    const qParam = searchParams.get("q") || "";
    setQ(qParam);
    if (!paiId) {
      setPaiBusca(qParam);
      if (!qParam) setProdutoPaiLabel("");
    }
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
    setArvoresSelecionadas(new Set());
  }, [searchParams, podeRelatoriosGerais, podeMovimentacoes]);

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
      if (next !== "movimentacoes") {
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
      setProdutoPaiLabel("");
      setPaiBusca("");
      setPaiSugestoes([]);
      setArvoresSelecionadas(new Set());
      setExplodir(false);
    }
    syncUrl(next);
  }

  const queryString = useMemo(() => {
    if (aba === "movimentacoes" || aba === "rma-produtos") return "";
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

  /** Autocomplete de produto pai (árvores). */
  useEffect(() => {
    if (aba !== "arvores") return;
    const term = paiBusca.trim();
    if (
      term.length < 2 ||
      (produtoPaiId && term === produtoPaiLabel.trim())
    ) {
      setPaiSugestoes([]);
      setPaiBuscando(false);
      return;
    }
    let cancelled = false;
    setPaiBuscando(true);
    const t = window.setTimeout(() => {
      const p = new URLSearchParams();
      p.set("q", term);
      p.set("explodir", "0");
      p.set("page", "1");
      p.set("pageSize", "12");
      void api<{ rows: ArvoreRow[] }>(`/relatorios/arvores?${p.toString()}`)
        .then((r) => {
          if (cancelled) return;
          setPaiSugestoes(
            r.rows.map((row) => ({
              produtoPaiId: row.produtoPaiId,
              codigo: row.codigo,
              descricao: row.descricao,
              qtdComponentes: row.qtdComponentes,
            }))
          );
        })
        .catch(() => {
          if (!cancelled) setPaiSugestoes([]);
        })
        .finally(() => {
          if (!cancelled) setPaiBuscando(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [aba, paiBusca, produtoPaiId, produtoPaiLabel]);

  function aplicarFiltroPai(s: ArvoreSugestao) {
    setProdutoPaiId(s.produtoPaiId);
    setProdutoPaiLabel(`${s.codigo} — ${s.descricao}`);
    setPaiBusca(`${s.codigo} — ${s.descricao}`);
    setQ("");
    setPaiOpen(false);
    setPaiSugestoes([]);
    setPage(1);
    setArvoresSelecionadas(new Set());
    const params = new URLSearchParams();
    params.set("aba", "arvores");
    params.set("produtoPaiId", s.produtoPaiId);
    params.set("explodir", explodir ? "1" : "0");
    router.replace(`/relatorios?${params.toString()}`, { scroll: false });
  }

  function aplicarBuscaTextoArvore() {
    const term = paiBusca.trim();
    setProdutoPaiId("");
    setProdutoPaiLabel("");
    setQ(term);
    setPaiOpen(false);
    setPage(1);
    setArvoresSelecionadas(new Set());
    const params = new URLSearchParams();
    params.set("aba", "arvores");
    if (term) params.set("q", term);
    params.set("explodir", explodir ? "1" : "0");
    router.replace(`/relatorios?${params.toString()}`, { scroll: false });
  }

  function limparFiltroPai() {
    setProdutoPaiId("");
    setProdutoPaiLabel("");
    setPaiBusca("");
    setQ("");
    setPaiSugestoes([]);
    setPaiOpen(false);
    setPage(1);
    setArvoresSelecionadas(new Set());
    const params = new URLSearchParams();
    params.set("aba", "arvores");
    params.set("explodir", explodir ? "1" : "0");
    router.replace(`/relatorios?${params.toString()}`, { scroll: false });
  }

  function toggleArvoreSelecionada(id: string) {
    setArvoresSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodasArvoresVisiveis() {
    setArvoresSelecionadas((prev) => {
      const ids = arvores.map((a) => a.produtoPaiId);
      const allSelected =
        ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(ids);
    });
  }

  const load = useCallback(async () => {
    if (aba === "movimentacoes" || aba === "rma-produtos") {
      setLoading(false);
      return;
    }
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
        setArvoresSelecionadas(new Set());
        if (produtoPaiId) {
          const match = r.rows.find((row) => row.produtoPaiId === produtoPaiId);
          if (match) {
            const label = `${match.codigo} — ${match.descricao}`;
            setProdutoPaiLabel(label);
            setPaiBusca(label);
          }
        }
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
  }, [aba, queryString, produtoPaiId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportar(format: "pdf" | "xlsx") {
    if (aba === "movimentacoes" || aba === "rma-produtos") return;
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
      if (aba === "arvores" && arvoresSelecionadas.size > 0) {
        exportQs.delete("q");
        exportQs.delete("produtoPaiId");
        exportQs.set(
          "produtoPaiIds",
          Array.from(arvoresSelecionadas).join(",")
        );
      }
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
  const nArvoresSel = arvoresSelecionadas.size;
  const todasArvoresVisiveisSelecionadas =
    arvores.length > 0 &&
    arvores.every((a) => arvoresSelecionadas.has(a.produtoPaiId));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Relatórios
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Consulte e exporte estoque, movimentações, produtos, RMA e árvores
            de produto (PDF / Excel).
          </p>
        </div>
        {aba !== "movimentacoes" && aba !== "rma-produtos" && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              disabled={exporting || loading}
              onClick={() => void exportar("pdf")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand/40 disabled:opacity-50"
            >
              {exporting
                ? "Gerando…"
                : nArvoresSel > 0 && aba === "arvores"
                  ? `Exportar PDF (${nArvoresSel})`
                  : "Exportar PDF"}
            </button>
            <button
              type="button"
              disabled={exporting || loading}
              onClick={() => void exportar("xlsx")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand/40 disabled:opacity-50"
            >
              {nArvoresSel > 0 && aba === "arvores"
                ? `Exportar Excel (${nArvoresSel})`
                : "Exportar Excel"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {abasDisponiveis.map((t) => {
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

      {aba === "movimentacoes" ? (
        <div className="mt-4">
          <MovimentacoesRelatorioTab />
        </div>
      ) : aba === "rma-produtos" ? (
        <RmaProdutosRelatorioTab />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        {aba === "arvores" ? (
          <div className="relative min-w-[14rem] flex-1 text-xs">
            <span className="mb-1 block font-medium text-slate-600">
              Produto pai
            </span>
            <div className="flex gap-1">
              <input
                className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
                placeholder="Digite código/descrição e escolha o pai…"
                value={paiBusca}
                onChange={(e) => {
                  setPaiBusca(e.target.value);
                  setPaiOpen(true);
                }}
                onFocus={() => setPaiOpen(true)}
                onBlur={() => setTimeout(() => setPaiOpen(false), 160)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (paiSugestoes[0]) aplicarFiltroPai(paiSugestoes[0]);
                    else aplicarBuscaTextoArvore();
                  }
                  if (e.key === "Escape") setPaiOpen(false);
                }}
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={
                  paiOpen &&
                  paiBusca.trim().length >= 2 &&
                  !(produtoPaiId && paiBusca.trim() === produtoPaiLabel.trim())
                }
              />
              {(paiBusca || produtoPaiId || q) && (
                <button
                  type="button"
                  onClick={limparFiltroPai}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-500 hover:bg-slate-50"
                  title="Limpar filtro"
                >
                  ×
                </button>
              )}
            </div>
            {produtoPaiId && produtoPaiLabel ? (
              <p className="mt-1.5 text-[11px] text-brand">
                Filtrando árvore:{" "}
                <span className="font-semibold">{produtoPaiLabel}</span>
              </p>
            ) : null}
            {paiOpen &&
              paiBusca.trim().length >= 2 &&
              !(produtoPaiId && paiBusca.trim() === produtoPaiLabel.trim()) && (
              <ul className="absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {paiBuscando ? (
                  <li className="px-3 py-2 text-sm text-slate-500">
                    Buscando…
                  </li>
                ) : paiSugestoes.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-slate-500">
                    Nenhuma árvore encontrada. Enter busca por texto.
                  </li>
                ) : (
                  paiSugestoes.map((s) => (
                    <li key={s.produtoPaiId}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          aplicarFiltroPai(s);
                        }}
                      >
                        <span className="font-mono text-xs font-semibold text-slate-800">
                          {s.codigo}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {s.descricao}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {s.qtdComponentes} componente(s)
                        </span>
                      </button>
                    </li>
                  ))
                )}
                <li className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
                  Clique na sugestão ou Enter para filtrar
                </li>
              </ul>
            )}
          </div>
        ) : (
          <label className="min-w-[10rem] flex-1 text-xs">
            <span className="mb-1 block font-medium text-slate-600">Busca</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder="Código ou descrição…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
        )}

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
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-700 sm:items-center">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-slate-300 sm:mt-0"
              checked={explodir}
              onChange={(e) => {
                setExplodir(e.target.checked);
                setPage(1);
              }}
            />
            <span>
              <span className="font-medium">Multinível</span>
              <span className="ml-1 text-slate-400">
                — lista cada KIT como card separado. Na tabela, clique em
                Subárvore para expandir
              </span>
            </span>
          </label>
        )}

        <button
          type="button"
          onClick={() => {
            if (aba === "arvores") {
              if (produtoPaiId) {
                syncUrl(aba);
                void load();
              } else {
                aplicarBuscaTextoArvore();
              }
              return;
            }
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
                <th className="px-3 py-2 text-right">Unitário</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Alerta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {saldos.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={10}
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
                    {money(r.precoUnitario)}
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
        <div className="mt-4 space-y-8">
          {arvores.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={todasArvoresVisiveisSelecionadas}
                  onChange={toggleTodasArvoresVisiveis}
                  className="rounded border-slate-300 text-brand focus:ring-brand"
                />
                <span>
                  Selecionar todas nesta página
                  {nArvoresSel > 0 ? (
                    <span className="ml-1 text-slate-400">
                      ({nArvoresSel} selecionada
                      {nArvoresSel === 1 ? "" : "s"})
                    </span>
                  ) : null}
                </span>
              </label>
              {nArvoresSel > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => void exportar("pdf")}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand/40 disabled:opacity-50"
                  >
                    {exporting ? "Gerando…" : `PDF (${nArvoresSel})`}
                  </button>
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => void exportar("xlsx")}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand/40 disabled:opacity-50"
                  >
                    Excel ({nArvoresSel})
                  </button>
                  <button
                    type="button"
                    onClick={() => setArvoresSelecionadas(new Set())}
                    className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    Limpar seleção
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Marque cards para exportar só as árvores escolhidas
                </p>
              )}
            </div>
          )}
          {arvores.length === 0 && !loading && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
              Nenhuma árvore encontrada.
            </div>
          )}
          {(["acabado", "semi", "outro"] as const).map((grupoId) => {
            const doGrupo = arvores.filter(
              (p) => (p.grupo || "acabado") === grupoId
            );
            if (doGrupo.length === 0) return null;
            return (
              <section key={grupoId} className="space-y-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold tracking-tight text-slate-800">
                    {labelGrupoArvore(grupoId)}
                  </h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                    {doGrupo.length}
                  </span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                {doGrupo.map((p) => {
                  const marcada = arvoresSelecionadas.has(p.produtoPaiId);
                  return (
                    <article
                      key={p.produtoPaiId}
                      className={`overflow-hidden rounded-xl border bg-white shadow-sm transition ${
                        marcada
                          ? "border-brand/50 ring-2 ring-brand/15"
                          : "border-slate-200"
                      }`}
                    >
                      <header className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3.5 sm:px-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="flex min-w-0 flex-1 gap-3">
                            <label className="mt-1 flex shrink-0 cursor-pointer items-start">
                              <input
                                type="checkbox"
                                checked={marcada}
                                onChange={() =>
                                  toggleArvoreSelecionada(p.produtoPaiId)
                                }
                                className="rounded border-slate-300 text-brand focus:ring-brand"
                                aria-label={`Selecionar árvore ${p.codigo}`}
                              />
                            </label>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-mono text-base font-semibold tracking-tight text-slate-900">
                                  {p.codigo}
                                </p>
                                <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
                                  {p.qtdComponentes} componente
                                  {p.qtdComponentes === 1 ? "" : "s"}
                                </span>
                              </div>
                              <p className="mt-1 text-sm leading-snug text-slate-700">
                                {p.descricao}
                              </p>
                              {p.categoriaNome ? (
                                <p className="mt-1.5 text-xs text-slate-400">
                                  {p.categoriaNome}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 sm:gap-3">
                            <div className="min-w-[5.5rem] rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-center sm:min-w-[6.5rem] sm:px-3">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                Preço pai
                              </p>
                              <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-800">
                                {money(p.precoUnitario)}
                              </p>
                            </div>
                            <div className="min-w-[5.5rem] rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-center sm:min-w-[6.5rem] sm:px-3">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                Composição
                              </p>
                              <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-800">
                                {money(p.totalComposicao)}
                              </p>
                            </div>
                            <div className="min-w-[5.5rem] rounded-lg border border-emerald-100 bg-emerald-50/50 px-2.5 py-2 text-center sm:min-w-[6.5rem] sm:px-3">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700/70">
                                Só baixa
                              </p>
                              <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-900">
                                {money(p.totalBaixa)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </header>

                      <ArvoreComponentesTabela
                        paiId={p.produtoPaiId}
                        componentes={p.componentes}
                        qtdComponentes={p.qtdComponentes}
                      />
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
        </>
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
