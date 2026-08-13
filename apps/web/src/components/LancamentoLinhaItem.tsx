"use client";

import { SeriesInput } from "@/components/SeriesInput";
import { SerieCamposPrefixo } from "@/components/SerieCamposPrefixo";
import { api } from "@/lib/api";
import { useEffect, useRef, useState } from "react";

export type LancamentoProduto = {
  id: string;
  codigo: string;
  descricao: string;
  precoUnitario?: string | number;
  controlaSerie?: boolean;
  configuracaoSerie?: {
    formato?: string;
    geracaoAutomatica?: boolean;
    tamanhoSequencial?: number;
    prefixoFixo?: string | null;
    sufixoFixo?: string | null;
  } | null;
};

export type SerieCampoStatus = "idle" | "checking" | "ok" | "err";

export type LancamentoLinha = {
  key: string;
  codigo: string;
  produto: LancamentoProduto | null;
  quantidade: string;
  series: string[];
  serieStatus: SerieCampoStatus[];
  serieMsgs: string[];
  saldo: number | null;
  alocacaoSerieId: string | null;
};

type Props = {
  linha: LancamentoLinha;
  index: number;
  canRemove: boolean;
  locked?: boolean;
  filialId: string;
  /** SAÍDA / TRANSFERÊNCIA — valida série no estoque origem/afetado */
  validarSerieEstoque: boolean;
  /**
   * ENTRADA ou transferência com baixa pela árvore:
   * qty primeiro → N caixas; séries nascem (não validar no estoque origem).
   */
  modoSerieNascimento?: boolean;
  /** ENTRADA sem retorno — permite gerar séries */
  podeGerarAutomatico: boolean;
  tipoNome?: string;
  onPatch: (partial: Partial<LancamentoLinha>) => void;
  onRemove: () => void;
  onError: (msg: string) => void;
  onMsg: (msg: string) => void;
};

function formatQty(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

async function fetchSaldo(produtoId: string, filialId: string) {
  const r = await api<{
    saldoAtual: string | number;
    disponivel?: string | number;
  }>(
    `/estoques/saldo?produtoId=${encodeURIComponent(produtoId)}&filialId=${encodeURIComponent(filialId)}`
  );
  if (r.disponivel != null) return Number(r.disponivel) || 0;
  return Number(r.saldoAtual) || 0;
}

export function newLancamentoLinha(
  partial?: Partial<LancamentoLinha>
): LancamentoLinha {
  return {
    key: partial?.key || `L-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    codigo: partial?.codigo || "",
    produto: partial?.produto || null,
    quantidade: partial?.quantidade || "1",
    series: partial?.series || [],
    serieStatus: partial?.serieStatus || [],
    serieMsgs: partial?.serieMsgs || [],
    saldo: partial?.saldo ?? null,
    alocacaoSerieId: partial?.alocacaoSerieId || null,
  };
}

export function LancamentoLinhaItem({
  linha,
  index,
  canRemove,
  locked,
  filialId,
  validarSerieEstoque,
  modoSerieNascimento = false,
  podeGerarAutomatico,
  tipoNome,
  onPatch,
  onRemove,
  onError,
  onMsg,
}: Props) {
  const [sugestoes, setSugestoes] = useState<LancamentoProduto[]>([]);
  const [gerando, setGerando] = useState(false);
  const [desfazendo, setDesfazendo] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const validTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>(
    {}
  );
  const linhaRef = useRef(linha);
  linhaRef.current = linha;

  const controlaSerie = Boolean(linha.produto?.controlaSerie);
  const qtdNum = Number(linha.quantidade);
  const qtdInt =
    Number.isFinite(qtdNum) && qtdNum > 0 ? Math.floor(qtdNum) : 0;

  useEffect(() => {
    if (!linha.produto?.id || !filialId) {
      if (linha.saldo != null) onPatch({ saldo: null });
      return;
    }
    let cancelled = false;
    void fetchSaldo(linha.produto.id, filialId)
      .then((s) => {
        if (!cancelled) onPatch({ saldo: s });
      })
      .catch(() => {
        if (!cancelled) onPatch({ saldo: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linha.produto?.id, filialId]);

  /** Ajusta array de séries ao mudar quantidade (modo campos N). */
  useEffect(() => {
    if (!controlaSerie) return;
    if (!validarSerieEstoque && !modoSerieNascimento) return;
    if (!Number.isFinite(qtdNum) || qtdNum <= 0) return;
    const n = Math.min(Math.floor(qtdNum), 200);
    const cur = linhaRef.current;
    if (cur.series.length === n && cur.serieStatus.length === n) return;
    const series = Array.from({ length: n }, (_, i) => cur.series[i] || "");
    const serieStatus: SerieCampoStatus[] = Array.from(
      { length: n },
      (_, i) => cur.serieStatus[i] || "idle"
    );
    const serieMsgs = Array.from(
      { length: n },
      (_, i) => cur.serieMsgs[i] || ""
    );
    onPatch({ series, serieStatus, serieMsgs, quantidade: String(n) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlaSerie, validarSerieEstoque, modoSerieNascimento, qtdInt]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchAbort.current?.abort();
      Object.values(validTimers.current).forEach(clearTimeout);
    };
  }, []);

  function onCodigoChange(value: string) {
    onPatch({
      codigo: value,
      produto: null,
      series: [],
      serieStatus: [],
      serieMsgs: [],
      alocacaoSerieId: null,
      saldo: null,
    });
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchAbort.current?.abort();
    if (!value.trim()) {
      setSugestoes([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const ac = new AbortController();
      searchAbort.current = ac;
      try {
        const list = await api<LancamentoProduto[]>(
          `/produtos/busca?q=${encodeURIComponent(value.trim())}`,
          { signal: ac.signal }
        );
        if (!ac.signal.aborted) setSugestoes(list);
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSugestoes([]);
      }
    }, 250);
  }

  async function buscarProduto(code: string) {
    if (!code.trim()) {
      onPatch({ produto: null });
      return null;
    }
    const list = await api<LancamentoProduto[]>(
      `/produtos/busca?q=${encodeURIComponent(code.trim())}`
    );
    const exact = list.find(
      (p) => p.codigo.toLowerCase() === code.trim().toLowerCase()
    );
    if (!exact) {
      setSugestoes(list);
      onError(
        list.length
          ? `Linha ${index + 1}: selecione o produto na lista`
          : `Linha ${index + 1}: produto não encontrado`
      );
      onPatch({ produto: null });
      return null;
    }
    setSugestoes([]);
    onPatch({
      produto: exact,
      codigo: exact.codigo,
      series: [],
      serieStatus: [],
      serieMsgs: [],
      alocacaoSerieId: null,
    });
    return exact;
  }

  function selecionarProduto(p: LancamentoProduto) {
    setSugestoes([]);
    onPatch({
      produto: p,
      codigo: p.codigo,
      series: [],
      serieStatus: [],
      serieMsgs: [],
      alocacaoSerieId: null,
    });
  }

  async function validarSerieCampo(idx: number, valor: string) {
    const cur = linhaRef.current;
    const numero = valor.trim();
    if (!validarSerieEstoque || !cur.produto?.id || !filialId || !numero) {
      const serieStatus = [...cur.serieStatus];
      const serieMsgs = [...cur.serieMsgs];
      serieStatus[idx] = "idle";
      serieMsgs[idx] = "";
      onPatch({ serieStatus, serieMsgs });
      return;
    }
    const dup = cur.series.findIndex(
      (s, i) => i !== idx && s.trim().toUpperCase() === numero.toUpperCase()
    );
    if (dup >= 0) {
      const serieStatus = [...cur.serieStatus];
      const serieMsgs = [...cur.serieMsgs];
      serieStatus[idx] = "err";
      serieMsgs[idx] = "Série duplicada nesta linha";
      onPatch({ serieStatus, serieMsgs });
      return;
    }

    {
      const serieStatus = [...cur.serieStatus];
      const serieMsgs = [...cur.serieMsgs];
      serieStatus[idx] = "checking";
      serieMsgs[idx] = "";
      onPatch({ serieStatus, serieMsgs });
    }

    const produtoId = cur.produto.id;
    try {
      const r = await api<{
        ok: boolean;
        motivo?: string | null;
        numeroSerie?: string;
      }>("/series/validar-saida", {
        method: "POST",
        body: JSON.stringify({
          produtoId,
          filialId,
          numero,
        }),
      });
      // Usa estado atual (outras séries podem ter mudado durante o await)
      const latest = linhaRef.current;
      const nextStatus = [...latest.serieStatus];
      const nextMsgs = [...latest.serieMsgs];
      const nextSeries = [...latest.series];
      // Garante tamanho se quantidade mudou no meio
      while (nextStatus.length < idx + 1) nextStatus.push("idle");
      while (nextMsgs.length < idx + 1) nextMsgs.push("");
      while (nextSeries.length < idx + 1) nextSeries.push("");
      if (r.numeroSerie) nextSeries[idx] = r.numeroSerie;
      nextStatus[idx] = r.ok ? "ok" : "err";
      nextMsgs[idx] = r.ok ? "" : r.motivo || "Série indisponível";
      onPatch({
        series: nextSeries,
        serieStatus: nextStatus,
        serieMsgs: nextMsgs,
      });
    } catch (e) {
      const latest = linhaRef.current;
      const nextStatus = [...latest.serieStatus];
      const nextMsgs = [...latest.serieMsgs];
      while (nextStatus.length < idx + 1) nextStatus.push("idle");
      while (nextMsgs.length < idx + 1) nextMsgs.push("");
      nextStatus[idx] = "err";
      nextMsgs[idx] =
        e instanceof Error ? e.message : "Falha ao validar série";
      onPatch({ serieStatus: nextStatus, serieMsgs: nextMsgs });
    }
  }

  function onSerieChange(idx: number, valor: string) {
    const cur = linhaRef.current;
    const series = [...cur.series];
    series[idx] = valor;
    const serieStatus = [...cur.serieStatus];
    const serieMsgs = [...cur.serieMsgs];
    while (serieStatus.length < series.length) serieStatus.push("idle");
    while (serieMsgs.length < series.length) serieMsgs.push("");
    serieStatus[idx] = "idle";
    serieMsgs[idx] = "";
    onPatch({ series, serieStatus, serieMsgs });
    if (!validarSerieEstoque) return;
    if (validTimers.current[idx]) clearTimeout(validTimers.current[idx]);
    validTimers.current[idx] = setTimeout(() => {
      void validarSerieCampo(idx, valor);
    }, 400);
  }

  const usaCamposSerieNascimento = controlaSerie && modoSerieNascimento;
  const usaCamposSerieEstoque = controlaSerie && validarSerieEstoque;
  const usaSeriesInput =
    controlaSerie && !validarSerieEstoque && !modoSerieNascimento;

  return (
    <div
      className={
        controlaSerie
          ? "rounded-lg border border-emerald-200 bg-emerald-50 p-3"
          : "rounded-lg border border-slate-200 bg-slate-50/40 p-3"
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">
          Item {index + 1}
          {controlaSerie ? (
            <span className="ml-2 text-xs font-normal text-emerald-800/80">
              · com série
            </span>
          ) : null}
        </span>
        {canRemove && !locked ? (
          <button
            type="button"
            className="text-xs text-rose-600 hover:underline"
            onClick={onRemove}
          >
            Remover
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <label className="relative block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Código / produto
          </span>
          <input
            value={linha.codigo}
            disabled={locked}
            onChange={(e) => onCodigoChange(e.target.value)}
            onBlur={() => {
              setTimeout(() => {
                if (linha.codigo.trim() && !linha.produto) {
                  void buscarProduto(linha.codigo);
                }
              }, 150);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (
                !linha.produto ||
                linha.produto.codigo.toLowerCase() !==
                  linha.codigo.trim().toLowerCase()
              ) {
                e.preventDefault();
                void buscarProduto(linha.codigo);
              }
            }}
            className="w-full rounded-lg border bg-white px-3 py-2.5 font-mono text-sm disabled:bg-slate-50"
            placeholder="Ex: TMP-1088-W"
            autoComplete="off"
          />
          {sugestoes.length > 0 && !linha.produto && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-white shadow-lg">
              {sugestoes.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      selecionarProduto(p);
                    }}
                  >
                    <span className="font-mono text-xs">{p.codigo}</span> —{" "}
                    {p.descricao}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Qtd
          </span>
          <input
            type="number"
            min={controlaSerie ? 1 : 0.0001}
            step={controlaSerie ? 1 : "any"}
            required
            disabled={locked && !controlaSerie}
            value={
              usaSeriesInput
                ? linha.series.length || linha.quantidade
                : linha.quantidade
            }
            readOnly={usaSeriesInput}
            onChange={(e) => onPatch({ quantidade: e.target.value })}
            className="w-full rounded-lg border bg-white px-3 py-2.5 text-sm disabled:bg-slate-50"
          />
        </label>
      </div>

      {linha.produto && (
        <div className="mt-2 text-xs text-slate-600">
          <span className="font-medium text-slate-800">
            {linha.produto.descricao}
          </span>
          {" · "}
          Saldo:{" "}
          <strong>
            {linha.saldo === null ? "…" : formatQty(linha.saldo)}
          </strong>
        </div>
      )}

      {usaCamposSerieNascimento && qtdInt > 0 && linha.produto ? (
        <SerieCamposPrefixo
          codigoProduto={linha.produto.codigo}
          produtoId={linha.produto.id}
          config={linha.produto.configuracaoSerie}
          series={linha.series}
          serieStatus={linha.serieStatus}
          serieMsgs={linha.serieMsgs}
          validarEstoque={false}
          validarNascimento
          onChangeSerie={(i, full) => onSerieChange(i, full)}
          onStatusSerie={(i, status, msg) => {
            const cur = linhaRef.current;
            const serieStatus = [...cur.serieStatus];
            const serieMsgs = [...cur.serieMsgs];
            while (serieStatus.length < i + 1) serieStatus.push("idle");
            while (serieMsgs.length < i + 1) serieMsgs.push("");
            serieStatus[i] = status;
            serieMsgs[i] = msg;
            onPatch({ serieStatus, serieMsgs });
          }}
        />
      ) : null}

      {usaCamposSerieEstoque && qtdInt > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium text-slate-600">
            Números de série ({qtdInt}) — digite o código completo da unidade
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {linha.series.map((sn, i) => {
              const st = linha.serieStatus[i] || "idle";
              const border =
                st === "ok"
                  ? "border-emerald-400 focus:ring-emerald-200"
                  : st === "err"
                    ? "border-rose-400 focus:ring-rose-200"
                    : st === "checking"
                      ? "border-amber-300"
                      : "border-slate-200";
              return (
                <div key={i}>
                  <input
                    value={sn}
                    onChange={(e) => onSerieChange(i, e.target.value)}
                    onBlur={() => void validarSerieCampo(i, sn)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void validarSerieCampo(i, sn);
                      }
                    }}
                    placeholder={`Série ${i + 1}`}
                    className={`w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm ${border}`}
                  />
                  {linha.serieMsgs[i] ? (
                    <p className="mt-0.5 text-[11px] text-rose-600">
                      {linha.serieMsgs[i]}
                    </p>
                  ) : st === "ok" ? (
                    <p className="mt-0.5 text-[11px] text-emerald-700">
                      Disponível no estoque
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {usaSeriesInput ? (
        <div className="mt-3">
          <SeriesInput
            key={linha.produto?.id || linha.key}
            value={linha.series}
            onChange={(series) =>
              onPatch({ series, quantidade: String(series.length || 1) })
            }
            gerando={gerando}
            desfazendo={desfazendo}
            alocacaoPendenteId={linha.alocacaoSerieId}
            formatoDica={linha.produto?.configuracaoSerie?.formato}
            podeGerarAutomatico={
              podeGerarAutomatico &&
              linha.produto?.configuracaoSerie?.geracaoAutomatica !== false &&
              !/rma/i.test(tipoNome || "")
            }
            onDesfazerAlocacao={async () => {
              if (!linha.alocacaoSerieId) return;
              setDesfazendo(true);
              try {
                await api("/series/alocar/desfazer", {
                  method: "POST",
                  body: JSON.stringify({ alocacaoId: linha.alocacaoSerieId }),
                });
                onPatch({ series: [], alocacaoSerieId: null, quantidade: "1" });
                onMsg("Geração desfeita — números devolvidos ao contador.");
              } catch (err) {
                onError(
                  err instanceof Error
                    ? err.message
                    : "Falha ao desfazer geração"
                );
              } finally {
                setDesfazendo(false);
              }
            }}
            onGerarAutomatico={async (quantidade) => {
              if (!linha.produto?.id) return;
              if (linha.alocacaoSerieId) {
                if (
                  !confirm(
                    "Há uma geração pendente. Desfazer e gerar de novo?"
                  )
                ) {
                  return;
                }
                setDesfazendo(true);
                try {
                  await api("/series/alocar/desfazer", {
                    method: "POST",
                    body: JSON.stringify({
                      alocacaoId: linha.alocacaoSerieId,
                    }),
                  });
                  onPatch({ alocacaoSerieId: null, series: [] });
                } catch (err) {
                  onError(
                    err instanceof Error
                      ? err.message
                      : "Falha ao desfazer geração anterior"
                  );
                  return;
                } finally {
                  setDesfazendo(false);
                }
              } else if (
                linha.series.length > 0 &&
                !confirm(
                  `Já há ${linha.series.length} série(s). Gerar de novo substitui a lista. Continuar?`
                )
              ) {
                return;
              }
              setGerando(true);
              try {
                const out = await api<{
                  series: string[];
                  alocacaoId?: string;
                }>("/series/alocar", {
                  method: "POST",
                  body: JSON.stringify({
                    produtoId: linha.produto.id,
                    quantidade,
                  }),
                });
                const geradas = out.series || [];
                if (!geradas.length) {
                  onError("Nenhuma série gerada");
                  return;
                }
                onPatch({
                  series: geradas,
                  quantidade: String(geradas.length),
                  alocacaoSerieId: out.alocacaoId || null,
                });
                onMsg(
                  `${geradas.length} série(s) gerada(s). Confirme o lançamento para entrar no estoque.`
                );
              } catch (err) {
                onError(
                  err instanceof Error ? err.message : "Falha ao gerar séries"
                );
              } finally {
                setGerando(false);
              }
            }}
            label="Números de série (gerar ou informar)"
          />
        </div>
      ) : null}
    </div>
  );
}
