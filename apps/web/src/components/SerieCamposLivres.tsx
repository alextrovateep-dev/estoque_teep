"use client";

type Status = "idle" | "checking" | "ok" | "err";

type Props = {
  series: string[];
  serieStatus?: Status[];
  serieMsgs?: string[];
  onChangeSerie: (index: number, valor: string) => void;
  onBlurSerie?: (index: number, valor: string) => void;
};

/**
 * Série exigida pelo tipo de operação em produto que não controla série
 * (ex. Demonstração / Comodato): número livre, sem formato do cadastro.
 */
export function SerieCamposLivres({
  series,
  serieStatus,
  serieMsgs,
  onChangeSerie,
  onBlurSerie,
}: Props) {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-slate-600">
        Números de série ({series.length})
        <span className="ml-1 font-normal text-slate-500">
          — exigidos por este tipo de operação. Digite o número como está no
          equipamento.
        </span>
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((sn, i) => {
          const st = serieStatus?.[i] || "idle";
          const border =
            st === "err"
              ? "border-rose-400 focus:ring-rose-200"
              : st === "ok"
                ? "border-emerald-400 focus:ring-emerald-200"
                : "border-slate-200 focus:ring-brand/15";
          return (
            <div key={i}>
              <input
                value={sn}
                autoComplete="off"
                maxLength={80}
                onChange={(e) => onChangeSerie(i, e.target.value)}
                onBlur={() => onBlurSerie?.(i, sn)}
                placeholder={`Série ${i + 1}`}
                className={`w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm outline-none focus:ring-2 ${border}`}
              />
              {serieMsgs?.[i] ? (
                <p className="mt-0.5 text-[11px] text-rose-600">
                  {serieMsgs[i]}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
