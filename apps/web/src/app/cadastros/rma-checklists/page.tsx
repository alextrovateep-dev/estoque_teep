"use client";

import { api, getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Produto = { id: string; codigo: string; descricao: string; ativo?: boolean };

type ItemDraft = {
  titulo: string;
  tipoCampo: "SIM_NAO" | "TEXTO" | "OPCAO" | "FOTO";
  obrigatorio: boolean;
  opcoesText: string;
  ajuda: string;
  exigeFotoSe: string;
};

type Template = {
  id: string;
  tipo: "RECEBIMENTO" | "LIBERACAO" | string;
  nome: string;
  ativo: boolean;
  versao: number;
  produto: Produto;
  itens: Array<{
    codigo: string;
    titulo: string;
    ajuda?: string | null;
    tipoCampo: string;
    obrigatorio: boolean;
    ordem: number;
    opcoesJson?: string[] | null;
    exigeFotoSe?: string | null;
  }>;
};

const TIPO_LABEL: Record<string, string> = {
  RECEBIMENTO: "Recebimento",
  LIBERACAO: "Liberação",
};

const TIPO_HINT: Record<string, string> = {
  RECEBIMENTO: "Na entrada do equipamento no RMA",
  LIBERACAO: "Antes de devolver ou trocar",
};

function emptyItem(): ItemDraft {
  return {
    titulo: "",
    tipoCampo: "SIM_NAO",
    obrigatorio: true,
    opcoesText: "",
    ajuda: "",
    exigeFotoSe: "",
  };
}

function fromTemplate(t: Template): ItemDraft[] {
  return t.itens
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((it) => ({
      titulo: it.titulo,
      tipoCampo: (it.tipoCampo as ItemDraft["tipoCampo"]) || "SIM_NAO",
      obrigatorio: it.obrigatorio !== false,
      opcoesText: Array.isArray(it.opcoesJson) ? it.opcoesJson.join(", ") : "",
      ajuda: it.ajuda || "",
      exigeFotoSe: it.exigeFotoSe || "",
    }));
}

export default function RmaChecklistsPage() {
  const user = getStoredUser();
  const can = user ? userHas(user, "rma") : false;

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [lista, setLista] = useState<Template[]>([]);
  const [produtoQ, setProdutoQ] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const [editTipo, setEditTipo] = useState<"RECEBIMENTO" | "LIBERACAO" | null>(
    null
  );
  const [itens, setItens] = useState<ItemDraft[]>([emptyItem()]);
  const [showAvancado, setShowAvancado] = useState(false);
  const [cloneOrigemId, setCloneOrigemId] = useState("");

  async function load() {
    try {
      const [t, p] = await Promise.all([
        api<Template[]>("/rma/checklists"),
        api<Produto[]>("/produtos"),
      ]);
      setLista(t);
      setProdutos(p.filter((x) => x.ativo !== false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const produtoSel = useMemo(
    () => produtos.find((p) => p.id === produtoId) || null,
    [produtos, produtoId]
  );

  const produtosFiltrados = useMemo(() => {
    const q = produtoQ.trim().toLowerCase();
    if (!q) return produtos.slice(0, 40);
    return produtos
      .filter(
        (p) =>
          p.codigo.toLowerCase().includes(q) ||
          p.descricao.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [produtos, produtoQ]);

  const tmplReceb = useMemo(
    () =>
      lista.find(
        (t) => t.produto.id === produtoId && t.tipo === "RECEBIMENTO"
      ) || null,
    [lista, produtoId]
  );
  const tmplLib = useMemo(
    () =>
      lista.find((t) => t.produto.id === produtoId && t.tipo === "LIBERACAO") ||
      null,
    [lista, produtoId]
  );

  const produtosComMesmoTipo = useMemo(() => {
    if (!editTipo) return [];
    const ids = new Set(
      lista.filter((t) => t.tipo === editTipo).map((t) => t.produto.id)
    );
    return produtos.filter((p) => ids.has(p.id) && p.id !== produtoId);
  }, [lista, produtos, editTipo, produtoId]);

  function abrirEdicao(tipo: "RECEBIMENTO" | "LIBERACAO") {
    setError("");
    setOk("");
    setEditTipo(tipo);
    setShowAvancado(false);
    const t = tipo === "RECEBIMENTO" ? tmplReceb : tmplLib;
    setItens(t && t.itens.length ? fromTemplate(t) : [emptyItem()]);
  }

  function cancelarEdicao() {
    setEditTipo(null);
    setItens([emptyItem()]);
    setShowAvancado(false);
  }

  async function onSalvar(e: FormEvent) {
    e.preventDefault();
    if (!can || !produtoId || !editTipo) return;
    const limpos = itens
      .map((it) => ({ ...it, titulo: it.titulo.trim() }))
      .filter((it) => it.titulo);
    if (limpos.length === 0) {
      setError("Inclua ao menos uma pergunta");
      return;
    }
    setBusy(true);
    setError("");
    setOk("");
    try {
      const nomePadrao = `${TIPO_LABEL[editTipo]} — ${produtoSel?.codigo || ""}`;
      await api("/rma/checklists", {
        method: "PUT",
        body: JSON.stringify({
          produtoId,
          tipo: editTipo,
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
      setOk("Checklist salvo.");
      cancelarEdicao();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function onClonar() {
    if (!can || !produtoId || !cloneOrigemId || !editTipo) return;
    const tipo = editTipo;
    const destinoJaTem =
      tipo === "RECEBIMENTO" ? Boolean(tmplReceb) : Boolean(tmplLib);
    if (destinoJaTem) {
      const okReplace = window.confirm(
        `Este produto já tem checklist de ${TIPO_LABEL[tipo]}.\n\nCopiar vai substituir o atual (nova versão). Continuar?`
      );
      if (!okReplace) return;
    }
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api("/rma/checklists/clonar", {
        method: "POST",
        body: JSON.stringify({
          produtoOrigemId: cloneOrigemId,
          produtoDestinoId: produtoId,
          tipo,
        }),
      });
      setCloneOrigemId("");
      const refreshed = await api<Template[]>("/rma/checklists");
      setLista(refreshed);
      const t = refreshed.find(
        (x) => x.produto.id === produtoId && x.tipo === tipo
      );
      if (t?.itens.length) {
        setItens(fromTemplate(t));
        setOk("Checklist copiado e salvo. Pode ajustar as perguntas abaixo.");
      } else {
        setOk("Checklist copiado e salvo.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao copiar");
    } finally {
      setBusy(false);
    }
  }

  if (!can) {
    return (
      <p className="p-4 text-sm text-slate-600">
        Sem permissão para checklists RMA.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Checklists RMA
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Perguntas por produto: o que conferir na entrada e na saída.
          </p>
        </div>
        <Link href="/rma" className="text-sm text-brand hover:underline">
          ← RMA
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {ok}
        </p>
      ) : null}

      {/* Passo 1: produto */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          1 · Produto
        </p>
        <input
          type="search"
          placeholder="Buscar código ou descrição…"
          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={produtoQ}
          onChange={(e) => setProdutoQ(e.target.value)}
        />
        <ul className="mt-2 max-h-48 overflow-y-auto divide-y rounded-lg border border-slate-100">
          {produtosFiltrados.map((p) => {
            const sel = p.id === produtoId;
            const tem =
              lista.some((t) => t.produto.id === p.id) || false;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setProdutoId(p.id);
                    setProdutoQ(`${p.codigo} — ${p.descricao}`);
                    cancelarEdicao();
                    setOk("");
                    setError("");
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                    sel ? "bg-sky-50" : ""
                  }`}
                >
                  <span>
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {p.codigo}
                    </span>{" "}
                    <span className="text-slate-600">{p.descricao}</span>
                  </span>
                  {tem ? (
                    <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                      checklist
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {produtosFiltrados.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-slate-400">
              Nenhum produto encontrado
            </li>
          ) : null}
        </ul>
      </section>

      {/* Passo 2: tipos */}
      {produtoSel ? (
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            2 · Checklists de {produtoSel.codigo}
          </p>
          {(
            [
              ["RECEBIMENTO", tmplReceb],
              ["LIBERACAO", tmplLib],
            ] as const
          ).map(([tipo, tmpl]) => (
            <div
              key={tipo}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
            >
              <div>
                <p className="font-medium text-slate-900">
                  {TIPO_LABEL[tipo]}
                </p>
                <p className="text-xs text-slate-500">{TIPO_HINT[tipo]}</p>
                {tmpl ? (
                  <p className="mt-1 text-xs text-emerald-700">
                    {tmpl.itens.length} pergunta
                    {tmpl.itens.length === 1 ? "" : "s"} · v{tmpl.versao}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-amber-700">
                    Ainda não definido
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => abrirEdicao(tipo)}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {tmpl ? "Editar" : "Criar"}
              </button>
            </div>
          ))}
        </section>
      ) : (
        <p className="text-center text-sm text-slate-400">
          Selecione um produto para ver ou criar o checklist.
        </p>
      )}

      {/* Editor */}
      {produtoSel && editTipo ? (
        <form
          onSubmit={(e) => void onSalvar(e)}
          className="space-y-4 rounded-xl border border-sky-200 bg-sky-50/40 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-900">
                {TIPO_LABEL[editTipo]} · {produtoSel.codigo}
              </p>
              <p className="text-xs text-slate-500">{TIPO_HINT[editTipo]}</p>
            </div>
            <button
              type="button"
              className="text-sm text-slate-500 hover:underline"
              onClick={cancelarEdicao}
            >
              Cancelar
            </button>
          </div>

          {produtosComMesmoTipo.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
              <label className="min-w-[12rem] flex-1 text-xs text-slate-600">
                Já tem checklist parecido? Copiar de
                <select
                  className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
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
                Copiar
              </button>
            </div>
          ) : null}

          <ul className="space-y-2">
            {itens.map((it, idx) => (
              <li
                key={idx}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-2 w-6 shrink-0 text-center text-xs font-bold text-slate-400">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <input
                      required
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder="Pergunta (ex.: Veio com a fonte?)"
                      value={it.titulo}
                      onChange={(e) => {
                        const next = [...itens];
                        next[idx] = { ...it, titulo: e.target.value };
                        setItens(next);
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        value={it.tipoCampo}
                        onChange={(e) => {
                          const next = [...itens];
                          next[idx] = {
                            ...it,
                            tipoCampo: e.target
                              .value as ItemDraft["tipoCampo"],
                          };
                          setItens(next);
                        }}
                      >
                        <option value="SIM_NAO">Sim / Não</option>
                        <option value="TEXTO">Texto</option>
                        <option value="OPCAO">Lista de opções</option>
                        <option value="FOTO">Só foto</option>
                      </select>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={it.obrigatorio}
                          onChange={(e) => {
                            const next = [...itens];
                            next[idx] = {
                              ...it,
                              obrigatorio: e.target.checked,
                            };
                            setItens(next);
                          }}
                        />
                        Obrigatória
                      </label>
                      <button
                        type="button"
                        className="ml-auto text-xs text-red-600 hover:underline"
                        onClick={() =>
                          setItens(itens.filter((_, i) => i !== idx))
                        }
                      >
                        Remover
                      </button>
                    </div>
                    {it.tipoCampo === "OPCAO" ? (
                      <input
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                        placeholder="Opções separadas por vírgula"
                        value={it.opcoesText}
                        onChange={(e) => {
                          const next = [...itens];
                          next[idx] = { ...it, opcoesText: e.target.value };
                          setItens(next);
                        }}
                      />
                    ) : null}
                    {showAvancado ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          placeholder="Ajuda (opcional)"
                          value={it.ajuda}
                          onChange={(e) => {
                            const next = [...itens];
                            next[idx] = { ...it, ajuda: e.target.value };
                            setItens(next);
                          }}
                        />
                        <input
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          placeholder="Exigir foto se = NAO / SIM…"
                          value={it.exigeFotoSe}
                          onChange={(e) => {
                            const next = [...itens];
                            next[idx] = {
                              ...it,
                              exigeFotoSe: e.target.value,
                            };
                            setItens(next);
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="text-sm font-medium text-sky-800 hover:underline"
              onClick={() => setItens([...itens, emptyItem()])}
            >
              + Pergunta
            </button>
            <button
              type="button"
              className="text-xs text-slate-500 hover:underline"
              onClick={() => setShowAvancado((v) => !v)}
            >
              {showAvancado ? "Ocultar opções extras" : "Opções extras"}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? "Salvando…" : "Salvar checklist"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
