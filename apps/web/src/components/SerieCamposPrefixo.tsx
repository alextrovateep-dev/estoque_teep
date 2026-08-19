"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  anoDoisDigitos,
  clampAno2,
  clampTamanhoSequencial,
  interpretarEntradaSerie,
  partesPrefixoSerie,
  prefixoSerieProduto,
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
  onStatusSerie?: (index: number, status: Status, msg: string) => void;
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
  const anoPadrao = anoDoisDigitos();
  const partes = partesPrefixoSerie({
    codigoProduto,
    formato: config?.formato,
    tamanhoSequencial: tamanho,
    prefixoFixo: config?.prefixoFixo,
  });
  const optsSerie = {
    codigoProduto,
    formato: config?.formato,
    tamanhoSequencial: tamanho,
    prefixoFixo: config?.prefixoFixo,
    sufixoFixo: sufixo,
  };

  const [anos, setAnos] = useState<number[]>([]);
  const [localStatus, setLocalStatus] = useState<Status[]>([]);
  const [localMsgs, setLocalMsgs] = useState<string[]>([]);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  function anoDaLinha(idx: number, sn: string): number {
    if (anos[idx] != null) return clampAno2(anos[idx]!);
    if (sn.trim()) {
      return interpretarEntradaSerie(sn, {
        ...optsSerie,
        ano2Atual: anoPadrao,
      }).ano2;
    }
    return anoPadrao;
  }

  function setAnoLinha(idx: number, ano2: number) {
    setAnos((prev) => {
      const next = [...prev];
      while (next.length < idx + 1) next.push(anoPadrao);
      next[idx] = clampAno2(ano2);
      return next;
    });
  }

  function aplicarSerie(idx: number, raw: string, finalizar: boolean) {
    const parsed = interpretarEntradaSerie(raw, {
      ...optsSerie,
      ano2Atual: anoDaLinha(idx, series[idx] || ""),
      finalizar,
    });
    setAnoLinha(idx, parsed.ano2);
    onChangeSerie(idx, parsed.completa);
    return parsed;
  }

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
    const parsed = interpretarEntradaSerie(full, {
      ...optsSerie,
      ano2Atual: anoDaLinha(idx, full),
      finalizar: true,
    });
    if (!parsed.sequencia) {
      setStatus(idx, "idle", "");
      return;
    }
    const tam = validarSequenciaSerieTamanho(parsed.sequencia, tamanho);
    if (!tam.ok) {
      setStatus(idx, "err", tam.motivo);
      return;
    }
    const numero = parsed.completa || full;
    const dupLocal = series.findIndex(
      (s, i) =>
        i !== idx && s.trim().toUpperCase() === numero.trim().toUpperCase()
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
        body: JSON.stringify({ produtoId, numero }),
      });
      setStatus(
        idx,
        r.ok ? "ok" : "err",
        r.ok ? "" : r.motivo || "Série já utilizada"
      );
      if (r.ok && r.numeroSerie && r.numeroSerie !== numero) {
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

  function agendarValidacao(idx: number, full: string, seqLen: number) {
    if (!validarNascimento) return;
    if (timers.current[idx]) clearTimeout(timers.current[idx]);
    if (seqLen < tamanho) {
      setStatus(idx, "idle", "");
      return;
    }
    timers.current[idx] = setTimeout(() => {
      void validarNascimentoCampo(idx, full);
    }, 400);
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-slate-600">
        Números de série ({series.length})
        <span className="ml-1 font-normal text-slate-500">
          — o ano vem do ano atual e pode ser editado. Digite só o sequencial (
          {tamanho} dígitos) ou cole a série completa.
          {sufixo ? (
            <>
              {" "}
              Sufixo <span className="font-mono">{sufixo}</span>.
            </>
          ) : null}
        </span>
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
          const parsed = interpretarEntradaSerie(sn, {
            ...optsSerie,
            ano2Atual: anoDaLinha(i, sn),
            finalizar: false,
          });
          const ano2 = parsed.ano2;
          return (
            <div key={i}>
              <div
                className={`flex overflow-hidden rounded-lg border bg-white ${border}`}
              >
                {partes.antesAno ? (
                  <span className="flex max-w-[40%] shrink-0 items-center truncate border-r border-slate-200 bg-slate-50 px-2 font-mono text-xs text-slate-600">
                    {partes.antesAno}
                  </span>
                ) : null}
                {partes.temAno ? (
                  <input
                    value={String(ano2).padStart(2, "0")}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={2}
                    title="Ano (2 dígitos). Preenchido automaticamente; edite se precisar."
                    aria-label="Ano da série (2 dígitos)"
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, "").slice(-2);
                      if (!d) return;
                      const novoAno = clampAno2(Number(d.padStart(2, "0")));
                      setAnoLinha(i, novoAno);
                      const prefixo = prefixoSerieProduto({
                        ...optsSerie,
                        ano2: novoAno,
                      });
                      const full = serieCompletaDeSequencia(
                        prefixo,
                        parsed.sequencia,
                        tamanho,
                        sufixo,
                        { finalizar: false }
                      );
                      onChangeSerie(i, full);
                      setStatus(i, "idle", "");
                    }}
                    className="w-10 shrink-0 border-r border-slate-200 bg-slate-50 px-1 py-2 text-center font-mono text-sm outline-none"
                  />
                ) : null}
                {partes.depoisAno ? (
                  <span className="flex shrink-0 items-center border-r border-slate-200 bg-slate-50 px-1 font-mono text-xs text-slate-600">
                    {partes.depoisAno}
                  </span>
                ) : null}
                <input
                  value={parsed.sequencia}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(e) => {
                    const next = aplicarSerie(i, e.target.value, false);
                    setStatus(i, "idle", "");
                    agendarValidacao(i, next.completa, next.sequencia.length);
                  }}
                  onBlur={() => {
                    const next = aplicarSerie(i, parsed.sequencia || sn, true);
                    onBlurSerie?.(i, next.completa);
                    if (next.sequencia.length >= tamanho) {
                      void validarNascimentoCampo(i, next.completa);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const next = aplicarSerie(i, parsed.sequencia || sn, true);
                      onBlurSerie?.(i, next.completa);
                      if (next.sequencia.length >= tamanho) {
                        void validarNascimentoCampo(i, next.completa);
                      }
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
