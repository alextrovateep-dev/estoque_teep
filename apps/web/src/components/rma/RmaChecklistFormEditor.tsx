"use client";

import { FormEvent, ReactNode, useState } from "react";
import Link from "next/link";
import {
  emptyChecklistItem,
  exigeFotoSeSelectValue,
  ItemDraft,
  TIPO_LABEL,
} from "@/components/rma/rmaChecklistShared";

type Props = {
  tipo: "RECEBIMENTO" | "LIBERACAO";
  /** Produto já escolhido (edição) ou seletor (criação). */
  produtoSlot: ReactNode;
  /** Copiar de outro produto, etc. */
  extrasSlot?: ReactNode;
  itens: ItemDraft[];
  onChangeItens: (itens: ItemDraft[]) => void;
  busy: boolean;
  onSubmit: (e: FormEvent) => void;
  submitLabel?: string;
  cancelHref?: string;
};

const TIPO_CAMPO_LABEL: Record<ItemDraft["tipoCampo"], string> = {
  SIM_NAO: "Sim / Não",
  TEXTO: "Texto",
  OPCAO: "Lista",
  FOTO: "Foto",
};

export function RmaChecklistFormEditor({
  tipo,
  produtoSlot,
  extrasSlot,
  itens,
  onChangeItens,
  busy,
  onSubmit,
  submitLabel = "Salvar",
  cancelHref = "/cadastros/rma-checklists",
}: Props) {
  const [showAvancado, setShowAvancado] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  function update(idx: number, patch: Partial<ItemDraft>) {
    const next = [...itens];
    next[idx] = { ...next[idx], ...patch };
    onChangeItens(next);
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      >
        {produtoSlot}
        {extrasSlot}

        <div>
          <h2 className="text-sm font-semibold text-slate-800">Perguntas</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Monte o que a equipe responde no processo de{" "}
            {TIPO_LABEL[tipo].toLowerCase()}.
          </p>
        </div>

        <ul className="space-y-2">
          {itens.map((it, idx) => (
            <li
              key={idx}
              className="rounded-lg border border-slate-200 bg-slate-50/40 p-3"
            >
              <div className="flex items-start gap-2">
                <span className="mt-2 w-6 shrink-0 text-center text-xs font-bold text-slate-400">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    required
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                    placeholder="Pergunta (ex.: Veio com a fonte?)"
                    value={it.titulo}
                    onChange={(e) => update(idx, { titulo: e.target.value })}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                      value={it.tipoCampo}
                      onChange={(e) =>
                        update(idx, {
                          tipoCampo: e.target
                            .value as ItemDraft["tipoCampo"],
                        })
                      }
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
                        onChange={(e) =>
                          update(idx, { obrigatorio: e.target.checked })
                        }
                      />
                      Obrigatória
                    </label>
                    {it.tipoCampo === "SIM_NAO" ? (
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        Foto extra
                        <select
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                          value={exigeFotoSeSelectValue(it.exigeFotoSe)}
                          onChange={(e) =>
                            update(idx, { exigeFotoSe: e.target.value })
                          }
                        >
                          <option value="">Não exigir</option>
                          <option value="SIM">Só se Sim</option>
                          <option value="NAO">Só se Não</option>
                        </select>
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="ml-auto text-xs text-red-600 hover:underline"
                      onClick={() =>
                        onChangeItens(itens.filter((_, i) => i !== idx))
                      }
                    >
                      Remover
                    </button>
                  </div>
                  {it.tipoCampo === "OPCAO" ? (
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                      placeholder="Opções separadas por vírgula"
                      value={it.opcoesText}
                      onChange={(e) =>
                        update(idx, { opcoesText: e.target.value })
                      }
                    />
                  ) : null}
                  {showAvancado ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                        placeholder="Ajuda (opcional)"
                        value={it.ajuda}
                        onChange={(e) => update(idx, { ajuda: e.target.value })}
                      />
                      {it.tipoCampo === "OPCAO" ? (
                        <input
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                          placeholder="Exigir foto se a opção for…"
                          value={it.exigeFotoSe}
                          onChange={(e) =>
                            update(idx, { exigeFotoSe: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-[11px] text-slate-500 sm:col-span-1">
                          Em Sim/Não, foto extra fica ao lado da pergunta. Ex.:
                          “O equipamento está ligando?” → Só se Sim; se Não,
                          conclui sem foto.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            className="text-sm font-medium text-brand hover:underline"
            onClick={() => onChangeItens([...itens, emptyChecklistItem()])}
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
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Prévia
            </button>
            <Link
              href={cancelHref}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? "Salvando…" : submitLabel}
            </button>
          </div>
        </div>
      </form>

      {previewOpen ? (
        <ChecklistPreviewModal
          tipo={tipo}
          itens={itens}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}

function ChecklistPreviewModal({
  tipo,
  itens,
  onClose,
}: {
  tipo: "RECEBIMENTO" | "LIBERACAO";
  itens: ItemDraft[];
  onClose: () => void;
}) {
  const limpos = itens
    .map((it) => ({ ...it, titulo: it.titulo.trim() }))
    .filter((it) => it.titulo);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Prévia do checklist"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Prévia · como a equipe vê
            </p>
            <h3 className="text-lg font-semibold text-slate-900">
              Checklist de {TIPO_LABEL[tipo].toLowerCase()}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Fechar
          </button>
        </div>

        <div className="space-y-3 p-4">
          {limpos.length === 0 ? (
            <p className="text-sm text-slate-500">
              Inclua pelo menos uma pergunta para ver a prévia.
            </p>
          ) : (
            <ul className="space-y-2">
              {limpos.map((it, idx) => {
                const opcoes = it.opcoesText
                  .split(/[,;\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                return (
                  <li
                    key={idx}
                    className="rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                  >
                    <p className="text-sm font-medium text-slate-800">
                      {idx + 1}. {it.titulo}
                      {it.obrigatorio ? " *" : ""}
                    </p>
                    {it.ajuda ? (
                      <p className="mt-0.5 text-xs text-slate-500">{it.ajuda}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-slate-400">
                      {TIPO_CAMPO_LABEL[it.tipoCampo]}
                      {it.exigeFotoSe
                        ? ` · foto se resposta = ${it.exigeFotoSe}`
                        : ""}
                    </p>

                    {it.tipoCampo === "SIM_NAO" ? (
                      <div className="mt-2 flex gap-4 text-sm text-slate-700">
                        <label className="flex items-center gap-1.5">
                          <input type="radio" disabled name={`pv-${idx}`} />
                          Sim
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input type="radio" disabled name={`pv-${idx}`} />
                          Não
                        </label>
                      </div>
                    ) : null}
                    {it.tipoCampo === "TEXTO" ? (
                      <textarea
                        disabled
                        rows={2}
                        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                        placeholder="Resposta…"
                      />
                    ) : null}
                    {it.tipoCampo === "OPCAO" ? (
                      <select
                        disabled
                        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      >
                        <option value="">—</option>
                        {opcoes.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : null}
                    {it.tipoCampo === "FOTO" || it.exigeFotoSe ? (
                      <div className="mt-2">
                        <span className="inline-block rounded border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500">
                          + Foto
                        </span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
