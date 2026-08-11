"use client";

import { KeyboardEvent, useState } from "react";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Se true, mostra contagem como quantidade */
  showCount?: boolean;
  label?: string;
  /** Entrada: permite alocar séries no contador do produto */
  podeGerarAutomatico?: boolean;
  onGerarAutomatico?: (quantidade: number) => Promise<void> | void;
  gerando?: boolean;
  /** Desfaz a última alocação pendente (cancela lançamento sem confirmar) */
  alocacaoPendenteId?: string | null;
  onDesfazerAlocacao?: () => Promise<void> | void;
  desfazendo?: boolean;
  /** Texto curto do formato (ex. COD-26-0001) */
  formatoDica?: string;
};

function parseTokens(raw: string): string[] {
  return raw
    .split(/[\n,;\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SeriesInput({
  value,
  onChange,
  disabled,
  placeholder = "Digite ou cole séries e pressione Enter",
  showCount = true,
  label = "Números de série",
  podeGerarAutomatico = false,
  onGerarAutomatico,
  gerando = false,
  alocacaoPendenteId = null,
  onDesfazerAlocacao,
  desfazendo = false,
  formatoDica,
}: Props) {
  const [draft, setDraft] = useState("");
  const [qtdGerar, setQtdGerar] = useState("10");

  function addTokens(raw: string) {
    const tokens = parseTokens(raw);
    if (!tokens.length) return;
    const seen = new Set(value.map((v) => v.toUpperCase()));
    const next = [...value];
    for (const t of tokens) {
      const key = t.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(t);
    }
    onChange(next);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (alocacaoPendenteId) {
      if (e.key === "Backspace" || e.key === "Enter" || e.key === ",") {
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTokens(draft);
    } else if (e.key === "Tab") {
      if (draft.trim()) addTokens(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  async function handleGerar() {
    if (!onGerarAutomatico || gerando || disabled) return;
    const n = Math.floor(Number(qtdGerar));
    if (!(n >= 1 && n <= 500)) return;
    await onGerarAutomatico(n);
  }

  async function handleDesfazer() {
    if (!onDesfazerAlocacao || desfazendo || disabled) return;
    if (
      !confirm(
        "Desfazer a última geração? Os números voltam ao contador e saem desta lista."
      )
    ) {
      return;
    }
    await onDesfazerAlocacao();
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-zinc-700">{label}</label>
        {showCount ? (
          <span className="text-xs text-zinc-500">
            {value.length} unidade{value.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {podeGerarAutomatico && onGerarAutomatico ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-teal-100 bg-teal-50/50 px-2 py-2">
          <label className="text-xs text-teal-900">
            Gerar automaticamente
            <input
              type="number"
              min={1}
              max={500}
              value={qtdGerar}
              disabled={disabled || gerando || desfazendo}
              onChange={(e) => setQtdGerar(e.target.value)}
              className="mt-0.5 block w-24 rounded border border-teal-200 bg-white px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={disabled || gerando || desfazendo}
            onClick={() => void handleGerar()}
            className="rounded bg-teal-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {gerando ? "Gerando…" : "Gerar séries"}
          </button>
          {alocacaoPendenteId && onDesfazerAlocacao ? (
            <button
              type="button"
              disabled={disabled || gerando || desfazendo}
              onClick={() => void handleDesfazer()}
              className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-50"
            >
              {desfazendo ? "Desfazendo…" : "Desfazer geração"}
            </button>
          ) : null}
          <span className="text-[11px] text-teal-800/80">
            {formatoDica
              ? `Formato: ${formatoDica}. `
              : "Formato conforme cadastro do produto. "}
            As unidades só entram no estoque ao confirmar o lançamento.
          </span>
        </div>
      ) : null}

      <div
        className={`flex min-h-[2.75rem] flex-wrap items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1.5 ${
          disabled ? "opacity-60" : ""
        }`}
      >
        {value.map((s, i) => (
          <span
            key={`${s}-${i}`}
            className="inline-flex items-center gap-1 rounded bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-900"
          >
            {s}
            {!disabled && !alocacaoPendenteId ? (
              <button
                type="button"
                className="text-teal-700 hover:text-teal-950"
                onClick={() => removeAt(i)}
                aria-label={`Remover ${s}`}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        <input
          className="min-w-[10rem] flex-1 border-0 bg-transparent py-1 text-sm outline-none"
          value={draft}
          disabled={disabled || Boolean(alocacaoPendenteId)}
          placeholder={
            alocacaoPendenteId
              ? "Lote gerado — use Desfazer para alterar"
              : value.length
                ? ""
                : placeholder
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) addTokens(draft);
          }}
          onPaste={(e) => {
            if (alocacaoPendenteId) {
              e.preventDefault();
              return;
            }
            const text = e.clipboardData.getData("text");
            if (/[\n,;\t]/.test(text)) {
              e.preventDefault();
              addTokens(text);
            }
          }}
        />
      </div>
      <p className="text-xs text-zinc-500">
        {alocacaoPendenteId
          ? "Lote gerado automaticamente: confirme o lançamento inteiro ou use Desfazer geração."
          : "Digite o número informado no equipamento ou gere automaticamente (entrada). Enter ou vírgula para adicionar; pode colar uma lista."}
      </p>
    </div>
  );
}
