"use client";

import { UnidadeEntradaSelect } from "@/components/UnidadeMedidaSelect";
import { api, apiDownload, getStoredUser } from "@/lib/api";
import { userCanEditCadastro, userCanOpenCadastro } from "@/lib/access";
import {
  converterQuantidade,
  formatQtyUnidade,
  normalizarUnidade,
  unidadeLabel,
  unidadesConvertiveis,
} from "@teep/shared";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ArvoreResumo = {
  id: string;
  codigo: string;
  descricao: string;
  precoUnitario: number;
  qtdComponentes: number;
};

type BomItem = {
  produtoFilhoId: string;
  codigo: string;
  descricao: string;
  /** Quantidade na unidade de estoque do filho (por 1 un. do pai). */
  quantidade: string;
  fantasma: boolean;
  precoUnitario?: number;
  /** Custo real explodido (recursivo). Igual a precoUnitario quando temBom=false. */
  custoExplodido?: number;
  /** true quando o filho tem BOM própria e o custo foi calculado recursivamente. */
  temBom?: boolean;
  unidadeFilho: string;
  /** Unidade usada ao digitar (converte para unidadeFilho ao salvar). */
  unidadeEntrada: string;
};

type Filial = { id: string; nome: string; sigla: string };

type Simulacao = {
  produto: {
    id: string;
    codigo: string;
    descricao: string;
    unidade: string;
    precoUnitario: number;
  };
  quantidade: number;
  filial: { id: string; nome: string; sigla: string };
  linhas: Array<{
    produtoFilhoId: string;
    codigo: string;
    descricao: string;
    unidade: string;
    fantasma: boolean;
    qtdPorUnidade: number;
    qtdNecessaria: number;
    saldoAtual: number;
    saldoDisponivel?: number;
    reservadoTransferencia?: number;
    faltante: number;
    precoUnitario: number;
    valorNecessario: number;
    valorFaltante: number;
  }>;
  totais: {
    valorComponentesNecessario: number;
    valorFaltanteComprar: number;
    itensComFalta: number;
    valorProdutoAcabado: number;
  };
};

function money(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function qty(n: number) {
  return n.toLocaleString("pt-BR", {
    maximumFractionDigits: 4,
  });
}

function qtyParaExibicao(
  qtyEstoque: string,
  unidadeEstoque: string,
  unidadeEntrada: string
): string {
  const q = Number(qtyEstoque);
  if (!Number.isFinite(q)) return qtyEstoque;
  const estoque = normalizarUnidade(unidadeEstoque);
  const entrada = normalizarUnidade(unidadeEntrada);
  if (estoque === entrada) return qtyEstoque;
  const conv = converterQuantidade(q, estoque, entrada);
  if (conv == null) return qtyEstoque;
  return String(conv);
}

function salvarQtyDaEntrada(
  rawEntrada: string,
  unidadeEstoque: string,
  unidadeEntrada: string
): string {
  if (rawEntrada.trim() === "") return rawEntrada;
  const q = Number(rawEntrada);
  if (!Number.isFinite(q)) return rawEntrada;
  const estoque = normalizarUnidade(unidadeEstoque);
  const entrada = normalizarUnidade(unidadeEntrada);
  if (estoque === entrada) return rawEntrada;
  const conv = converterQuantidade(q, entrada, estoque);
  if (conv == null) return rawEntrada;
  return String(conv);
}

export default function ArvoreProdutoPage() {
  const router = useRouter();
  const [lista, setLista] = useState<ArvoreResumo[]>([]);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [buscaLista, setBuscaLista] = useState("");
  const [paiId, setPaiId] = useState<string | null>(null);
  const [paiLabel, setPaiLabel] = useState("");
  const [paiPreco, setPaiPreco] = useState(0);
  const [paiUnidade, setPaiUnidade] = useState("UN");
  const [itens, setItens] = useState<BomItem[]>([]);
  const [itensSalvosJson, setItensSalvosJson] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  /** false = só visualização; true = pode qtd / incluir / remover */
  const [editando, setEditando] = useState(false);

  const [novoPaiBusca, setNovoPaiBusca] = useState("");
  const [novoPaiSugestoes, setNovoPaiSugestoes] = useState<
    Array<{ id: string; codigo: string; descricao: string }>
  >([]);

  const [compBusca, setCompBusca] = useState("");
  const [compSugestoes, setCompSugestoes] = useState<
    Array<{
      id: string;
      codigo: string;
      descricao: string;
      unidade?: string;
      precoUnitario?: number;
    }>
  >([]);

  const [paiIdOriginal, setPaiIdOriginal] = useState<string | null>(null);
  const [trocandoPai, setTrocandoPai] = useState(false);
  const [trocaPaiBusca, setTrocaPaiBusca] = useState("");
  const [trocaPaiSugestoes, setTrocaPaiSugestoes] = useState<
    Array<{ id: string; codigo: string; descricao: string; unidade?: string; precoUnitario?: number }>
  >([]);

  const [showSim, setShowSim] = useState(false);
  const [simQtd, setSimQtd] = useState("1");
  const [simFilialId, setSimFilialId] = useState("");
  const [sim, setSim] = useState<Simulacao | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simExporting, setSimExporting] = useState(false);
  const canEdit = (() => {
    const u = getStoredUser();
    return u ? userCanEditCadastro(u, "arvore") : false;
  })();
  const isAdmin = getStoredUser()?.perfil === "ADMIN";

  useEffect(() => {
    const u = getStoredUser();
    if (!u || !userCanOpenCadastro(u, "arvore")) {
      router.replace("/sem-acesso");
    }
  }, [router]);

  const loadLista = useCallback(async (q = "") => {
    const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    setLista(await api<ArvoreResumo[]>(`/produtos/arvores${qs}`));
  }, []);

  useEffect(() => {
    loadLista().catch((e) =>
      setError(e instanceof Error ? e.message : "Erro ao carregar")
    );
    api<Filial[]>("/filiais")
      .then((f) => {
        setFiliais(f);
        if (f[0]) setSimFilialId(f[0].id);
      })
      .catch(() => setFiliais([]));
  }, [loadLista]);

  async function abrirArvore(
    id: string,
    opts?: { editar?: boolean }
  ) {
    setError("");
    setMsg("");
    setSim(null);
    setShowSim(false);
    setCompBusca("");
    setCompSugestoes([]);
    const r = await api<{
      produtoId: string;
      codigo: string;
      descricao: string;
      unidade?: string;
      precoUnitario?: number;
      itens: Array<{
        produtoFilhoId: string;
        quantidade: number;
        fantasma: boolean;
        temBom?: boolean;
        custoExplodido?: number;
        produtoFilho: {
          codigo: string;
          descricao: string;
          unidade?: string;
          precoUnitario?: number;
        };
      }>;
    }>(`/produtos/${id}/componentes`);
    setPaiId(r.produtoId);
    setPaiIdOriginal(r.produtoId);
    setPaiLabel(`${r.codigo} — ${r.descricao}`);
    setPaiPreco(Number(r.precoUnitario) || 0);
    setPaiUnidade(normalizarUnidade(r.unidade || "UN"));
    const mapped = (r.itens || []).map((i) => {
      const unidadeFilho = normalizarUnidade(i.produtoFilho.unidade || "UN");
      return {
        produtoFilhoId: i.produtoFilhoId,
        codigo: i.produtoFilho.codigo,
        descricao: i.produtoFilho.descricao,
        quantidade: String(i.quantidade),
        fantasma: i.fantasma,
        precoUnitario: Number(i.produtoFilho.precoUnitario) || 0,
        custoExplodido: i.custoExplodido ?? Number(i.produtoFilho.precoUnitario) ?? 0,
        temBom: i.temBom ?? false,
        unidadeFilho,
        unidadeEntrada: unidadeFilho,
      };
    });
    setItens(mapped);
    setItensSalvosJson(
      JSON.stringify(
        mapped.map((i) => ({
          produtoFilhoId: i.produtoFilhoId,
          quantidade: i.quantidade,
          fantasma: i.fantasma,
        }))
      )
    );
    // Lista/cancelar = visualização; nova árvore = edição
    setEditando(opts?.editar === true);
  }

  function snapshotItens(list: BomItem[]) {
    return JSON.stringify(
      list.map((i) => ({
        produtoFilhoId: i.produtoFilhoId,
        quantidade: i.quantidade,
        fantasma: i.fantasma,
      }))
    );
  }

  const rascunhoSujo =
    Boolean(paiId) && snapshotItens(itens) !== itensSalvosJson;

  const custos = useMemo(() => {
    let total = 0;
    let totalBaixa = 0;
    const linhas = itens.map((b) => {
      const q = Number(b.quantidade);
      const preco = b.custoExplodido ?? Number(b.precoUnitario) ?? 0;
      const valorLinha =
        Number.isFinite(q) && q > 0 ? q * preco : 0;
      if (valorLinha > 0) {
        total += valorLinha;
        if (!b.fantasma) totalBaixa += valorLinha;
      }
      return { ...b, preco, valorLinha };
    });
    return {
      linhas,
      total,
      totalBaixa,
      diferencaCadastro: paiPreco - total,
    };
  }, [itens, paiPreco]);

  function novaArvore() {
    if (editando && rascunhoSujo && !confirm("Descartar alterações não salvas?")) {
      return;
    }
    setPaiId(null);
    setPaiIdOriginal(null);
    setPaiLabel("");
    setPaiPreco(0);
    setPaiUnidade("UN");
    setItens([]);
    setItensSalvosJson("");
    setNovoPaiBusca("");
    setNovoPaiSugestoes([]);
    setMsg("");
    setError("");
    setSim(null);
    setShowSim(false);
    setEditando(true);
    setCompBusca("");
    setCompSugestoes([]);
  }

  async function cancelarEdicao() {
    if (!paiId) {
      setEditando(false);
      setNovoPaiBusca("");
      setNovoPaiSugestoes([]);
      setError("");
      setMsg("");
      return;
    }
    if (rascunhoSujo && !confirm("Descartar alterações não salvas?")) {
      return;
    }
    try {
      await abrirArvore(paiId, { editar: false });
      setMsg("");
      setError("");
      setTrocandoPai(false);
      setTrocaPaiBusca("");
      setTrocaPaiSugestoes([]);
      setPaiIdOriginal(paiId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao recarregar");
    }
  }

  async function onExcluirArvore() {
    if (!isAdmin || !paiId || itens.length === 0) return;
    if (
      !confirm(
        `Excluir a árvore completa de «${paiLabel}»?\n\nIsso remove os ${itens.length} componente(s). O produto pai permanece cadastrado.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    setMsg("");
    try {
      await api(`/produtos/${paiId}/componentes`, { method: "DELETE" });
      setMsg("Árvore excluída — todos os componentes foram removidos");
      setPaiId("");
      setPaiIdOriginal("");
      setPaiLabel("");
      setPaiPreco(0);
      setItens([]);
      setItensSalvosJson("[]");
      setEditando(false);
      setTrocandoPai(false);
      setSim(null);
      setShowSim(false);
      await loadLista(buscaLista);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir árvore");
    } finally {
      setSaving(false);
    }
  }

  async function onSalvar(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) {
      setError("Sem permissão para editar cadastros");
      return;
    }
    if (!paiId) {
      setError("Selecione o produto pai");
      return;
    }
    setSaving(true);
    setError("");
    setMsg("");
    try {
      for (const it of itens) {
        const n = Number(it.quantidade);
        if (!(n > 0)) {
          setError(`Quantidade inválida para ${it.codigo}`);
          return;
        }
      }
      if (paiIdOriginal && paiIdOriginal !== paiId) {
        await api(`/produtos/${paiIdOriginal}/componentes`, {
          method: "PUT",
          body: JSON.stringify({ itens: [] }),
        });
      }
      await api(`/produtos/${paiId}/componentes`, {
        method: "PUT",
        body: JSON.stringify({
          itens: itens.map((i) => ({
            produtoFilhoId: i.produtoFilhoId,
            quantidade: Number(i.quantidade),
            fantasma: i.fantasma,
          })),
        }),
      });
      setMsg(
        itens.length
          ? "Árvore salva com sucesso"
          : "Árvore removida (sem componentes)"
      );
      setItensSalvosJson(snapshotItens(itens));
      setPaiIdOriginal(paiId);
      setEditando(false);
      setTrocandoPai(false);
      setTrocaPaiBusca("");
      setTrocaPaiSugestoes([]);
      await loadLista(buscaLista);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function rodarSimulacao() {
    if (!paiId) return;
    if (rascunhoSujo) {
      setError(
        "Há alterações não salvas na árvore. Salve antes de simular — a simulação usa a árvore gravada."
      );
      return;
    }
    if (itens.length === 0) {
      setError("Salve ao menos um componente na árvore para simular");
      return;
    }
    const q = Number(simQtd);
    if (!(q > 0)) {
      setError("Informe a quantidade a produzir");
      return;
    }
    if (!simFilialId) {
      setError("Selecione o estoque para a simulação");
      return;
    }
    setSimLoading(true);
    setError("");
    try {
      const r = await api<Simulacao>(
        `/produtos/${paiId}/arvore/simulacao?quantidade=${q}&filialId=${simFilialId}`
      );
      setSim(r);
    } catch (err) {
      setSim(null);
      setError(err instanceof Error ? err.message : "Erro na simulação");
    } finally {
      setSimLoading(false);
    }
  }

  async function exportarSimulacao(format: "pdf" | "xlsx") {
    if (!paiId || !sim) return;
    const q = Number(simQtd);
    if (!(q > 0) || !simFilialId) {
      setError("Calcule a necessidade antes de exportar");
      return;
    }
    setSimExporting(true);
    setError("");
    try {
      const path = `/produtos/${paiId}/arvore/simulacao/export.${format}?quantidade=${encodeURIComponent(String(q))}&filialId=${encodeURIComponent(simFilialId)}`;
      const { blob, filename } = await apiDownload(path, {
        fallbackFilename: `teep-simulacao.${format}`,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao exportar");
    } finally {
      setSimExporting(false);
    }
  }

  const colGrid =
    "grid grid-cols-[minmax(0,1fr)_minmax(5.5rem,6.5rem)_6.5rem_6.5rem_5.5rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(6rem,7.5rem)_7rem_7rem_6rem_4.5rem]";

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Árvore de produto
        </h1>
        {canEdit && (
          <button
            type="button"
            onClick={novaArvore}
            className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            Nova árvore
          </button>
        )}
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        {/* Lista */}
        <aside className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-3">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder="Filtrar árvores…"
              value={buscaLista}
              onChange={(e) => {
                const v = e.target.value;
                setBuscaLista(v);
                void loadLista(v).catch(() => undefined);
              }}
            />
          </div>
          <ul className="max-h-[min(36rem,70vh)] divide-y divide-slate-100 overflow-y-auto text-sm">
            {lista.length === 0 && (
              <li className="px-3 py-8 text-center text-slate-500">
                Nenhuma árvore cadastrada.
              </li>
            )}
            {lista.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (editando) return;
                    void abrirArvore(a.id, { editar: false }).catch((e) =>
                      setError(e.message)
                    );
                  }}
                  className={`block w-full px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${
                    paiId === a.id
                      ? "border-l-2 border-brand bg-brand/5 font-medium text-brand"
                      : "border-l-2 border-transparent"
                  }`}
                >
                  <div className="truncate">{a.codigo}</div>
                  <div className="truncate text-xs font-normal text-slate-500">
                    {a.descricao}
                  </div>
                  <div className="mt-0.5 text-[11px] font-normal text-slate-400">
                    {a.qtdComponentes} componente(s)
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Editor */}
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          {!paiId ? (
            editando ? (
              <div className="mx-auto max-w-lg space-y-3 py-4">
                <p className="text-base font-semibold text-slate-900">
                  Nova árvore
                </p>
                <p className="text-sm text-slate-500">
                  Busque o produto pai. Em seguida monte os componentes com
                  quantidade e marque Fantasma quando o item não baixar estoque.
                </p>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
                  placeholder="Buscar produto pai (código ou descrição)"
                  value={novoPaiBusca}
                  onChange={(e) => {
                    const q = e.target.value;
                    setNovoPaiBusca(q);
                    if (q.trim().length < 2) {
                      setNovoPaiSugestoes([]);
                      return;
                    }
                    void api<
                      Array<{ id: string; codigo: string; descricao: string }>
                    >(`/produtos/busca?q=${encodeURIComponent(q.trim())}`)
                      .then((rows) => setNovoPaiSugestoes(rows.slice(0, 10)))
                      .catch(() => setNovoPaiSugestoes([]));
                  }}
                />
                {novoPaiSugestoes.length > 0 && (
                  <ul className="max-h-56 overflow-auto rounded-lg border border-slate-200 text-sm">
                    {novoPaiSugestoes.map((s) => (
                      <li
                        key={s.id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <button
                          type="button"
                          className="block w-full px-3 py-2.5 text-left hover:bg-brand/5"
                          onClick={() =>
                            void abrirArvore(s.id, { editar: true }).catch(
                              (e) => setError(e.message)
                            )
                          }
                        >
                          <span className="font-medium">{s.codigo}</span>
                          <span className="text-slate-500">
                            {" "}
                            — {s.descricao}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditando(false);
                      setNovoPaiBusca("");
                      setNovoPaiSugestoes([]);
                      setError("");
                    }}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[16rem] flex-col items-center justify-center px-4 py-10 text-center">
                <p className="text-sm font-medium text-slate-800">
                  Selecione uma árvore
                </p>
                <p className="mt-1 max-w-sm text-sm text-slate-500">
                  Escolha um item na lista ao lado
                  {canEdit ? (
                    <>
                      {" "}
                      ou clique em{" "}
                      <strong className="font-medium text-slate-700">
                        Nova árvore
                      </strong>{" "}
                      para criar.
                    </>
                  ) : (
                    "."
                  )}
                </p>
              </div>
            )
          ) : (
            <form onSubmit={onSalvar} className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Produto pai
                  </p>
                  {editando && trocandoPai ? (
                    <div className="mt-1 space-y-1">
                      <input
                        autoFocus
                        className="w-full rounded-lg border border-brand px-3 py-1.5 text-sm outline-none"
                        placeholder="Buscar novo produto pai…"
                        value={trocaPaiBusca}
                        onChange={(e) => {
                          const q = e.target.value;
                          setTrocaPaiBusca(q);
                          if (q.trim().length < 2) {
                            setTrocaPaiSugestoes([]);
                            return;
                          }
                          void api<Array<{ id: string; codigo: string; descricao: string; unidade?: string; precoUnitario?: number }>>(
                            `/produtos/busca?q=${encodeURIComponent(q.trim())}`
                          )
                            .then((rows) =>
                              setTrocaPaiSugestoes(rows.filter((r) => r.id !== paiId).slice(0, 10))
                            )
                            .catch(() => setTrocaPaiSugestoes([]));
                        }}
                      />
                      {trocaPaiSugestoes.length > 0 && (
                        <ul className="max-h-48 overflow-auto rounded-lg border border-slate-200 text-sm">
                          {trocaPaiSugestoes.map((s) => (
                            <li key={s.id} className="border-b border-slate-100 last:border-0">
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left hover:bg-brand/5"
                                onClick={() => {
                                  setPaiId(s.id);
                                  setPaiLabel(`${s.codigo} — ${s.descricao}`);
                                  setPaiPreco(Number(s.precoUnitario) || 0);
                                  setPaiUnidade(normalizarUnidade(s.unidade || "UN"));
                                  // Marca rascunho sujo sem apagar os itens filhos
                                  setItensSalvosJson("");
                                  setTrocandoPai(false);
                                  setTrocaPaiBusca("");
                                  setTrocaPaiSugestoes([]);
                                  setSim(null);
                                  setShowSim(false);
                                  setError("");
                                  setMsg("");
                                }}
                              >
                                <span className="font-medium">{s.codigo}</span>
                                <span className="text-slate-500"> — {s.descricao}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:text-slate-700"
                        onClick={() => {
                          setTrocandoPai(false);
                          setTrocaPaiBusca("");
                          setTrocaPaiSugestoes([]);
                        }}
                      >
                        Cancelar troca
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="mt-0.5 truncate text-base font-semibold text-slate-900">
                        {paiLabel}
                        {editando && (
                          <button
                            type="button"
                            className="ml-2 text-xs font-normal text-brand hover:underline"
                            onClick={() => {
                              setTrocandoPai(true);
                              setTrocaPaiBusca("");
                              setTrocaPaiSugestoes([]);
                            }}
                          >
                            trocar
                          </button>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Unidade do pai:{" "}
                        <span className="font-mono font-medium text-slate-700">
                          {paiUnidade}
                        </span>{" "}
                        ({unidadeLabel(paiUnidade)})
                      </p>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {canEdit &&
                    (!editando ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditando(true);
                          setMsg("");
                          setError("");
                        }}
                        className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
                      >
                        Editar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void cancelarEdicao()}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                      >
                        Cancelar edição
                      </button>
                    ))}
                  {isAdmin && itens.length > 0 && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onExcluirArvore()}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                      title="Remove todos os componentes desta BOM (somente Admin)"
                    >
                      Excluir árvore
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowSim((v) => !v);
                      setSim(null);
                    }}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-950"
                  >
                    {showSim ? "Fechar simulação" : "Simular produção"}
                  </button>
                </div>
              </div>

              {editando && (
                <p className="rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-xs text-brand">
                  Modo edição: altere quantidades, inclua ou remova componentes e
                  salve.
                </p>
              )}

              {/* —— BOM (fonte da verdade) —— */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">
                    Componentes
                    {itens.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {itens.length}
                      </span>
                    )}
                  </p>
                  {!editando && (
                    <p className="text-xs text-slate-500">
                      Clique em{" "}
                      <strong className="font-medium text-slate-700">
                        Editar
                      </strong>{" "}
                      para alterar.
                    </p>
                  )}
                </div>

                {editando && (
                  <div>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
                      placeholder="Buscar e adicionar componente…"
                      value={compBusca}
                      onChange={(e) => {
                        const q = e.target.value;
                        setCompBusca(q);
                        if (q.trim().length < 2) {
                          setCompSugestoes([]);
                          return;
                        }
                        void api<
                          Array<{
                            id: string;
                            codigo: string;
                            descricao: string;
                            unidade?: string;
                            precoUnitario?: number;
                          }>
                        >(`/produtos/busca?q=${encodeURIComponent(q.trim())}`)
                          .then((rows) =>
                            setCompSugestoes(
                              rows.filter((r) => r.id !== paiId).slice(0, 8)
                            )
                          )
                          .catch(() => setCompSugestoes([]));
                      }}
                    />
                    {compSugestoes.length > 0 && (
                      <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 text-sm">
                        {compSugestoes.map((s) => (
                          <li
                            key={s.id}
                            className="border-b border-slate-100 last:border-0"
                          >
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-brand/5"
                              onClick={() => {
                                if (
                                  itens.some((b) => b.produtoFilhoId === s.id)
                                ) {
                                  setError("Componente já está na árvore");
                                  return;
                                }
                                setItens([
                                  ...itens,
                                  {
                                    produtoFilhoId: s.id,
                                    codigo: s.codigo,
                                    descricao: s.descricao,
                                    quantidade: "1",
                                    fantasma: false,
                                    precoUnitario:
                                      Number(s.precoUnitario) || 0,
                                    unidadeFilho: normalizarUnidade(
                                      s.unidade || "UN"
                                    ),
                                    unidadeEntrada: normalizarUnidade(
                                      s.unidade || "UN"
                                    ),
                                  },
                                ]);
                                setCompBusca("");
                                setCompSugestoes([]);
                                setError("");
                              }}
                            >
                              <span>
                                <span className="font-medium">{s.codigo}</span>
                                <span className="text-slate-500">
                                  {" "}
                                  — {s.descricao}
                                </span>
                                <span className="ml-1 font-mono text-[10px] text-slate-400">
                                  {normalizarUnidade(s.unidade || "UN")}
                                </span>
                              </span>
                              <span className="shrink-0 tabular-nums text-xs text-slate-400">
                                {money(Number(s.precoUnitario) || 0)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {itens.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  {editando
                    ? "Nenhum componente. Busque acima para adicionar, ou salve vazio para remover a árvore."
                    : "Nenhum componente nesta árvore. Clique em Editar para montar."}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <div
                    className={`${colGrid} border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-slate-400`}
                  >
                    <div>Item</div>
                    <div className="text-right">Qtd / un.</div>
                    <div className="text-right">Preço / {paiUnidade || "un."}</div>
                    <div className="text-right">Valor</div>
                    <div className="text-center">Fantasma</div>
                    <div className="hidden text-right sm:block" />
                  </div>
                  <div className="divide-y divide-slate-100">
                    {custos.linhas.map((b, idx) => (
                      <div
                        key={b.produtoFilhoId}
                        className={`${colGrid} px-3 py-2.5 text-sm`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">
                            {b.codigo}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {b.descricao}
                            <span className="ml-1 font-mono text-[10px] text-slate-400">
                              est. {b.unidadeFilho}
                            </span>
                          </div>
                          {!unidadesConvertiveis(paiUnidade, b.unidadeFilho) &&
                          !b.fantasma ? (
                            <p className="mt-0.5 text-[10px] font-medium text-amber-800">
                              Unidade diferente do pai — marque fantasma se não
                              baixar estoque
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          {editando ? (
                            <div className="ml-auto flex max-w-[7.5rem] flex-col items-end gap-1">
                              <input
                                type="number"
                                min="0.0001"
                                step="any"
                                required
                                aria-label={`Quantidade ${b.codigo}`}
                                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand"
                                value={qtyParaExibicao(
                                  b.quantidade,
                                  b.unidadeFilho,
                                  b.unidadeEntrada
                                )}
                                onChange={(e) => {
                                  const next = [...itens];
                                  next[idx] = {
                                    ...itens[idx],
                                    quantidade: salvarQtyDaEntrada(
                                      e.target.value,
                                      b.unidadeFilho,
                                      b.unidadeEntrada
                                    ),
                                  };
                                  setItens(next);
                                }}
                              />
                              <div className="flex items-center gap-1 text-[10px] text-slate-500">
                                <span>/ 1 {paiUnidade}</span>
                                <UnidadeEntradaSelect
                                  unidadeEstoque={b.unidadeFilho}
                                  value={b.unidadeEntrada}
                                  onChange={(unidadeEntrada) => {
                                    const next = [...itens];
                                    next[idx] = {
                                      ...itens[idx],
                                      unidadeEntrada,
                                    };
                                    setItens(next);
                                  }}
                                />
                              </div>
                              {b.unidadeEntrada !== b.unidadeFilho ? (
                                <span className="text-[10px] text-teal-800">
                                  = {formatQtyUnidade(
                                    Number(b.quantidade) || 0,
                                    b.unidadeFilho
                                  )}{" "}
                                  em estoque
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="tabular-nums font-medium text-slate-800">
                              {formatQtyUnidade(
                                Number(b.quantidade) || 0,
                                b.unidadeFilho
                              )}
                              <span className="block text-[10px] font-normal text-slate-400">
                                / 1 {paiUnidade}
                              </span>
                            </span>
                          )}
                        </div>
                        <div className="text-right tabular-nums text-slate-600">
                          {money(b.preco)}
                          <span className="block text-[10px] font-normal text-slate-400">
                            / {b.unidadeFilho}
                          </span>
                          {b.temBom && (
                            <span className="block text-[10px] font-medium text-teal-700">
                              via BOM
                            </span>
                          )}
                        </div>
                        <div className="text-right tabular-nums font-semibold text-slate-900">
                          {money(b.valorLinha)}
                        </div>
                        <div className="flex justify-center">
                          {editando ? (
                            <input
                              type="checkbox"
                              checked={b.fantasma}
                              title="Não movimenta estoque na baixa pela árvore"
                              aria-label={`Fantasma ${b.codigo}`}
                              className="h-4 w-4 rounded border-slate-300"
                              onChange={(e) => {
                                const next = [...itens];
                                next[idx] = {
                                  ...itens[idx],
                                  fantasma: e.target.checked,
                                };
                                setItens(next);
                              }}
                            />
                          ) : b.fantasma ? (
                            <span
                              className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
                              title="Não movimenta estoque na baixa pela árvore"
                            >
                              Sim
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </div>
                        <div className="hidden text-right sm:block">
                          {editando ? (
                            <button
                              type="button"
                              className="text-xs font-medium text-rose-700 hover:underline"
                              onClick={() =>
                                setItens(itens.filter((_, i) => i !== idx))
                              }
                            >
                              Remover
                            </button>
                          ) : null}
                        </div>
                        {editando && (
                          <div className="col-span-full flex justify-end sm:hidden">
                            <button
                              type="button"
                              className="text-xs font-medium text-rose-700"
                              onClick={() =>
                                setItens(itens.filter((_, i) => i !== idx))
                              }
                            >
                              Remover
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-3 py-3 text-sm">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">
                        Custo da composição (1 {paiUnidade} do pai)
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="text-base font-semibold tabular-nums text-slate-900">
                          {money(custos.total)}
                        </span>
                        {Math.abs(custos.total - custos.totalBaixa) > 0.005 && (
                          <span className="text-xs text-slate-500">
                            · {money(custos.totalBaixa)} só o que baixa estoque
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">
                        Preço no cadastro
                      </div>
                      <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
                        {money(paiPreco)}
                      </div>
                      <div
                        className={`mt-0.5 text-[11px] ${
                          Math.abs(custos.diferencaCadastro) < 0.005
                            ? "text-emerald-700"
                            : custos.diferencaCadastro < 0
                              ? "text-rose-700"
                              : "text-amber-800"
                        }`}
                      >
                        {Math.abs(custos.diferencaCadastro) < 0.005
                          ? "Igual à composição"
                          : custos.diferencaCadastro < 0
                            ? `Composição ${money(Math.abs(custos.diferencaCadastro))} acima`
                            : `Cadastro ${money(custos.diferencaCadastro)} acima`}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* —— Simulação: só saldo / necessidade (não repete BOM) —— */}
              {showSim && (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <div>
                    <p className="text-sm font-medium text-amber-950">
                      Simular produção
                    </p>
                    <p className="mt-0.5 text-xs text-amber-900/80">
                      Confere se o estoque escolhido cobre a árvore para a
                      quantidade pedida. Preços e composição estão na tabela
                      acima.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="block text-sm">
                      <span className="mb-1 block text-xs font-medium">
                        Qtd. do item pai ({paiUnidade})
                      </span>
                      <input
                        type="number"
                        min="0.0001"
                        step="any"
                        className="w-full rounded-lg border px-3 py-2"
                        value={simQtd}
                        onChange={(e) => setSimQtd(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                      <span className="mb-1 block text-xs font-medium">
                        Estoque (saldo)
                      </span>
                      <select
                        className="w-full rounded-lg border px-3 py-2"
                        value={simFilialId}
                        onChange={(e) => setSimFilialId(e.target.value)}
                      >
                        {filiais.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.sigla} — {f.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={simLoading || itens.length === 0 || rascunhoSujo}
                      onClick={() => void rodarSimulacao()}
                      className="rounded-lg bg-amber-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {simLoading ? "Calculando…" : "Calcular necessidade"}
                    </button>
                    {sim && (
                      <>
                        <button
                          type="button"
                          disabled={simExporting}
                          onClick={() => void exportarSimulacao("pdf")}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand/40 disabled:opacity-50"
                        >
                          {simExporting ? "Gerando…" : "PDF"}
                        </button>
                        <button
                          type="button"
                          disabled={simExporting}
                          onClick={() => void exportarSimulacao("xlsx")}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand/40 disabled:opacity-50"
                        >
                          Excel
                        </button>
                      </>
                    )}
                  </div>
                  {rascunhoSujo && (
                    <p className="text-xs text-amber-900">
                      Salve a árvore antes de simular (há alterações no
                      rascunho).
                    </p>
                  )}
                  {!rascunhoSujo && itens.length === 0 && (
                    <p className="text-xs text-amber-900">
                      Inclua e salve ao menos um componente para simular.
                    </p>
                  )}

                  {sim && (
                    <div className="space-y-3 rounded-lg border border-amber-100 bg-white p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm text-slate-800">
                          Para{" "}
                          <strong className="tabular-nums">
                            {qty(sim.quantidade)}
                          </strong>{" "}
                          un. no estoque{" "}
                          <strong>{sim.filial.sigla}</strong>
                          {sim.totais.itensComFalta === 0 ? (
                            <span className="text-emerald-700">
                              {" "}
                              — saldo suficiente
                            </span>
                          ) : (
                            <span className="text-rose-700">
                              {" "}
                              — falta{" "}
                              {money(sim.totais.valorFaltanteComprar)} (
                              {sim.totais.itensComFalta} item
                              {sim.totais.itensComFalta === 1 ? "" : "s"})
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          Custo teórico da rodada:{" "}
                          <span className="font-medium tabular-nums text-slate-700">
                            {money(sim.totais.valorComponentesNecessario)}
                          </span>
                          <span className="text-slate-400">
                            {" "}
                            (= composição × qtd)
                          </span>
                        </p>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="min-w-full text-xs">
                          <thead className="bg-slate-50 text-left">
                            <tr>
                              <th className="px-2 py-1.5">Componente</th>
                              <th className="px-2 py-1.5 text-right">Precisa</th>
                              <th className="px-2 py-1.5 text-right">Tem</th>
                              <th className="px-2 py-1.5 text-right">Falta</th>
                              <th className="px-2 py-1.5 text-right">
                                $ da falta
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sim.linhas
                              .filter((l) => !l.fantasma)
                              .map((l) => (
                                <tr
                                  key={l.produtoFilhoId}
                                  className="border-t"
                                >
                                  <td className="px-2 py-1.5">
                                    <div className="font-medium">{l.codigo}</div>
                                    <div className="text-slate-500">
                                      {l.descricao}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">
                                    {formatQtyUnidade(l.qtdNecessaria, l.unidade)}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">
                                    {formatQtyUnidade(
                                      l.saldoDisponivel ?? l.saldoAtual,
                                      l.unidade
                                    )}
                                    {(l.reservadoTransferencia || 0) > 0 && (
                                      <div className="text-[10px] text-slate-400">
                                        bruto{" "}
                                        {formatQtyUnidade(l.saldoAtual, l.unidade)}{" "}
                                        · reserv.{" "}
                                        {formatQtyUnidade(
                                          l.reservadoTransferencia || 0,
                                          l.unidade
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  <td
                                    className={`px-2 py-1.5 text-right tabular-nums font-medium ${
                                      l.faltante > 0
                                        ? "text-rose-700"
                                        : "text-slate-600"
                                    }`}
                                  >
                                    {formatQtyUnidade(l.faltante, l.unidade)}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">
                                    {l.faltante > 0
                                      ? money(l.valorFaltante)
                                      : "—"}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      {sim.linhas.some((l) => l.fantasma) && (
                        <p className="text-[11px] text-slate-500">
                          Fantasmas omitidos na simulação (não baixam estoque).
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {(error || msg || (editando && rascunhoSujo)) && (
                <div className="space-y-1">
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  {msg && <p className="text-sm text-emerald-700">{msg}</p>}
                  {editando && rascunhoSujo && !error && (
                    <p className="text-xs text-amber-800">
                      Alterações não salvas.
                    </p>
                  )}
                </div>
              )}

              {editando && (
                <div className="flex justify-end border-t border-slate-100 pt-4">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {saving ? "Salvando…" : "Salvar árvore"}
                  </button>
                </div>
              )}
            </form>
          )}

          {!paiId && error && (
            <p className="mt-3 text-center text-sm text-red-600">{error}</p>
          )}
        </section>
      </div>
    </>
  );
}
