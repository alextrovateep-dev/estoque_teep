"use client";

import {
  prefixoSerieProduto,
  sequenciaDeSerieCompleta,
  serieCompletaDeSequencia,
} from "@teep/shared";

export type SerieConfigLite = {
  formato?: string;
  tamanhoSequencial?: number;
  prefixoFixo?: string | null;
  sufixoFixo?: string | null;
} | null;

type Status = "idle" | "checking" | "ok" | "err";

type Props = {
  codigoProduto: string;
  config?: SerieConfigLite;
  series: string[];
  serieStatus?: Status[];
  serieMsgs?: string[];
  onChangeSerie: (index: number, serieCompleta: string) => void;
  onBlurSerie?: (index: number, serieCompleta: string) => void;
  /** Quando true, mostra feedback de validação no estoque */
  validarEstoque?: boolean;
};

export function SerieCamposPrefixo({
  codigoProduto,
  config,
  series,
  serieStatus,
  serieMsgs,
  onChangeSerie,
  onBlurSerie,
  validarEstoque,
}: Props) {
  const tamanho = config?.tamanhoSequencial ?? 4;
  const sufixo = config?.sufixoFixo ?? null;
  const prefixo = prefixoSerieProduto({
    codigoProduto,
    formato: config?.formato,
    tamanhoSequencial: tamanho,
    prefixoFixo: config?.prefixoFixo,
    sufixoFixo: config?.sufixoFixo,
  });

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-slate-600">
        Números de série ({series.length})
        {prefixo ? (
          <span className="ml-1 font-normal text-slate-500">
            — prefixo <span className="font-mono">{prefixo}</span>
            {sufixo ? (
              <>
                {" "}
                / sufixo <span className="font-mono">{sufixo}</span>
              </>
            ) : null}
            ; digite só a sequência
          </span>
        ) : null}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((sn, i) => {
          const st = serieStatus?.[i] || "idle";
          const border =
            st === "ok"
              ? "border-emerald-400 focus:ring-emerald-200"
              : st === "err"
                ? "border-rose-400 focus:ring-rose-200"
                : st === "checking"
                  ? "border-amber-300"
                  : "border-slate-200";
          const seq = sequenciaDeSerieCompleta(sn, prefixo, sufixo);
          return (
            <div key={i}>
              <div
                className={`flex overflow-hidden rounded-lg border bg-white ${border}`}
              >
                {prefixo ? (
                  <span className="flex max-w-[45%] shrink-0 items-center truncate border-r border-slate-200 bg-slate-50 px-2 font-mono text-xs text-slate-600">
                    {prefixo}
                  </span>
                ) : null}
                <input
                  value={seq}
                  onChange={(e) => {
                    const full = serieCompletaDeSequencia(
                      prefixo,
                      e.target.value,
                      tamanho,
                      sufixo
                    );
                    onChangeSerie(i, full);
                  }}
                  onBlur={() => {
                    const full = serieCompletaDeSequencia(
                      prefixo,
                      sequenciaDeSerieCompleta(sn, prefixo, sufixo),
                      tamanho,
                      sufixo
                    );
                    onChangeSerie(i, full);
                    onBlurSerie?.(i, full);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const full = serieCompletaDeSequencia(
                        prefixo,
                        sequenciaDeSerieCompleta(sn, prefixo, sufixo),
                        tamanho,
                        sufixo
                      );
                      onChangeSerie(i, full);
                      onBlurSerie?.(i, full);
                    }
                  }}
                  placeholder={`seq ${i + 1}`}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm outline-none"
                />
                {sufixo ? (
                  <span className="flex shrink-0 items-center border-l border-slate-200 bg-slate-50 px-2 font-mono text-xs text-slate-600">
                    {sufixo}
                  </span>
                ) : null}
              </div>
              {serieMsgs?.[i] ? (
                <p className="mt-0.5 text-[11px] text-rose-600">
                  {serieMsgs[i]}
                </p>
              ) : st === "ok" && validarEstoque ? (
                <p className="mt-0.5 text-[11px] text-emerald-700">
                  Disponível no estoque
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
