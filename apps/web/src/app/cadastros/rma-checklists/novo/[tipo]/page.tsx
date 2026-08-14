"use client";

import { api, getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { RmaChecklistFormEditor } from "@/components/rma/RmaChecklistFormEditor";
import {
  ChecklistTemplate,
  emptyChecklistItem,
  ItemDraft,
  parseChecklistTipo,
  ProdutoOpt,
  TIPO_HINT,
  TIPO_LABEL,
} from "@/components/rma/rmaChecklistShared";

export default function RmaChecklistNovoPage() {
  const router = useRouter();
  const params = useParams();
  const tipo = parseChecklistTipo(String(params.tipo || ""));

  const user = getStoredUser();
  const can = user ? userHas(user, "rma") : false;

  const [lista, setLista] = useState<ChecklistTemplate[]>([]);
  const [produtoId, setProdutoId] = useState("");
  const [produtoSel, setProdutoSel] = useState<ProdutoOpt | null>(null);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [sugestoes, setSugestoes] = useState<ProdutoOpt[]>([]);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [itens, setItens] = useState<ItemDraft[]>([emptyChecklistItem()]);
  const [cloneOrigemId, setCloneOrigemId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const jaExiste = useMemo(() => {
    if (!tipo || !produtoId) return null;
    return (
      lista.find((t) => t.produto.id === produtoId && t.tipo === tipo) || null
    );
  }, [lista, produtoId, tipo]);

  const produtosComMesmoTipo = useMemo(() => {
    if (!tipo) return [];
    const map = new Map<string, ProdutoOpt>();
    for (const t of lista) {
      if (t.tipo !== tipo) continue;
      if (produtoId && t.produto.id === produtoId) continue;
      map.set(t.produto.id, t.produto);
    }
    return [...map.values()];
  }, [lista, tipo, produtoId]);

  useEffect(() => {
    if (!can || !tipo) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<ChecklistTemplate[]>("/rma/checklists")
      .then((t) => {
        if (cancelled) return;
        setLista(t);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erro ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [can, tipo]);

  useEffect(() => {
    const q = buscaProduto.trim();
    if (
      produtoSel &&
      buscaProduto === `${produtoSel.codigo} — ${produtoSel.descricao}`
    ) {
      setSugestoes([]);
      setBuscando(false);
      return;
    }
    if (q.length < 2) {
      setSugestoes([]);
      setBuscando(false);
      return;
    }
    let cancelled = false;
    setBuscando(true);
    const t = window.setTimeout(() => {
      void api<ProdutoOpt[]>(`/produtos/busca?q=${encodeURIComponent(q)}`)
        .then((rows) => {
          if (cancelled) return;
          setSugestoes(rows.filter((p) => p.ativo !== false).slice(0, 12));
          setBuscaAberta(true);
        })
        .catch(() => {
          if (!cancelled) setSugestoes([]);
        })
        .finally(() => {
          if (!cancelled) setBuscando(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [buscaProduto, produtoSel]);

  function selecionarProduto(p: ProdutoOpt) {
    setProdutoId(p.id);
    setProdutoSel(p);
    setBuscaProduto(`${p.codigo} — ${p.descricao}`);
    setSugestoes([]);
    setBuscaAberta(false);
  }

  function limparProduto() {
    setProdutoId("");
    setProdutoSel(null);
    setBuscaProduto("");
    setSugestoes([]);
    setBuscaAberta(false);
  }

  async function onSalvar(e: FormEvent) {
    e.preventDefault();
    if (!can || !tipo || !produtoId) {
      setError("Escolha o produto");
      return;
    }
    if (jaExiste) {
      router.push(`/cadastros/rma-checklists/${produtoId}/${tipo}`);
      return;
    }
    const limpos = itens
      .map((it) => ({ ...it, titulo: it.titulo.trim() }))
      .filter((it) => it.titulo);
    if (limpos.length === 0) {
      setError("Inclua ao menos uma pergunta");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nomePadrao = `${TIPO_LABEL[tipo]} — ${produtoSel?.codigo || ""}`;
      await api("/rma/checklists", {
        method: "PUT",
        body: JSON.stringify({
          produtoId,
          tipo,
          nome: nomePadrao.trim(),
          ativo: true,
          itens: limpos.map((it, idx) => ({
            codigo: String(idx + 1),
            titulo: it.titulo,
            ajuda: it.ajuda.trim() || null,
            tipoCampo: it.tipoCampo,
            obrigatorio: it.obrigatorio,
            ordem: idx,
            opcoes:
              it.tipoCampo === "OPCAO"
                ? it.opcoesText
                    .split(/[,;\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                : undefined,
            exigeFotoSe: it.exigeFotoSe.trim() || null,
          })),
        }),
      });
      router.push("/cadastros/rma-checklists?ok=salvo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function onClonar() {
    if (!can || !produtoId || !cloneOrigemId || !tipo) return;
    setBusy(true);
    setError("");
    try {
      await api("/rma/checklists/clonar", {
        method: "POST",
        body: JSON.stringify({
          produtoOrigemId: cloneOrigemId,
          produtoDestinoId: produtoId,
          tipo,
        }),
      });
      router.push("/cadastros/rma-checklists?ok=copiado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao copiar");
      setBusy(false);
    }
  }

  if (!can) {
    return (
      <p className="text-sm text-slate-600">Sem permissão para checklists RMA.</p>
    );
  }

  if (!tipo) {
    return (
      <p className="text-sm text-red-700">
        Tipo inválido.{" "}
        <Link href="/cadastros/rma-checklists" className="underline">
          Voltar
        </Link>
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }

  const tituloCriar =
    tipo === "RECEBIMENTO"
      ? "Novo checklist de entrada"
      : "Novo checklist de liberação";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Checklists RMA
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {tituloCriar}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{TIPO_HINT[tipo]}</p>
        </div>
        <Link
          href="/cadastros/rma-checklists"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          ← Voltar
        </Link>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {jaExiste ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          Este produto já tem checklist de {TIPO_LABEL[tipo].toLowerCase()}.{" "}
          <Link
            href={`/cadastros/rma-checklists/${produtoId}/${tipo}`}
            className="font-medium underline"
          >
            Abrir para editar
          </Link>
        </div>
      ) : null}

      <RmaChecklistFormEditor
        tipo={tipo}
        itens={itens}
        onChangeItens={setItens}
        busy={busy}
        onSubmit={(e) => void onSalvar(e)}
        submitLabel="Criar checklist"
        produtoSlot={
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-800">
              Produto
            </label>
            <div className="relative">
              <input
                type="search"
                autoComplete="off"
                placeholder="Digite código ou descrição (mín. 2 letras)…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                value={buscaProduto}
                onChange={(e) => {
                  const v = e.target.value;
                  setBuscaProduto(v);
                  if (produtoSel) {
                    setProdutoId("");
                    setProdutoSel(null);
                  }
                  setBuscaAberta(true);
                }}
                onFocus={() => {
                  if (sugestoes.length > 0) setBuscaAberta(true);
                }}
                onBlur={() => {
                  window.setTimeout(() => setBuscaAberta(false), 150);
                }}
              />
              {buscaAberta && sugestoes.length > 0 ? (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white text-sm shadow-lg">
                  {sugestoes.map((p) => (
                    <li key={p.id} className="border-b border-slate-100 last:border-0">
                      <button
                        type="button"
                        className="block w-full px-3 py-2.5 text-left hover:bg-brand/5"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selecionarProduto(p)}
                      >
                        <span className="font-mono text-xs font-semibold text-slate-800">
                          {p.codigo}
                        </span>
                        <span className="text-slate-500"> — {p.descricao}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {buscaAberta &&
              buscaProduto.trim().length >= 2 &&
              !produtoSel &&
              !buscando &&
              sugestoes.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">
                  Nenhum produto encontrado.
                </p>
              ) : null}
              {buscando ? (
                <p className="mt-1 text-xs text-slate-400">Buscando…</p>
              ) : null}
            </div>
            {produtoSel ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-900">
                <span>
                  Selecionado:{" "}
                  <span className="font-mono font-semibold">
                    {produtoSel.codigo}
                  </span>{" "}
                  · {produtoSel.descricao}
                </span>
                <button
                  type="button"
                  className="ml-auto text-xs font-medium text-emerald-800 underline hover:no-underline"
                  onClick={limparProduto}
                >
                  Trocar
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Digite para buscar e clique no produto da lista.
              </p>
            )}
          </div>
        }
        extrasSlot={
          produtosComMesmoTipo.length > 0 && produtoId && !jaExiste ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
              <label className="min-w-[14rem] flex-1 text-xs text-slate-600">
                Atalho: copiar de outro produto
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                  value={cloneOrigemId}
                  onChange={(e) => setCloneOrigemId(e.target.value)}
                >
                  <option value="">—</option>
                  {produtosComMesmoTipo.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} — {p.descricao}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !cloneOrigemId}
                onClick={() => void onClonar()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                Copiar e salvar
              </button>
            </div>
          ) : null
        }
      />
    </>
  );
}
