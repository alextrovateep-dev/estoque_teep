"use client";

import { SerieCamposPrefixo, type SerieConfigLite } from "@/components/SerieCamposPrefixo";
import { api } from "@/lib/api";
import { anoDoisDigitos, gerarSequenciaSeries } from "@teep/shared";
import { useState } from "react";

type Props = {
  produtoId: string;
  codigo: string;
  delta: number;
  filialLabel: string;
  series: string[];
  seriesExistentes: string[] | null;
  seriesEmEstoque: number;
  seriesErro: string | null;
  carregando: boolean;
  serieConfig: SerieConfigLite | undefined;
  aberto: boolean;
  onToggle: () => void;
  onReload: () => void;
  onSeriesChange: (series: string[]) => void;
  onEnsureConfig: () => void;
};

function contagemLabel(series: string[], need: number): string {
  const ok = series.filter((s) => s.trim()).length;
  return `${ok}/${need} informada(s)`;
}

export function InventarioSerieAjuste({
  produtoId,
  codigo,
  delta,
  filialLabel,
  series,
  seriesExistentes,
  seriesEmEstoque,
  seriesErro,
  carregando,
  serieConfig,
  aberto,
  onToggle,
  onReload,
  onSeriesChange,
  onEnsureConfig,
}: Props) {
  const [erroLocal, setErroLocal] = useState("");
  const need = Math.abs(delta);
  const isEntrada = delta > 0;
  const isSaida = delta < 0;
  const qtdLista = seriesExistentes?.length ?? seriesEmEstoque;

  function toggleSerieSaida(sn: string) {
    const idx = series.indexOf(sn);
    if (idx >= 0) {
      onSeriesChange(series.filter((s) => s !== sn));
      return;
    }
    if (series.length >= need) return;
    onSeriesChange([...series, sn]);
  }

  async function sugerirProximasSeries() {
    setErroLocal("");
    try {
      const c = await api<{
        proximo: number;
        configuracao: NonNullable<SerieConfigLite>;
      }>(`/series/contador/${produtoId}`);
      const cfg = serieConfig ?? c.configuracao;
      if (!serieConfig) onEnsureConfig();
      const geradas = gerarSequenciaSeries({
        codigoProduto: codigo,
        ano2: anoDoisDigitos(),
        sequencialInicial: c.proximo,
        quantidade: need,
        tamanhoSequencial: cfg.tamanhoSequencial,
        formato: cfg.formato,
        prefixoFixo: cfg.prefixoFixo,
        sufixoFixo: cfg.sufixoFixo,
      });
      onSeriesChange(geradas);
    } catch (e) {
      setErroLocal(
        e instanceof Error ? e.message : "Falha ao sugerir séries"
      );
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="text-sm text-teal-800 underline"
        onClick={onToggle}
      >
        {aberto ? "Ocultar séries" : "Informar séries"}
        {qtdLista > 0 ? ` (${qtdLista} em estoque)` : ""}
        {` · ${isEntrada ? "+" : "−"}${need}`}
      </button>

      {aberto ? (
        <div className="space-y-3 rounded-lg border border-teal-100 bg-teal-50/40 p-2.5">
          <div
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              isEntrada
                ? "bg-emerald-100 text-emerald-900"
                : "bg-amber-100 text-amber-950"
            }`}
          >
            {isEntrada
              ? `Entrada: cadastre ${need} série(s) nova(s)`
              : `Saída: selecione ${need} série(s) para retirar`}
            <span className="ml-2 font-normal opacity-80">
              ({contagemLabel(series, need)})
            </span>
          </div>

          {isSaida ? (
            <>
              <div>
                <p className="text-xs font-medium text-slate-600">
                  Clique para selecionar · {filialLabel}
                </p>
                {carregando ||
                (seriesExistentes === null && !seriesErro) ? (
                  <p className="mt-1 text-xs text-slate-500">Carregando…</p>
                ) : seriesErro ? (
                  <div className="mt-1 space-y-1">
                    <p className="text-xs text-rose-700">{seriesErro}</p>
                    <button
                      type="button"
                      className="text-xs text-teal-800 underline"
                      onClick={onReload}
                    >
                      Tentar de novo
                    </button>
                  </div>
                ) : (seriesExistentes?.length ?? 0) === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Nenhuma série disponível neste estoque.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {seriesExistentes!.map((sn) => {
                      const sel = series.includes(sn);
                      const cheio = !sel && series.length >= need;
                      return (
                        <button
                          key={sn}
                          type="button"
                          disabled={cheio}
                          onClick={() => toggleSerieSaida(sn)}
                          className={`rounded-md border px-2 py-1 font-mono text-[11px] transition ${
                            sel
                              ? "border-teal-600 bg-teal-700 text-white"
                              : cheio
                                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                : "border-slate-200 bg-white text-slate-800 hover:border-teal-400"
                          }`}
                          title={sel ? "Remover da seleção" : "Selecionar"}
                        >
                          {sn}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {series.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] text-slate-600">
                    Selecionadas:{" "}
                    <span className="font-mono">{series.join(", ")}</span>
                  </p>
                  <button
                    type="button"
                    className="text-[11px] text-teal-800 underline"
                    onClick={() => onSeriesChange([])}
                  >
                    Limpar
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {isEntrada ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-teal-300 bg-white px-2 py-1 text-xs font-medium text-teal-900 hover:bg-teal-50"
                  onClick={() => void sugerirProximasSeries()}
                >
                  Sugerir próximos {need} do contador
                </button>
                {series.some((s) => s.trim()) ? (
                  <button
                    type="button"
                    className="text-xs text-slate-600 underline"
                    onClick={() => onSeriesChange(Array(need).fill(""))}
                  >
                    Limpar campos
                  </button>
                ) : null}
              </div>
              {erroLocal ? (
                <p className="text-xs text-rose-700">{erroLocal}</p>
              ) : null}
              <SerieCamposPrefixo
                codigoProduto={codigo}
                produtoId={produtoId}
                config={serieConfig ?? null}
                series={series}
                validarNascimento
                onChangeSerie={(i, full) => {
                  const next = [...series];
                  while (next.length < i + 1) next.push("");
                  next[i] = full;
                  onSeriesChange(next);
                }}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
