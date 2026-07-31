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
}: Props) {
  const [draft, setDraft] = useState("");

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
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      e.preventDefault();
      addTokens(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-zinc-700">{label}</label>
        {showCount ? (
          <span className="text-xs text-zinc-500">
            {value.length} unidade{value.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
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
            {!disabled ? (
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
          disabled={disabled}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) addTokens(draft);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[\n,;\t]/.test(text)) {
              e.preventDefault();
              addTokens(text);
            }
          }}
        />
      </div>
      <p className="text-xs text-zinc-500">
        Digite o número informado no equipamento. Enter ou vírgula para
        adicionar; pode colar uma lista. O sistema valida se a série está no
        estoque certo e se a movimentação é permitida.
      </p>
    </div>
  );
}
