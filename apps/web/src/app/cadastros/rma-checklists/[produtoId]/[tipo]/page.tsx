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
  itemsFromTemplate,
  parseChecklistTipo,
  ProdutoOpt,
  TIPO_HINT,
  TIPO_LABEL,
} from "@/components/rma/rmaChecklistShared";

export default function RmaChecklistEditorPage() {
  const router = useRouter();
  const params = useParams();
  const produtoId = String(params.produtoId || "");
  const tipo = parseChecklistTipo(String(params.tipo || ""));

  const user = getStoredUser();
  const can = user ? userHas(user, "rma") : false;

  const [produto, setProduto] = useState<ProdutoOpt | null>(null);
  const [lista, setLista] = useState<ChecklistTemplate[]>([]);
  const [itens, setItens] = useState<ItemDraft[]>([emptyChecklistItem()]);
  const [cloneOrigemId, setCloneOrigemId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const tmplAtual = useMemo(
    () =>
      tipo
        ? lista.find((t) => t.produto.id === produtoId && t.tipo === tipo) ||
          null
        : null,
    [lista, produtoId, tipo]
  );

  const produtosComMesmoTipo = useMemo(() => {
    if (!tipo) return [];
    const map = new Map<string, ProdutoOpt>();
    for (const t of lista) {
      if (t.tipo !== tipo || t.produto.id === produtoId) continue;
      map.set(t.produto.id, t.produto);
    }
    return [...map.values()];
  }, [lista, tipo, produtoId]);

  useEffect(() => {
    if (!can || !tipo || !produtoId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<ChecklistTemplate[]>("/rma/checklists"),
      api<ProdutoOpt[]>("/produtos"),
    ])
      .then(([t, p]) => {
        if (cancelled) return;
        setLista(t);
        const prod = p.find((x) => x.id === produtoId) || null;
        setProduto(prod);
        const atual =
          t.find((x) => x.produto.id === produtoId && x.tipo === tipo) || null;
        setItens(
          atual?.itens.length
            ? itemsFromTemplate(atual)
            : [emptyChecklistItem()]
        );
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
  }, [can, produtoId, tipo]);

  async function onSalvar(e: FormEvent) {
    e.preventDefault();
    if (!can || !tipo || !produtoId) return;
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
      const nomePadrao = `${TIPO_LABEL[tipo]} — ${produto?.codigo || ""}`;
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
    if (tmplAtual) {
      const okReplace = window.confirm(
        `Este produto já tem checklist de ${TIPO_LABEL[tipo]}.\n\nCopiar vai substituir o atual (nova versão). Continuar?`
      );
      if (!okReplace) return;
    }
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
      const refreshed = await api<ChecklistTemplate[]>("/rma/checklists");
      setLista(refreshed);
      const t = refreshed.find(
        (x) => x.produto.id === produtoId && x.tipo === tipo
      );
      if (t?.itens.length) setItens(itemsFromTemplate(t));
      setCloneOrigemId("");
      router.replace(`/cadastros/rma-checklists/${produtoId}/${tipo}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao copiar");
    } finally {
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

  if (!produto) {
    return (
      <p className="text-sm text-red-700">
        Produto não encontrado.{" "}
        <Link href="/cadastros/rma-checklists" className="underline">
          Voltar
        </Link>
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Editar · {tipo === "RECEBIMENTO" ? "Entrada" : "Liberação"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {produto.codigo}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {produto.descricao} · {TIPO_HINT[tipo]}
            {tmplAtual ? ` · v${tmplAtual.versao}` : ""}
          </p>
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

      <RmaChecklistFormEditor
        tipo={tipo}
        itens={itens}
        onChangeItens={setItens}
        busy={busy}
        onSubmit={(e) => void onSalvar(e)}
        submitLabel="Salvar alterações"
        produtoSlot={
          <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
            <span className="font-mono font-semibold">{produto.codigo}</span>
            <span className="text-slate-400"> · </span>
            {produto.descricao}
          </div>
        }
        extrasSlot={
          produtosComMesmoTipo.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
              <label className="min-w-[14rem] flex-1 text-xs text-slate-600">
                Substituir copiando de
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
                Copiar
              </button>
            </div>
          ) : null
        }
      />
    </>
  );
}
