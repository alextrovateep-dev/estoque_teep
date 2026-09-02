"use client";

import { UNIDADES_MEDIDA, normalizarUnidade, unidadeLabel } from "@teep/shared";

type Props = {
  value: string;
  onChange: (codigo: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
};

/** Select de unidade de medida (lista padrão + valor customizado já cadastrado). */
export function UnidadeMedidaSelect({
  value,
  onChange,
  disabled,
  className = "w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-700 focus:ring-1 focus:ring-teal-700",
  id,
}: Props) {
  const norm = normalizarUnidade(value || "UN");
  const conhecida = UNIDADES_MEDIDA.some((u) => u.codigo === norm);

  return (
    <select
      id={id}
      disabled={disabled}
      className={className}
      value={conhecida ? norm : "__custom__"}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__custom__") return;
        onChange(v);
      }}
    >
      {!conhecida && norm ? (
        <option value="__custom__">
          {norm} — {unidadeLabel(norm)} (cadastrada)
        </option>
      ) : null}
      {UNIDADES_MEDIDA.map((u) => (
        <option key={u.codigo} value={u.codigo}>
          {u.codigo} — {u.label}
        </option>
      ))}
    </select>
  );
}

/** Select compacto para escolher unidade de entrada (mesma família). */
export function UnidadeEntradaSelect({
  unidadeEstoque,
  value,
  onChange,
  disabled,
  className = "rounded border border-slate-200 bg-white px-1.5 py-1 text-xs",
}: {
  unidadeEstoque: string;
  value: string;
  onChange: (codigo: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const estoque = normalizarUnidade(unidadeEstoque);
  const atual = normalizarUnidade(value || estoque);
  const opcoes = UNIDADES_MEDIDA.filter((u) => u.familia === familiaOf(estoque));

  if (opcoes.length <= 1) {
    return (
      <span className="text-xs font-medium text-slate-600 tabular-nums">
        {estoque}
      </span>
    );
  }

  return (
    <select
      disabled={disabled}
      className={className}
      value={atual}
      onChange={(e) => onChange(e.target.value)}
      title="Unidade para informar a quantidade"
    >
      {opcoes.map((u) => (
        <option key={u.codigo} value={u.codigo}>
          {u.codigo}
        </option>
      ))}
    </select>
  );
}

function familiaOf(codigo: string) {
  const n = normalizarUnidade(codigo);
  return UNIDADES_MEDIDA.find((u) => u.codigo === n)?.familia ?? "contagem";
}
