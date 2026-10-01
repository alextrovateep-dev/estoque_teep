"use client";

import { api } from "@/lib/api";
import {
  LancamentoLinhaItem,
  newLancamentoLinha,
  type LancamentoLinha,
} from "@/components/LancamentoLinhaItem";
import { exigeSerieNoLancamento, formatCnpj, usaSerieLivre } from "@teep/shared";
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
  dtVenda: string;
  situacao: number;
  situacaoOs: string | null;
  status: string;
  grupoLancamentoId: string | null;
  aguardandoAprovacao?: boolean;
  controleSerieSaida?: string | null;
  filialAcabado?: { id: string; sigla: string; nome: string } | null;
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

  const cnpjLabel = row?.documentoContato
    ? formatCnpj(row.documentoContato)
    : null;

  function patchLinha(key: string, partial: Partial<LancamentoLinha>) {
    setLinhas((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...partial } : l))
    );
  }

  async function onSubmit(e: FormEvent) {
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
              series: linha?.produto &&
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

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Pedido #{row.egestorCodigo}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {row.cliente?.nome || row.nomeContato}
            {cnpjLabel ? ` · ${cnpjLabel}` : ""} ·{" "}
            {row.situacao === 10 ? "Orçamento" : row.situacaoOs || "Em espera"} ·{" "}
            {row.status === "SEPARADO" ? "Separado" : "Em aberto"}
          </p>
        </div>
        <Link
          href="/pedidos"
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
      {bloqueadoSku && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Há item sem produto TEEP (código próprio ≠ cadastro). Cadastre o SKU
          para separar.
        </p>
      )}
      {bloqueadoCliente && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {!row.documentoContato
            ? "Contato do eGestor sem CNPJ válido. Corrija o contato no eGestor e use Atualizar do eGestor."
            : `Cliente com CNPJ ${cnpjLabel} não encontrado (ou inativo) no cadastro TEEP. Cadastre o cliente com o mesmo CNPJ para separar.`}
        </p>
      )}
      {!bloqueadoCliente && row.cliente && row.status === "ABERTO" && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Cliente TEEP: {row.cliente.nome}
          {row.cliente.documento ? ` · ${formatCnpj(row.cliente.documento)}` : ""}
        </p>
      )}
      {aguardaAprovacao && (
        <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Há saída deste pedido ainda pendente em Aprovações. Conclua ou
          rejeite lá para liberar o pedido. Separações novas já baixam o
          estoque na hora (sem essa fila).
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
                Nenhum estoque de acabados disponível. Marque o flag no cadastro
                de estoques.
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
                    SKU «{it.codigoProprio}» não encontrado no cadastro TEEP —
                    o código próprio no eGestor precisa ser igual ao código do
                    produto.
                  </p>
                ) : it.produto?.ativo === false ? (
                  <p className="text-xs text-amber-800">
                    Produto {it.codigoProprio} está inativo no cadastro TEEP.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        {podeSeparar && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium">Avisar por e-mail</p>
            <p className="mt-1 text-xs text-slate-500">
              Escolha ao menos um usuário cadastrado. O e-mail é enviado quando
              a separação concluir (estoque baixado).
            </p>
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
                    <span className="text-slate-400">{u.email}</span>
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
    </>
  );
}
