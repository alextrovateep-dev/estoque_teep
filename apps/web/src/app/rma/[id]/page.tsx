"use client";

import { api, apiUpload, getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import { resolveAssetUrl } from "@/lib/assets";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { SIGLA_ESTOQUE_DESCARTE } from "@teep/shared";

type RmaAnexo = {
  id: string;
  tipo: string;
  arquivo: string;
  label?: string | null;
  itemId?: string | null;
  ativo?: boolean;
  substituidoEm?: string | null;
  criadoEm?: string;
};

type MovVinculo = {
  id: string;
  status: string;
  dataMovimento?: string;
  transferenciaItem?: { transferenciaId: string } | null;
};

type Rma = {
  id: string;
  status: string;
  cobrou: boolean | null;
  valorCobrado: string | number | null;
  nfCobrancaNumero: string | null;
  nfEntradaNumero: string | null;
  nfSaidaNumero: string | null;
  observacao: string | null;
  criadoEm: string;
  cliente: { id: string; nome: string; documento?: string | null };
  filial: { id: string; sigla: string; nome: string };
  criadoPor: { nome: string };
  anexos: RmaAnexo[];
  itens: Array<{
    id: string;
    status: string;
    produtoId: string;
    quantidade: string | number;
    observacao?: string | null;
    produto: { id: string; codigo: string; descricao: string };
    unidadeSerie?: { id: string; numeroSerie: string } | null;
    unidadeSerieSubstituicao?: { id: string; numeroSerie: string } | null;
    anexos?: RmaAnexo[];
    movEntradaId?: string | null;
    movSaidaId?: string | null;
    movDescarteId?: string | null;
    movEntrada?: MovVinculo | null;
    movSaida?: MovVinculo | null;
    movDescarte?: MovVinculo | null;
  }>;
};

const PROC_STATUS: Record<string, string> = {
  ABERTO: "Aberto",
  FECHADO: "Fechado",
  CANCELADO: "Cancelado",
};

const ITEM_STATUS: Record<string, string> = {
  ABERTO: "Aberto",
  EM_ESTOQUE: "Em estoque RMA",
  SEM_MANUTENCAO: "Sem manutenção",
  DEVOLVIDO: "Devolvido",
  DESCARTADO: "Descartado / trocado",
  CANCELADO: "Cancelado",
};

type FilialOpt = { id: string; nome: string; sigla: string; ativo?: boolean };
type SerieOpt = { id: string; numeroSerie: string };

type RmaDefaults = {
  filialPreparacaoId: string | null;
  filialDescarteId: string | null;
  filiaisOrigemTrocaIds: string[];
  filiaisOrigemTroca: FilialOpt[];
  avisos?: string[];
};

/** Nome curto para UI; nome completo fica no title. */
function nomeAnexoCurto(label?: string | null, fallback = "Abrir arquivo") {
  const raw = (label || fallback).trim();
  if (raw.length <= 28) return raw;
  const dot = raw.lastIndexOf(".");
  const ext = dot > 0 && raw.length - dot <= 8 ? raw.slice(dot) : "";
  const base = ext ? raw.slice(0, raw.length - ext.length) : raw;
  return `${base.slice(0, 22)}…${ext}`;
}

function anexoAtivoPorTipo(anexos: RmaAnexo[], tipo: string) {
  return anexos.find((a) => a.tipo === tipo && a.ativo !== false) || null;
}

function hrefMovimentacaoPorSerie(numeroSerie?: string | null) {
  const sn = (numeroSerie || "").trim();
  if (!sn) return "/movimentacoes";
  return `/movimentacoes?serie=${encodeURIComponent(sn)}`;
}

function ItemMovLinks({ item }: { item: Rma["itens"][0] }) {
  const snRuim = item.unidadeSerie?.numeroSerie || null;
  const snBoa = item.unidadeSerieSubstituicao?.numeroSerie || null;
  const movRuim = hrefMovimentacaoPorSerie(snRuim);
  const movBoa = hrefMovimentacaoPorSerie(snBoa);
  const isTroca = Boolean(snBoa && (item.movDescarte || item.movDescarteId));
  const links: Array<{ key: string; label: string; href: string }> = [];

  if (item.movEntrada || item.movEntradaId) {
    links.push({ key: "ent", label: "Entrada", href: movRuim });
  }
  if (item.movSaida || item.movSaidaId) {
    links.push({
      key: "sai",
      label: isTroca ? "Saída (série boa)" : "Saída / devolução",
      href: isTroca ? movBoa : movRuim,
    });
  }
  if (item.movDescarte || item.movDescarteId) {
    const tid = item.movDescarte?.transferenciaItem?.transferenciaId;
    links.push({
      key: "desc",
      label: tid ? "Transf. descarte" : "Descarte",
      href: tid ? `/transferencias/${tid}` : movRuim,
    });
  }

  if (!links.length) return null;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
      <span className="font-medium text-slate-600">Histórico:</span>
      {links.map((l, idx) => (
        <span key={l.key} className="inline-flex items-center gap-2">
          {idx > 0 && <span className="text-slate-300">·</span>}
          <Link
            href={l.href}
            className="text-brand underline underline-offset-2"
            title={l.label}
          >
            {l.label}
          </Link>
        </span>
      ))}
    </p>
  );
}

export default function RmaDetalhePage() {
  const params = useParams();
  const id = String(params.id || "");
  const user = getStoredUser();
  const canFin = Boolean(user && userHas(user, "rma_cobranca"));

  const [row, setRow] = useState<Rma | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);

  const [cobrou, setCobrou] = useState<"" | "true" | "false">("");
  const [valor, setValor] = useState("");
  const [nfCob, setNfCob] = useState("");
  const [nfEnt, setNfEnt] = useState("");
  const [nfSai, setNfSai] = useState("");
  const [obs, setObs] = useState("");

  /** Item com painel de troca aberto */
  const [trocaItemId, setTrocaItemId] = useState<string | null>(null);
  const [filiais, setFiliais] = useState<FilialOpt[]>([]);
  const [rmaDefaults, setRmaDefaults] = useState<RmaDefaults | null>(null);
  const [origemFilialId, setOrigemFilialId] = useState("");
  const [destinoDescarteId, setDestinoDescarteId] = useState("");
  const [serieBoa, setSerieBoa] = useState("");
  const [seriesDisp, setSeriesDisp] = useState<SerieOpt[]>([]);
  const [trocaObs, setTrocaObs] = useState("");

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      setError("");
      try {
        const r = await api<Rma>(`/rma/${id}`);
        if (signal?.cancelled) return;
        setRow(r);
        setCobrou(
          r.cobrou === true ? "true" : r.cobrou === false ? "false" : ""
        );
        setValor(r.valorCobrado != null ? String(r.valorCobrado) : "");
        setNfCob(r.nfCobrancaNumero || "");
        setNfEnt(r.nfEntradaNumero || "");
        setNfSai(r.nfSaidaNumero || "");
        setObs(r.observacao || "");
      } catch (e) {
        if (signal?.cancelled) return;
        setError(e instanceof Error ? e.message : "Erro");
      }
    },
    [id]
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  async function salvarFinanceiro(e: FormEvent) {
    e.preventDefault();
    if (!canFin || actingRef.current) return;
    if (row?.status !== "ABERTO") {
      setError("Processo fechado ou cancelado — financeiro somente leitura");
      return;
    }
    if (cobrou === "true") {
      const v = Number(valor.replace(",", "."));
      if (!(v > 0)) {
        setError("Informe o valor cobrado (maior que zero)");
        return;
      }
      if (!nfCob.trim()) {
        setError("Informe o número da NF de cobrança");
        return;
      }
    }
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      const body: Record<string, unknown> = {
        nfEntradaNumero: nfEnt.trim() || null,
        nfSaidaNumero: nfSai.trim() || null,
        observacao: obs.trim() || null,
      };
      if (cobrou === "true") {
        body.cobrou = true;
        body.valorCobrado = Number(valor.replace(",", "."));
        body.nfCobrancaNumero = nfCob.trim();
      } else if (cobrou === "false") {
        body.cobrou = false;
      } else {
        body.cobrou = null;
      }
      await api(`/rma/${id}/financeiro`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setMsg("Dados financeiros salvos");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function uploadAnexo(tipo: string, file: File, itemId?: string) {
    if (actingRef.current) return;
    if (tipo === "LAUDO" && !itemId) {
      setError("Selecione o item (produto/série) para anexar o laudo");
      return;
    }
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("context", "rma");
      fd.append("kind", tipo === "LAUDO" ? "laudo" : "nf");
      const up = await apiUpload<{ url: string }>("/upload", fd);
      if (!up?.url || typeof up.url !== "string") {
        throw new Error("Upload não retornou o caminho do arquivo");
      }
      const labelRaw = file.name.trim();
      let label: string | null = null;
      if (labelRaw) {
        if (labelRaw.length <= 120) {
          label = labelRaw;
        } else {
          const dot = labelRaw.lastIndexOf(".");
          const ext =
            dot > 0 && labelRaw.length - dot <= 10 ? labelRaw.slice(dot) : "";
          label = ext
            ? `${labelRaw.slice(0, Math.max(1, 120 - ext.length))}${ext}`
            : labelRaw.slice(0, 120);
        }
      }
      await api(`/rma/${id}/anexos`, {
        method: "POST",
        body: JSON.stringify({
          tipo,
          arquivo: up.url,
          label,
          ...(itemId ? { itemId } : {}),
        }),
      });
      setMsg(
        tipo === "LAUDO"
          ? "Laudo atualizado"
          : tipo.startsWith("NF")
            ? "Nota atualizada"
            : "Anexo enviado"
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function devolver(itemIds?: string[]) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/devolver`, {
        method: "POST",
        body: JSON.stringify({
          itemIds,
          nfSaidaNumero: nfSai.trim() || undefined,
        }),
      });
      setMsg("Devolução ao cliente lançada");
      setTrocaItemId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function marcarSemManutencao(itemIds: string[]) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/sem-manutencao`, {
        method: "POST",
        body: JSON.stringify({ itemIds }),
      });
      setMsg("Item marcado como sem manutenção");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function abrirTroca(item: Rma["itens"][0]) {
    setError("");
    setTrocaItemId(item.id);
    setSerieBoa("");
    setTrocaObs("");
    setSeriesDisp([]);
    try {
      const [list, defs] = await Promise.all([
        api<FilialOpt[]>("/filiais"),
        api<RmaDefaults>("/rma/defaults"),
      ]);
      const ativas = (list || []).filter((f) => f.ativo !== false);
      setFiliais(ativas);
      setRmaDefaults(defs);

      // Defaults vêm da API (env ou fallback por sigla de instalação) — sem preferir estoques fixos
      const descarteId = defs.filialDescarteId || "";
      setDestinoDescarteId(
        descarteId && descarteId !== row?.filial.id ? descarteId : ""
      );

      const origemPadrao = (defs.filiaisOrigemTroca || []).find(
        (f) => f.id !== row?.filial.id
      );
      setOrigemFilialId(origemPadrao?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar estoques");
    }
  }

  useEffect(() => {
    if (!trocaItemId || !origemFilialId || !row) {
      setSeriesDisp([]);
      return;
    }
    const item = row.itens.find((i) => i.id === trocaItemId);
    const produtoId = item?.produtoId || item?.produto?.id;
    if (!produtoId) {
      return;
    }
    let cancelled = false;
    api<SerieOpt[]>(
      `/series/disponiveis?produtoId=${encodeURIComponent(produtoId)}&filialId=${encodeURIComponent(origemFilialId)}`
    )
      .then((rows) => {
        if (!cancelled) setSeriesDisp(rows || []);
      })
      .catch(() => {
        if (!cancelled) setSeriesDisp([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trocaItemId, origemFilialId, row]);

  async function confirmarTroca() {
    if (!trocaItemId || actingRef.current) return;
    if (!origemFilialId) {
      setError("Selecione o estoque de origem da peça boa");
      return;
    }
    if (!serieBoa.trim()) {
      setError("Informe a série substituta");
      return;
    }
    if (!destinoDescarteId) {
      setError("Selecione o estoque de descarte");
      return;
    }
    if (
      !confirm(
        "Confirmar troca? A série boa será transferida e expedida ao cliente; a série ruim vai ao descarte."
      )
    ) {
      return;
    }
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/trocar`, {
        method: "POST",
        body: JSON.stringify({
          itemId: trocaItemId,
          origemFilialId,
          numeroSerieBoa: serieBoa.trim(),
          destinoDescarteFilialId: destinoDescarteId,
          nfSaidaNumero: nfSai.trim() || undefined,
          observacao: trocaObs.trim() || undefined,
        }),
      });
      setMsg("Troca concluída");
      setTrocaItemId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  if (!row && !error) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }
  if (!row) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }

  const noRma = row.itens.filter(
    (i) => i.status === "EM_ESTOQUE" || i.status === "SEM_MANUTENCAO"
  );
  const processoAberto = row.status === "ABERTO";
  const canEditFin = canFin && processoAberto;

  return (
    <>
      <div className="mb-2">
        <Link href="/rma" className="text-sm text-brand underline">
          ← Voltar
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">RMA</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">
          {PROC_STATUS[row.status] || row.status}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {row.cliente.nome} · estoque {row.filial.sigla} — {row.filial.nome} ·
        por {row.criadoPor.nome} ·{" "}
        {new Date(row.criadoEm).toLocaleString("pt-BR")}
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {msg && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      )}

      <section className="mt-4 rounded-xl border bg-white px-3 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Financeiro</h2>
            <p className="text-[11px] text-slate-500">
              1 NF entrada e 1 NF saída por RMA. Outra nota = novo RMA.
              {!canFin && " Somente leitura."}
              {canFin &&
                !processoAberto &&
                " Processo fechado — somente leitura."}
            </p>
          </div>
          {canEditFin && (
            <button
              type="submit"
              form="rma-financeiro-form"
              disabled={acting}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Salvar financeiro
            </button>
          )}
        </div>

        <form
          id="rma-financeiro-form"
          onSubmit={(e) => void salvarFinanceiro(e)}
          className="mt-2 grid gap-2 sm:grid-cols-3"
        >
          <label className="block text-xs">
            <span className="mb-0.5 block font-medium text-slate-600">
              NF entrada
            </span>
            <input
              disabled={!canEditFin || acting}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
              value={nfEnt}
              onChange={(e) => setNfEnt(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-0.5 block font-medium text-slate-600">
              NF saída
            </span>
            <input
              disabled={!canEditFin || acting}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
              value={nfSai}
              onChange={(e) => setNfSai(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-0.5 block font-medium text-slate-600">
              Gerou cobrança?
            </span>
            <select
              disabled={!canEditFin || acting}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
              value={cobrou}
              onChange={(e) =>
                setCobrou(e.target.value as "" | "true" | "false")
              }
            >
              <option value="">Não informado</option>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select>
          </label>
          {cobrou === "true" && (
            <>
              <label className="block text-xs">
                <span className="mb-0.5 block font-medium text-slate-600">
                  Valor cobrado *
                </span>
                <input
                  disabled={!canEditFin || acting}
                  required
                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                />
              </label>
              <label className="block text-xs sm:col-span-2">
                <span className="mb-0.5 block font-medium text-slate-600">
                  NF cobrança *
                </span>
                <input
                  disabled={!canEditFin || acting}
                  required
                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
                  value={nfCob}
                  onChange={(e) => setNfCob(e.target.value)}
                />
              </label>
            </>
          )}
          <label className="block text-xs sm:col-span-3">
            <span className="mb-0.5 block font-medium text-slate-600">
              Observação
            </span>
            <input
              disabled={!canEditFin || acting}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Opcional"
            />
          </label>
        </form>

        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Arquivos do RMA
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["NF_ENTRADA", "NF entrada"],
                ["NF_SAIDA", "NF saída"],
                ["NF_COBRANCA", "NF cobrança"],
              ] as const
            ).map(([tipo, titulo]) => {
              const atual = anexoAtivoPorTipo(row.anexos, tipo);
              const hist = row.anexos.filter(
                (a) => a.tipo === tipo && a.ativo === false
              );
              return (
                <div
                  key={tipo}
                  className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      {titulo}
                    </span>
                    {canEditFin && (
                      <label className="shrink-0 cursor-pointer text-[11px] font-medium text-brand underline underline-offset-2">
                        {atual ? "Trocar" : "Anexar"}
                        <input
                          type="file"
                          className="hidden"
                          disabled={acting}
                          accept=".pdf,image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadAnexo(tipo, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                  {atual ? (
                    <a
                      href={resolveAssetUrl(atual.arquivo) || "#"}
                      target="_blank"
                      rel="noreferrer"
                      title={atual.label || titulo}
                      className="truncate text-xs text-brand underline underline-offset-2"
                    >
                      {nomeAnexoCurto(atual.label, "Ver arquivo")}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">Sem arquivo</span>
                  )}
                  {hist.length > 0 && (
                    <details className="text-[11px] text-slate-500">
                      <summary className="cursor-pointer select-none">
                        Anteriores ({hist.length})
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {hist.map((a) => (
                          <li key={a.id} className="min-w-0">
                            <a
                              href={resolveAssetUrl(a.arquivo) || "#"}
                              target="_blank"
                              rel="noreferrer"
                              title={a.label || titulo}
                              className="block truncate text-brand underline"
                            >
                              {nomeAnexoCurto(a.label, "Arquivo")}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">Itens / Estoque</h2>
            <p className="text-[11px] text-slate-500">
              Sem manutenção → retornar a mesma série ou trocar (peça boa +
              descarte da ruim). Fechar o processo é independente do destino do
              item.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {row.status === "ABERTO" && (
              <button
                type="button"
                disabled={acting}
                onClick={() => {
                  if (
                    !confirm(
                      noRma.length > 0
                        ? "Cancelar RMA e estornar as entradas do Estoque RMA?"
                        : "Cancelar este processo RMA?"
                    )
                  ) {
                    return;
                  }
                  void (async () => {
                    if (actingRef.current) return;
                    actingRef.current = true;
                    setActing(true);
                    setError("");
                    setMsg("");
                    try {
                      await api(`/rma/${id}/cancelar`, { method: "POST" });
                      setMsg("Processo cancelado");
                      await load();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Erro");
                    } finally {
                      actingRef.current = false;
                      setActing(false);
                    }
                  })();
                }}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
              >
                Cancelar RMA
              </button>
            )}
            {noRma.length > 0 && (
              <button
                type="button"
                disabled={acting}
                onClick={() => {
                  if (
                    !confirm(
                      `Devolver ${noRma.length} item(ns) ao cliente? Esta ação lança saída no Estoque RMA.`
                    )
                  ) {
                    return;
                  }
                  void devolver();
                }}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Devolver todos ao cliente
              </button>
            )}
          </div>
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {row.itens.map((i) => {
            const laudosById = new Map<string, RmaAnexo>();
            for (const a of i.anexos || []) {
              if (a.tipo === "LAUDO") laudosById.set(a.id, a);
            }
            for (const a of row.anexos) {
              if (a.tipo === "LAUDO" && a.itemId === i.id) {
                laudosById.set(a.id, a);
              }
            }
            const laudosItem = [...laudosById.values()];
            const laudo =
              laudosItem.find((a) => a.ativo !== false) || null;
            const laudosHist = laudosItem.filter((a) => a.ativo === false);
            const origemIds = new Set(rmaDefaults?.filiaisOrigemTrocaIds || []);
            const descarteId = rmaDefaults?.filialDescarteId;
            const filiaisOrigem = filiais.filter((f) => {
              if (f.id === row.filial.id) return false;
              if (descarteId && f.id === descarteId) return false;
              if (
                !descarteId &&
                f.sigla.toUpperCase() === SIGLA_ESTOQUE_DESCARTE
              ) {
                return false;
              }
              if (origemIds.size > 0) return origemIds.has(f.id);
              return true;
            });
            const filiaisDescarte = filiais.filter((f) => f.id !== row.filial.id);
            return (
              <li
                key={i.id}
                className="rounded-lg border border-slate-100 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold">
                    {ITEM_STATUS[i.status] || i.status}
                  </span>
                  <span className="font-mono text-xs">{i.produto.codigo}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {i.produto.descricao}
                  </span>
                  {i.unidadeSerie && (
                    <span className="font-mono text-[10px] text-slate-600">
                      S/N {i.unidadeSerie.numeroSerie}
                    </span>
                  )}
                  {i.unidadeSerieSubstituicao && (
                    <span className="font-mono text-[10px] text-emerald-700">
                      → {i.unidadeSerieSubstituicao.numeroSerie}
                    </span>
                  )}
                  {processoAberto && i.status === "EM_ESTOQUE" && (
                    <span className="ml-auto flex shrink-0 flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        disabled={acting}
                        className="text-slate-700 underline disabled:opacity-50"
                        onClick={() => void marcarSemManutencao([i.id])}
                      >
                        Sem manutenção
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        className="text-brand underline disabled:opacity-50"
                        onClick={() => void devolver([i.id])}
                      >
                        Devolver
                      </button>
                    </span>
                  )}
                  {processoAberto && i.status === "SEM_MANUTENCAO" && (
                    <span className="ml-auto flex shrink-0 flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        disabled={acting}
                        className="text-brand underline disabled:opacity-50"
                        onClick={() => void devolver([i.id])}
                      >
                        Retornar ao cliente
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        className="text-amber-800 underline disabled:opacity-50"
                        onClick={() => void abrirTroca(i)}
                      >
                        Trocar
                      </button>
                    </span>
                  )}
                </div>
                <ItemMovLinks item={i} />
                {trocaItemId === i.id && (
                  <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs">
                    <p className="font-medium text-amber-950">
                      Troca — peça boa de outro estoque; série ruim vai ao
                      descarte
                    </p>
                    {rmaDefaults?.avisos && rmaDefaults.avisos.length > 0 && (
                      <p className="rounded border border-amber-300 bg-amber-100/80 px-2 py-1 text-[10px] text-amber-950">
                        {rmaDefaults.avisos.join(" · ")}
                      </p>
                    )}
                    <label className="block">
                      <span className="text-slate-600">Origem da peça boa</span>
                      <select
                        className="mt-0.5 w-full rounded border px-2 py-1.5"
                        value={origemFilialId}
                        onChange={(e) => {
                          setOrigemFilialId(e.target.value);
                          setSerieBoa("");
                        }}
                      >
                        <option value="">Selecione…</option>
                        {filiaisOrigem.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.sigla} — {f.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-600">Série substituta</span>
                      {seriesDisp.length > 0 ? (
                        <select
                          className="mt-0.5 w-full rounded border px-2 py-1.5 font-mono"
                          value={serieBoa}
                          onChange={(e) => setSerieBoa(e.target.value)}
                        >
                          <option value="">Selecione…</option>
                          {seriesDisp.map((s) => (
                            <option key={s.id} value={s.numeroSerie}>
                              {s.numeroSerie}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="mt-0.5 w-full rounded border px-2 py-1.5 font-mono"
                          placeholder="Digite o S/N"
                          value={serieBoa}
                          onChange={(e) => setSerieBoa(e.target.value)}
                        />
                      )}
                      {origemFilialId && seriesDisp.length === 0 && (
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          Nenhuma série listada neste estoque — digite o S/N
                          manualmente
                        </span>
                      )}
                    </label>
                    <label className="block">
                      <span className="text-slate-600">
                        Destino da série ruim (descarte)
                      </span>
                      <select
                        className="mt-0.5 w-full rounded border px-2 py-1.5"
                        value={destinoDescarteId}
                        onChange={(e) => setDestinoDescarteId(e.target.value)}
                      >
                        <option value="">Selecione…</option>
                        {filiaisDescarte.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.sigla} — {f.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-600">Observação (opcional)</span>
                      <input
                        className="mt-0.5 w-full rounded border px-2 py-1.5"
                        value={trocaObs}
                        onChange={(e) => setTrocaObs(e.target.value)}
                        maxLength={500}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void confirmarTroca()}
                        className="rounded bg-amber-800 px-3 py-1.5 text-white disabled:opacity-50"
                      >
                        Confirmar troca
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => setTrocaItemId(null)}
                        className="rounded border px-3 py-1.5"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {i.observacao && i.status === "DESCARTADO" && (
                  <p className="mt-1 text-[11px] text-slate-500">{i.observacao}</p>
                )}
                <div className="relative mt-2 flex min-w-0 items-center gap-2 rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5 text-xs">
                  <span className="shrink-0 font-medium text-slate-600">
                    Laudo
                  </span>
                  {laudo ? (
                    <a
                      href={resolveAssetUrl(laudo.arquivo) || "#"}
                      target="_blank"
                      rel="noreferrer"
                      title={laudo.label || "Laudo"}
                      className="min-w-0 flex-1 truncate text-brand underline underline-offset-2"
                    >
                      {nomeAnexoCurto(laudo.label, "Ver laudo")}
                    </a>
                  ) : (
                    <span className="flex-1 text-slate-400">Sem laudo</span>
                  )}
                  {row.status === "ABERTO" && (
                    <label className="shrink-0 cursor-pointer font-medium text-brand underline underline-offset-2">
                      {laudo ? "Trocar arquivo" : "Anexar"}
                      <input
                        type="file"
                        className="hidden"
                        disabled={acting}
                        accept=".doc,.docx,.pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadAnexo("LAUDO", f, i.id);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  {laudosHist.length > 0 && (
                    <details className="relative shrink-0 text-slate-500">
                      <summary className="cursor-pointer">
                        Ant. ({laudosHist.length})
                      </summary>
                      <ul className="absolute right-0 z-10 mt-1 w-56 space-y-0.5 rounded border bg-white p-2 shadow">
                        {laudosHist.map((a) => (
                          <li key={a.id}>
                            <a
                              href={resolveAssetUrl(a.arquivo) || "#"}
                              target="_blank"
                              rel="noreferrer"
                              title={a.label || "Laudo"}
                              className="block truncate text-brand underline"
                            >
                              {nomeAnexoCurto(a.label, "Laudo")}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
