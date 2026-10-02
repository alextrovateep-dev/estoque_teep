"use client";

import { api, apiUpload } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import {
  LancamentoLinhaItem,
  newLancamentoLinha,
  type LancamentoLinha,
} from "@/components/LancamentoLinhaItem";
import {
  exigeSerieNoLancamento,
  formatCnpj,
  PEDIDO_STATUS_LABELS,
  type PedidoStatus,
  usaSerieLivre,
} from "@teep/shared";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  controlaSerie: boolean;
  ativo?: boolean;
};

type Item = {
  id: string;
  codigoProprio: string;
  descricao: string;
  quantidade: string | number;
  produtoId: string | null;
  produto: Produto | null;
};

type Dest = { id: string; nome: string; email: string };

type Cliente = {
  id: string;
  nome: string;
  documento: string | null;
  ativo?: boolean;
};

type Pedido = {
  id: string;
  egestorCodigo: number;
  nomeContato: string;
  documentoContato: string | null;
  clienteId: string | null;
  cliente?: Cliente | null;
  status: string;
  grupoLancamentoId: string | null;
  aguardandoAprovacao?: boolean;
  controleSerieSaida?: string | null;
  filialAcabado?: { id: string; sigla: string; nome: string } | null;
  liberadoEm?: string | null;
  transportadora?: string | null;
  rastreio?: string | null;
  nfNumero?: string | null;
  nfArquivo?: string | null;
  itens: Item[];
  destinatarios?: Array<{ usuario: Dest }>;
};

type Filial = { id: string; nome: string; sigla: string };

function n(v: string | number) {
  return Number(v) || 0;
}

function skuKey(codigo: string) {
  return codigo.trim().toLowerCase();
}

function assinaturaItens(itens: Item[]) {
  return itens
    .map((i) => `${skuKey(i.codigoProprio)}|${n(i.quantidade)}`)
    .sort()
    .join(";");
}

function linhaParaItem(itensLinha: LancamentoLinha[], it: Item, usados: Set<string>) {
  const byId = itensLinha.find((l) => l.key === it.id && !usados.has(l.key));
  if (byId) {
    usados.add(byId.key);
    return byId;
  }
  const bySku = itensLinha.find(
    (l) => !usados.has(l.key) && skuKey(l.codigo) === skuKey(it.codigoProprio)
  );
  if (bySku) {
    usados.add(bySku.key);
    return bySku;
  }
  return undefined;
}

function linhasFromPedido(p: Pedido, prev: LancamentoLinha[] = []): LancamentoLinha[] {
  const usados = new Set<string>();
  return p.itens.map((it) => {
    const qtd = n(it.quantidade);
    const pedeSerie = exigeSerieNoLancamento({
      produtoControlaSerie: it.produto?.controlaSerie,
      tipoControleSerie: p.controleSerieSaida,
    });
    const seriesLen = pedeSerie ? Math.max(1, Math.round(qtd)) : 0;
    const prevLinha = linhaParaItem(prev, it, usados);
    const seriesPrev = prevLinha?.series || [];
    return newLancamentoLinha({
      key: it.id,
      codigo: it.codigoProprio,
      produto: it.produto
        ? {
            id: it.produto.id,
            codigo: it.produto.codigo,
            descricao: it.produto.descricao,
            controlaSerie: it.produto.controlaSerie,
          }
        : null,
      quantidade: String(qtd),
      series: Array.from({ length: seriesLen }, (_, i) => seriesPrev[i] || ""),
      serieStatus: Array.from({ length: seriesLen }, () => "idle"),
      serieMsgs: Array.from({ length: seriesLen }, () => ""),
    });
  });
}

function statusLabel(status: string) {
  if (status === "ABERTO" || status === "SEPARADO" || status === "ENVIADO") {
    return PEDIDO_STATUS_LABELS[status as PedidoStatus];
  }
  return status;
}

function qtdLabel(v: string | number) {
  const x = n(v);
  return Number.isInteger(x) ? String(x) : String(x);
}

function ItensSomenteLeitura({ itens }: { itens: Item[] }) {
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {itens.map((it) => (
        <li key={it.id} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium">{it.codigoProprio}</p>
            <p className="text-sm text-slate-500">{it.descricao}</p>
          </div>
          <span className="shrink-0 text-sm tabular-nums text-slate-700">
            {qtdLabel(it.quantidade)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function PedidoDetalhePage() {
  const params = useParams();
  const id = String(params.id || "");
  const router = useRouter();
  const [row, setRow] = useState<Pedido | null>(null);
  const [acabados, setAcabados] = useState<Filial[]>([]);
  const [filialId, setFilialId] = useState("");
  const [linhas, setLinhas] = useState<LancamentoLinha[]>([]);
  const [destTodos, setDestTodos] = useState<Dest[]>([]);
  const [destIds, setDestIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [transportadora, setTransportadora] = useState("");
  const [rastreio, setRastreio] = useState("");
  const [nfNumero, setNfNumero] = useState("");
  const [nfArquivo, setNfArquivo] = useState("");
  const [uploadingNf, setUploadingNf] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api<Pedido>(`/pedidos/${id}`),
      api<Filial[]>("/pedidos/estoques-acabados"),
      api<Dest[]>("/pedidos/usuarios-destinatarios"),
    ])
      .then(([p, filiais, users]) => {
        setRow(p);
        setAcabados(filiais);
        setDestTodos(users);
        setFilialId(p.filialAcabado?.id || filiais[0]?.id || "");
        setDestIds((p.destinatarios || []).map((d) => d.usuario.id));
        setLinhas(linhasFromPedido(p));
        setTransportadora(p.transportadora || "");
        setRastreio(p.rastreio || "");
        setNfNumero(p.nfNumero || "");
        setNfArquivo(p.nfArquivo || "");
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Erro ao carregar")
      );
  }, [id]);

  const bloqueadoSku = useMemo(
    () => (row?.itens || []).some((i) => !i.produtoId),
    [row]
  );
  const bloqueadoCliente = useMemo(() => {
    if (!row || row.status !== "ABERTO") return false;
    return !row.clienteId || !row.documentoContato;
  }, [row]);
  const aguardaAprovacao = Boolean(row?.aguardandoAprovacao);
  const podeSeparar =
    row?.status === "ABERTO" &&
    !bloqueadoSku &&
    !bloqueadoCliente &&
    !aguardaAprovacao;
  const podeEnviar = row?.status === "SEPARADO";
  const somenteLeitura = row?.status === "SEPARADO" || row?.status === "ENVIADO";

  const cnpjLabel = row?.documentoContato
    ? formatCnpj(row.documentoContato)
    : null;

  function patchLinha(key: string, partial: Partial<LancamentoLinha>) {
    setLinhas((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...partial } : l))
    );
  }

  async function onSeparar(e: FormEvent) {
    e.preventDefault();
    if (!row || !podeSeparar) return;
    setError("");
    setSaving(true);
    try {
      const fresh = await api<Pedido>(`/pedidos/${row.id}`);
      if (fresh.status !== "ABERTO") {
        setRow(fresh);
        setError("Este pedido já não está em aberto.");
        return;
      }
      if (assinaturaItens(fresh.itens) !== assinaturaItens(row.itens)) {
        setRow(fresh);
        setLinhas(linhasFromPedido(fresh, linhas));
        setError(
          "O pedido foi atualizado pelo eGestor. Confira os itens e separe de novo."
        );
        return;
      }
      const usados = new Set<string>();
      const atualizado = await api<Pedido>(`/pedidos/${row.id}/separar`, {
        method: "POST",
        body: JSON.stringify({
          filialId,
          destinatarioIds: destIds,
          itens: fresh.itens.map((it) => {
            const linha = linhaParaItem(linhas, it, usados);
            return {
              id: it.id,
              quantidade: n(it.quantidade),
              series:
                linha?.produto &&
                exigeSerieNoLancamento({
                  produtoControlaSerie: linha.produto.controlaSerie,
                  tipoControleSerie: fresh.controleSerieSaida,
                })
                  ? (linha.series || []).map((s) => s.trim()).filter(Boolean)
                  : undefined,
            };
          }),
        }),
      });
      if (atualizado.status === "SEPARADO") {
        router.push("/pedidos?status=SEPARADO");
        return;
      }
      setRow(atualizado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao separar");
    } finally {
      setSaving(false);
    }
  }

  async function onEnviar(e: FormEvent) {
    e.preventDefault();
    if (!row || !podeEnviar) return;
    if (!nfArquivo) {
      setError("Anexe a nota fiscal para enviar.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const atualizado = await api<Pedido>(`/pedidos/${row.id}/enviar`, {
        method: "POST",
        body: JSON.stringify({
          transportadora: transportadora.trim(),
          rastreio: rastreio.trim(),
          nfNumero: nfNumero.trim(),
          nfArquivo,
        }),
      });
      if (atualizado.status === "ENVIADO") {
        router.push("/pedidos?status=ENVIADO");
        return;
      }
      setRow(atualizado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setSaving(false);
    }
  }

  async function onNfFile(file: File) {
    setUploadingNf(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("context", "nota-fiscal");
      const r = await apiUpload<{ url: string }>("/upload", fd);
      setNfArquivo(r.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload da NF");
    } finally {
      setUploadingNf(false);
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

  const nfHref = resolveAssetUrl(row.nfArquivo || nfArquivo);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Pedido #{row.egestorCodigo}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {row.cliente?.nome || row.nomeContato}
            {row.filialAcabado ? ` · ${row.filialAcabado.sigla}` : ""}
            {" · "}
            {statusLabel(row.status)}
          </p>
        </div>
        <Link
          href={
            row.status === "ABERTO"
              ? "/pedidos"
              : `/pedidos?status=${row.status}`
          }
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          Voltar
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {row.status === "ABERTO" && bloqueadoSku && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Há item sem produto TEEP. Cadastre o SKU para separar.
        </p>
      )}
      {bloqueadoCliente && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {!row.documentoContato
            ? "Contato do eGestor sem CNPJ válido. Corrija no eGestor e atualize."
            : `Cliente com CNPJ ${cnpjLabel} não encontrado (ou inativo) no TEEP.`}
        </p>
      )}
      {aguardaAprovacao && (
        <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Há saída deste pedido pendente em Aprovações.
        </p>
      )}
      {row.status === "SEPARADO" && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Separado e embalado. Anexe a nota fiscal para enviar.
        </p>
      )}

      {somenteLeitura ? (
        <div className="mt-6 space-y-6">
          <ItensSomenteLeitura itens={row.itens} />

          {podeEnviar && (
            <form
              onSubmit={onEnviar}
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <p className="text-sm font-medium">Envio</p>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  Transportadora{" "}
                  <span className="font-normal text-slate-400">(opcional)</span>
                </span>
                <input
                  maxLength={120}
                  className="w-full rounded-lg border px-3 py-2"
                  value={transportadora}
                  onChange={(e) => setTransportadora(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  Rastreio{" "}
                  <span className="font-normal text-slate-400">(opcional)</span>
                </span>
                <input
                  maxLength={80}
                  className="w-full rounded-lg border px-3 py-2"
                  value={rastreio}
                  onChange={(e) => setRastreio(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Número da NF</span>
                <input
                  required
                  maxLength={60}
                  className="w-full rounded-lg border px-3 py-2"
                  value={nfNumero}
                  onChange={(e) => setNfNumero(e.target.value)}
                />
              </label>
              <div className="text-sm">
                <span className="mb-1 block font-medium">Nota fiscal</span>
                <label className="inline-flex cursor-pointer rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">
                  {uploadingNf
                    ? "Enviando…"
                    : nfArquivo
                      ? "Trocar arquivo"
                      : "Anexar NF (PDF/imagem)"}
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    className="hidden"
                    disabled={uploadingNf}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void onNfFile(file);
                    }}
                  />
                </label>
                {nfArquivo && (
                  <a
                    href={nfHref || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-3 text-sm text-brand hover:underline"
                  >
                    Ver anexo
                  </a>
                )}
              </div>
              <button
                type="submit"
                disabled={
                  saving || uploadingNf || !nfArquivo || !nfNumero.trim()
                }
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Enviando…" : "Enviar"}
              </button>
            </form>
          )}

          {row.status === "ENVIADO" && (
            <dl className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Transportadora</dt>
                <dd className="font-medium">{row.transportadora || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Rastreio</dt>
                <dd className="font-medium">{row.rastreio || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">NF</dt>
                <dd className="font-medium">{row.nfNumero || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Arquivo</dt>
                <dd>
                  {row.nfArquivo ? (
                    <a
                      href={resolveAssetUrl(row.nfArquivo) || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand hover:underline"
                    >
                      Abrir nota fiscal
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          )}
        </div>
      ) : (
        <form onSubmit={onSeparar} className="mt-6 space-y-4">
          {podeSeparar && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Estoque de acabados</span>
              <select
                required
                className="w-full max-w-md rounded-lg border px-3 py-2"
                value={filialId}
                onChange={(e) => setFilialId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {acabados.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.sigla} — {f.nome}
                  </option>
                ))}
              </select>
              {acabados.length === 0 && (
                <span className="mt-1 block text-xs text-rose-600">
                  Nenhum estoque de acabados disponível.
                </span>
              )}
            </label>
          )}

          <div className="space-y-3">
            {row.itens.map((it, index) => {
              const linha = linhas.find((l) => l.key === it.id);
              if (!linha) return null;
              return (
                <div key={it.id} className="space-y-1">
                  <LancamentoLinhaItem
                    linha={linha}
                    index={index}
                    canRemove={false}
                    locked
                    filialId={filialId}
                    exigeSerie={(prod) =>
                      exigeSerieNoLancamento({
                        produtoControlaSerie: prod.controlaSerie,
                        tipoControleSerie: row.controleSerieSaida,
                      })
                    }
                    serieLivre={(prod) =>
                      usaSerieLivre({
                        produtoControlaSerie: prod.controlaSerie,
                        tipoControleSerie: row.controleSerieSaida,
                      })
                    }
                    validarSerieEstoque={exigeSerieNoLancamento({
                      produtoControlaSerie: it.produto?.controlaSerie,
                      tipoControleSerie: row.controleSerieSaida,
                    })}
                    podeGerarAutomatico={false}
                    onPatch={(partial) => patchLinha(it.id, partial)}
                    onRemove={() => undefined}
                    onError={setError}
                    onMsg={() => undefined}
                  />
                  {!it.produtoId ? (
                    <p className="text-xs text-amber-800">
                      SKU «{it.codigoProprio}» não encontrado no cadastro TEEP.
                    </p>
                  ) : it.produto?.ativo === false ? (
                    <p className="text-xs text-amber-800">
                      Produto {it.codigoProprio} está inativo.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {podeSeparar && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium">Avisar por e-mail</p>
              <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-sm">
                {destTodos.map((u) => (
                  <li key={u.id}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={destIds.includes(u.id)}
                        onChange={(e) => {
                          setDestIds((prev) =>
                            e.target.checked
                              ? [...prev, u.id]
                              : prev.filter((x) => x !== u.id)
                          );
                        }}
                      />
                      {u.nome}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {podeSeparar && (
            <button
              type="submit"
              disabled={saving || !filialId || destIds.length === 0}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Separando…" : "Separar pedido"}
            </button>
          )}
        </form>
      )}
    </>
  );
}
