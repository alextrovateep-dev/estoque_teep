"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Status = "idle" | "checking" | "ok" | "err";

type Props = {
  series: string[];
  serieStatus?: Status[];
  serieMsgs?: string[];
  onChangeSerie: (index: number, valor: string) => void;
  onBlurSerie?: (index: number, valor: string) => void;
  onStatusSerie?: (index: number, status: Status, msg: string) => void;
  /** Unicidade no produto (entrada / nascimento). */
  produtoId?: string;
  validarNascimento?: boolean;
  /** Não exige o formato {codigo}{ano}{seq} — série antiga colada. */
  foraPadrao?: boolean;
  /** Retorno demo/comodato. */
  validarComoRetorno?: boolean;
};

/**
 * Série digitada livre: tipo que exige S/N em produto sem controle, ou
 * entrada de peça antiga com código padrão e número fora do formato atual.
 */
export function SerieCamposLivres({
  series,
  serieStatus: serieStatusProp,
  serieMsgs: serieMsgsProp,
  onChangeSerie,
  onBlurSerie,
  onStatusSerie,
  produtoId,
  validarNascimento,
  foraPadrao,
  validarComoRetorno,
}: Props) {
  const validaRemoto = Boolean(validarNascimento || validarComoRetorno);
  const [localStatus, setLocalStatus] = useState<Status[]>([]);
  const [localMsgs, setLocalMsgs] = useState<string[]>([]);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setLocalStatus([]);
    setLocalMsgs([]);
  }, [produtoId, foraPadrao]);

  useEffect(() => {
    const pendentes = timers.current;
    return () => {
      for (const t of Object.values(pendentes)) clearTimeout(t);
    };
  }, []);

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

  async function validarNascimentoCampo(idx: number, raw: string) {
    if (!validaRemoto || !produtoId) return;
    const numero = raw.trim();
    if (!numero) {
      setStatus(idx, "idle", "");
      return;
    }
    const dupLocal = series.findIndex(
      (s, i) =>
        i !== idx && s.trim().toUpperCase() === numero.toUpperCase()
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
        body: JSON.stringify({
          produtoId,
          numero,
          retorno: Boolean(validarComoRetorno),
          foraPadrao: Boolean(foraPadrao),
        }),
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

  function agendarValidacao(idx: number, valor: string) {
    if (!validaRemoto) return;
    if (timers.current[idx]) clearTimeout(timers.current[idx]);
    if (!valor.trim()) {
      setStatus(idx, "idle", "");
      return;
    }
    timers.current[idx] = setTimeout(() => {
      void validarNascimentoCampo(idx, valor);
    }, 400);
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-slate-600">
        Números de série ({series.length})
        <span className="ml-1 font-normal text-slate-500">
          {foraPadrao
            ? "— peça antiga: digite o número como está no equipamento."
            : "— exigidos por este tipo de operação. Digite o número como está no equipamento."}
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
                onChange={(e) => {
                  onChangeSerie(i, e.target.value);
                  setStatus(i, "idle", "");
                  agendarValidacao(i, e.target.value);
                }}
                onBlur={() => {
                  onBlurSerie?.(i, sn);
                  if (validaRemoto && sn.trim()) {
                    void validarNascimentoCampo(i, sn);
                  }
                }}
                placeholder={`Série ${i + 1}`}
                className={`w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm outline-none focus:ring-2 ${border}`}
              />
              {serieMsgs?.[i] ? (
                <p className="mt-0.5 text-[11px] text-rose-600">
                  {serieMsgs[i]}
                </p>
              ) : st === "ok" && validaRemoto ? (
                <p className="mt-0.5 text-[11px] text-emerald-700">
                  {validarComoRetorno
                    ? "Série da saída — pode retornar"
                    : "Série disponível"}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
