"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  clampTamanhoSequencial,
  digitosSequenciaLimitados,
  prefixoSerieProduto,
  sequenciaDeSerieCompleta,
  serieCompletaDeSequencia,
  validarSequenciaSerieTamanho,
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
  /** Para validar unicidade no nascimento (entrada / transf. árvore). */
  produtoId?: string;
  config?: SerieConfigLite;
  series: string[];
  serieStatus?: Status[];
  serieMsgs?: string[];
  onChangeSerie: (index: number, serieCompleta: string) => void;
  onBlurSerie?: (index: number, serieCompleta: string) => void;
  onStatusSerie?: (
    index: number,
    status: Status,
    msg: string
  ) => void;
  /** Quando true, mostra feedback de validação no estoque (saída). */
  validarEstoque?: boolean;
  /**
   * Valida tamanho da seq. + unicidade no produto (não pode repetir série já gerada).
   */
  validarNascimento?: boolean;
};

export function SerieCamposPrefixo({
  codigoProduto,
  produtoId,
  config,
  series,
  serieStatus: serieStatusProp,
  serieMsgs: serieMsgsProp,
  onChangeSerie,
  onBlurSerie,
  onStatusSerie,
  validarEstoque,
  validarNascimento,
}: Props) {
  const tamanho = clampTamanhoSequencial(config?.tamanhoSequencial);
  const sufixo = config?.sufixoFixo ?? null;
  const prefixo = prefixoSerieProduto({
    codigoProduto,
    formato: config?.formato,
    tamanhoSequencial: tamanho,
    prefixoFixo: config?.prefixoFixo,
    sufixoFixo: config?.sufixoFixo,
  });

  const [localStatus, setLocalStatus] = useState<Status[]>([]);
  const [localMsgs, setLocalMsgs] = useState<string[]>([]);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const serieStatus = serieStatusProp ?? localStatus;
  const serieMsgs = serieMsgsProp ?? localMsgs;

  function setStatus(idx: number, status: Status, msg: string) {
    if (onStatusSerie) {
      onStatusSerie(idx, status, msg);
      return;
    }
    setLocalStatus((prev) => {
      const next = [...prev];
      while (next.length < idx + 1) next.push("idle");
      next[idx] = status;
      return next;
    });
    setLocalMsgs((prev) => {
      const next = [...prev];
      while (next.length < idx + 1) next.push("");
      next[idx] = msg;
      return next;
    });
  }

  async function validarNascimentoCampo(idx: number, full: string) {
    if (!validarNascimento || !produtoId) return;
    const seq = sequenciaDeSerieCompleta(full, prefixo, sufixo);
    if (!seq) {
      setStatus(idx, "idle", "");
      return;
    }
    const tam = validarSequenciaSerieTamanho(seq, tamanho);
    if (!tam.ok) {
      setStatus(idx, "err", tam.motivo);
      return;
    }
    const dupLocal = series.findIndex(
      (s, i) =>
        i !== idx && s.trim().toUpperCase() === full.trim().toUpperCase()
    );
    if (dupLocal >= 0) {
      setStatus(idx, "err", "Série duplicada neste lançamento");
      return;
    }
    setStatus(idx, "checking", "");
    try {
      const r = await api<{
        ok: boolean;
        motivo?: string | null;
        numeroSerie?: string;
      }>("/series/validar-nascimento", {
        method: "POST",
        body: JSON.stringify({ produtoId, numero: full }),
      });
      setStatus(
        idx,
        r.ok ? "ok" : "err",
        r.ok ? "" : r.motivo || "Série já utilizada"
      );
      if (r.ok && r.numeroSerie && r.numeroSerie !== full) {
        onChangeSerie(idx, r.numeroSerie);
      }
    } catch (e) {
      setStatus(
        idx,
        "err",
        e instanceof Error ? e.message : "Falha ao validar série"
      );
    }
  }

  function agendarValidacao(idx: number, full: string) {
    if (!validarNascimento) return;
    if (timers.current[idx]) clearTimeout(timers.current[idx]);
    timers.current[idx] = setTimeout(() => {
      void validarNascimentoCampo(idx, full);
    }, 400);
  }

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
            ; digite só a sequência ({tamanho} dígitos)
          </span>
        ) : (
          <span className="ml-1 font-normal text-slate-500">
            — sequência com {tamanho} dígitos
          </span>
        )}
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
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={tamanho}
                  onChange={(e) => {
                    const digits = digitosSequenciaLimitados(
                      e.target.value,
                      tamanho
                    );
                    const full = serieCompletaDeSequencia(
                      prefixo,
                      digits,
                      tamanho,
                      sufixo,
                      { finalizar: false }
                    );
                    onChangeSerie(i, full);
                    setStatus(i, "idle", "");
                    agendarValidacao(i, full);
                  }}
                  onBlur={() => {
                    const full = serieCompletaDeSequencia(
                      prefixo,
                      sequenciaDeSerieCompleta(sn, prefixo, sufixo),
                      tamanho,
                      sufixo,
                      { finalizar: true }
                    );
                    onChangeSerie(i, full);
                    onBlurSerie?.(i, full);
                    void validarNascimentoCampo(i, full);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const full = serieCompletaDeSequencia(
                        prefixo,
                        sequenciaDeSerieCompleta(sn, prefixo, sufixo),
                        tamanho,
                        sufixo,
                        { finalizar: true }
                      );
                      onChangeSerie(i, full);
                      onBlurSerie?.(i, full);
                      void validarNascimentoCampo(i, full);
                    }
                  }}
                  placeholder={"0".repeat(tamanho)}
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
              ) : st === "ok" && validarNascimento ? (
                <p className="mt-0.5 text-[11px] text-emerald-700">
                  Série disponível
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
